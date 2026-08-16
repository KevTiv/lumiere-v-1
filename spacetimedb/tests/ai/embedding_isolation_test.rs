//! AI-008: multi-org isolation for search embeddings.
//!
//! `SearchEmbedding` has no dedicated "read" reducer — application code (and
//! the AI Gateway) reads rows via the `embedding_by_org` btree index. This
//! proves that index-scoped reads never cross organizations, and that the
//! reducers which look an embedding up by id/content (`mark_embedding_synced`,
//! `delete_search_embedding`) reject when the row belongs to a different org
//! than the caller-scoped `organization_id`.
use spacetimedb::{ReducerContext, Table};

use crate::ai::intelligence::{
    delete_search_embedding, mark_embedding_synced, search_embedding, upsert_search_embedding,
    UpsertSearchEmbeddingParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

fn seed_embedding(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    content_type: &str,
    content_id: u64,
    text: &str,
) -> Result<u64, String> {
    upsert_search_embedding(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        UpsertSearchEmbeddingParams {
            content_type: content_type.to_string(),
            content_id,
            text: text.to_string(),
            embedding: vec![0.1, 0.2, 0.3],
            embedding_hash: None,
            metadata: None,
        },
    )?;
    ctx.db
        .search_embedding()
        .iter()
        .find(|e| {
            e.organization_id == fixture.organization_id
                && e.content_type == content_type
                && e.content_id == content_id
        })
        .map(|e| e.id)
        .ok_or_else(|| "seeded embedding missing".to_string())
}

/// AI-008: Org A cannot read Org B's embeddings, and vice versa.
pub fn test_search_embedding_org_isolation(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let org_a = OrgFixture::seed_minimal(ctx)?;
    let org_b = OrgFixture::seed_minimal(ctx)?;

    // Same content_type/content_id on purpose — proves isolation holds even
    // when the two orgs' rows would otherwise collide on a non-org key.
    let embedding_a = seed_embedding(ctx, &org_a, "document", 1, "Org A confidential text")?;
    let embedding_b = seed_embedding(ctx, &org_b, "document", 1, "Org B confidential text")?;

    // Org-scoped index read (the real read path — no dedicated query reducer
    // exists): org A's view must never contain org B's row, and vice versa.
    let org_a_rows: Vec<_> = ctx
        .db
        .search_embedding()
        .embedding_by_org()
        .filter(&org_a.organization_id)
        .collect();
    if org_a_rows.iter().any(|e| e.id == embedding_b) {
        return Err("org A query returned org B's embedding".to_string());
    }
    if !org_a_rows.iter().any(|e| e.id == embedding_a) {
        return Err("org A query is missing its own embedding".to_string());
    }

    let org_b_rows: Vec<_> = ctx
        .db
        .search_embedding()
        .embedding_by_org()
        .filter(&org_b.organization_id)
        .collect();
    if org_b_rows.iter().any(|e| e.id == embedding_a) {
        return Err("org B query returned org A's embedding".to_string());
    }
    if !org_b_rows.iter().any(|e| e.id == embedding_b) {
        return Err("org B query is missing its own embedding".to_string());
    }

    // mark_embedding_synced: org A cannot mark an embedding it doesn't own as synced.
    let cross_sync = mark_embedding_synced(
        ctx,
        org_a.organization_id,
        Some(org_a.company_id),
        embedding_b,
        "voyage-3".to_string(),
        1024,
    );
    if cross_sync.is_ok() {
        return Err("org A was able to mark org B's embedding as synced".to_string());
    }
    let org_b_embedding = ctx
        .db
        .search_embedding()
        .id()
        .find(&embedding_b)
        .ok_or("org B embedding disappeared after cross-org sync attempt")?;
    if org_b_embedding.sync_status == "synced" {
        return Err("cross-org mark_embedding_synced mutated org B's embedding".to_string());
    }

    // delete_search_embedding looks a row up by (content_type, content_id,
    // company_id) — company-scoped, not id-scoped. Reusing content_id=1 here
    // would just delete org A's *own* colliding row (a legitimate self-delete,
    // not a cross-org breach). To prove real isolation, target content that
    // only exists under org B's company scope: org A's lookup must find
    // nothing at all, not silently resolve to org B's row.
    let org_b_only_embedding = seed_embedding(ctx, &org_b, "document", 2, "Org B only text")?;
    let cross_delete = delete_search_embedding(
        ctx,
        org_a.organization_id,
        Some(org_a.company_id),
        "document".to_string(),
        2,
    );
    if cross_delete.is_ok() {
        return Err("org A was able to delete content that only exists under org B".to_string());
    }
    let org_b_embedding = ctx
        .db
        .search_embedding()
        .id()
        .find(&org_b_only_embedding)
        .ok_or("org B embedding disappeared after cross-org delete attempt")?;
    if org_b_embedding.sync_status == "deleted" {
        return Err("cross-org delete_search_embedding removed org B's embedding".to_string());
    }

    // Sanity: same-org sync/delete still work.
    mark_embedding_synced(
        ctx,
        org_a.organization_id,
        Some(org_a.company_id),
        embedding_a,
        "voyage-3".to_string(),
        1024,
    )?;
    let synced = ctx
        .db
        .search_embedding()
        .id()
        .find(&embedding_a)
        .ok_or("org A embedding disappeared")?;
    if synced.sync_status != "synced" {
        return Err("same-org mark_embedding_synced did not persist".to_string());
    }

    Ok(())
}

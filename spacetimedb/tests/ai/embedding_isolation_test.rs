//! Canonical passage indexing, queue delivery, and tenant-isolation tests.

use std::time::Duration;

use spacetimedb::{ReducerContext, Table};

use crate::ai::evidence_dependency::record_ai_evidence_source_change;
use crate::ai::evidence_source::{ai_evidence_passage, record_ai_evidence_source_version};
use crate::ai::intelligence::{
    delete_search_embedding, finalize_embedding_job, mark_embedding_synced, request_embedding_job,
    search_embedding, upsert_search_embedding, UpsertSearchEmbeddingParams,
};
use crate::core::queue::{
    claim_queue_job, queue_effect_receipt, queue_job, queue_worker, register_queue_worker,
    ClaimQueueJobParams, CompleteQueueJobParams, RegisterQueueWorkerParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{QueueCompletionOutcome, QueueJobStatus};

use super::evidence_provenance_test::{
    change, expect_err, seed_evidence, version_id, version_params, Evidence,
};

const CONTENT_TYPE: &str = "ai_evidence_passage";
const GENERATION_V1: &str = "qdrant-v1";
const GENERATION_V2: &str = "qdrant-v2";

struct IndexedPassage {
    evidence: Evidence,
    embedding_id: u64,
    job_id: u64,
    fingerprint: String,
}

fn upsert_and_request(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    evidence: Evidence,
    generation: &str,
) -> Result<IndexedPassage, String> {
    let fingerprint = ctx
        .db
        .ai_evidence_passage()
        .id()
        .find(&evidence.passage_id)
        .ok_or("canonical passage missing")?
        .content_hash;
    upsert_search_embedding(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        UpsertSearchEmbeddingParams {
            content_type: CONTENT_TYPE.into(),
            content_id: evidence.passage_id,
            expected_fingerprint: fingerprint.clone(),
            index_generation: generation.into(),
            metadata: None,
        },
    )?;
    request_embedding_job(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        CONTENT_TYPE.into(),
        evidence.passage_id,
        fingerprint.clone(),
        generation.into(),
    )?;
    let embedding_id = ctx
        .db
        .search_embedding()
        .embedding_by_content()
        .filter(&CONTENT_TYPE.to_string())
        .find(|row| {
            row.organization_id == fixture.organization_id
                && row.company_id == Some(fixture.company_id)
                && row.content_id == evidence.passage_id
        })
        .map(|row| row.id)
        .ok_or("search embedding state missing")?;
    let semantic_key = format!(
        "embedding:{CONTENT_TYPE}:{}:{fingerprint}:{generation}",
        evidence.passage_id
    );
    let job_id = ctx
        .db
        .queue_job()
        .iter()
        .find(|job| {
            job.organization_id == fixture.organization_id && job.semantic_key == semantic_key
        })
        .map(|job| job.id)
        .ok_or("embedding queue job missing")?;
    Ok(IndexedPassage {
        evidence,
        embedding_id,
        job_id,
        fingerprint,
    })
}

fn seed_indexed_passage(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    source_key: &str,
    generation: &str,
) -> Result<IndexedPassage, String> {
    let evidence = seed_evidence(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        source_key,
        "company",
    )?;
    upsert_and_request(ctx, fixture, evidence, generation)
}

fn worker(ctx: &ReducerContext, organization_id: u64) -> Result<u64, String> {
    register_queue_worker(
        ctx,
        organization_id,
        RegisterQueueWorkerParams {
            company_id: None,
            name: "embedding-test-worker".into(),
            queues: vec!["embedding".into()],
            metadata: None,
        },
    )?;
    ctx.db
        .queue_worker()
        .iter()
        .find(|row| row.organization_id == organization_id && row.name == "embedding-test-worker")
        .map(|row| row.id)
        .ok_or("embedding worker missing".to_string())
}

fn claim(
    ctx: &ReducerContext,
    organization_id: u64,
    job_id: u64,
    worker_id: u64,
    token: &str,
) -> Result<(), String> {
    claim_queue_job(
        ctx,
        organization_id,
        job_id,
        ClaimQueueJobParams {
            expected_revision: 0,
            worker_id,
            lease_token: token.into(),
            lease_expires_at_micros: (ctx.timestamp + Duration::from_secs(60))
                .to_micros_since_unix_epoch() as u64,
        },
    )
}

fn completion(worker_id: u64, token: &str, fingerprint: &str) -> CompleteQueueJobParams {
    CompleteQueueJobParams {
        expected_revision: 1,
        worker_id,
        lease_token: token.into(),
        outcome: QueueCompletionOutcome::Succeeded,
        error_summary: None,
        response_fingerprint: Some(fingerprint.into()),
        retry_jitter_micros: 0,
    }
}

pub fn test_embedding_uses_canonical_passage_and_reference_only_job(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let indexed = seed_indexed_passage(ctx, &fixture, "canonical-index", GENERATION_V1)?;
    let passage = ctx
        .db
        .ai_evidence_passage()
        .id()
        .find(&indexed.evidence.passage_id)
        .ok_or("canonical passage disappeared")?;
    if passage.passage_text.is_empty() {
        return Err("canonical passage text is empty".into());
    }
    let state = ctx
        .db
        .search_embedding()
        .id()
        .find(&indexed.embedding_id)
        .ok_or("search embedding state disappeared")?;
    if state.expected_fingerprint != passage.content_hash || state.index_generation != GENERATION_V1
    {
        return Err("index state does not reference the canonical passage".into());
    }

    let job = ctx
        .db
        .queue_job()
        .id()
        .find(&indexed.job_id)
        .ok_or("embedding job disappeared")?;
    let payload: serde_json::Value =
        serde_json::from_str(&job.payload).map_err(|error| error.to_string())?;
    let object = payload
        .as_object()
        .ok_or("embedding payload is not an object")?;
    if object.len() != 6
        || object.get("operation").and_then(serde_json::Value::as_str) != Some("upsert")
        || object
            .get("content_type")
            .and_then(serde_json::Value::as_str)
            != Some(CONTENT_TYPE)
        || object.get("content_id").and_then(serde_json::Value::as_u64)
            != Some(indexed.evidence.passage_id)
        || object
            .get("expected_fingerprint")
            .and_then(serde_json::Value::as_str)
            != Some(indexed.fingerprint.as_str())
        || object
            .get("index_generation")
            .and_then(serde_json::Value::as_str)
            != Some(GENERATION_V1)
        || object.contains_key("text")
        || object.contains_key("embedding")
    {
        return Err("embedding job payload is not reference-only".into());
    }

    for (content_type, fingerprint, label) in [
        (CONTENT_TYPE, "0".repeat(64), "stale fingerprint"),
        (
            "document",
            indexed.fingerprint.clone(),
            "noncanonical content type",
        ),
    ] {
        expect_err(
            upsert_search_embedding(
                ctx,
                fixture.organization_id,
                Some(fixture.company_id),
                UpsertSearchEmbeddingParams {
                    content_type: content_type.into(),
                    content_id: indexed.evidence.passage_id,
                    expected_fingerprint: fingerprint,
                    index_generation: GENERATION_V1.into(),
                    metadata: None,
                },
            ),
            if content_type == CONTENT_TYPE {
                "fingerprint"
            } else {
                CONTENT_TYPE
            },
            label,
        )?;
    }

    let mut replacement = version_params("2");
    replacement.supersedes_version_id = Some(indexed.evidence.version_id);
    record_ai_evidence_source_version(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        indexed.evidence.source_id,
        replacement,
    )?;
    let replacement_id = version_id(ctx, indexed.evidence.source_id, "2")?;
    record_ai_evidence_source_change(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        indexed.evidence.version_id,
        change("superseded", Some(replacement_id)),
    )?;
    expect_err(
        upsert_search_embedding(
            ctx,
            fixture.organization_id,
            Some(fixture.company_id),
            UpsertSearchEmbeddingParams {
                content_type: CONTENT_TYPE.into(),
                content_id: indexed.evidence.passage_id,
                expected_fingerprint: indexed.fingerprint,
                index_generation: GENERATION_V1.into(),
                metadata: None,
            },
        ),
        "current",
        "superseded passage",
    )
}

pub fn test_search_embedding_org_isolation(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let org_a = OrgFixture::seed_minimal(ctx)?;
    let org_b = OrgFixture::seed_minimal(ctx)?;
    let indexed_a = seed_indexed_passage(ctx, &org_a, "org-a-index", GENERATION_V1)?;
    let indexed_b = seed_indexed_passage(ctx, &org_b, "org-b-index", GENERATION_V1)?;

    expect_err(
        upsert_search_embedding(
            ctx,
            org_a.organization_id,
            Some(org_a.company_id),
            UpsertSearchEmbeddingParams {
                content_type: CONTENT_TYPE.into(),
                content_id: indexed_b.evidence.passage_id,
                expected_fingerprint: indexed_b.fingerprint.clone(),
                index_generation: GENERATION_V1.into(),
                metadata: None,
            },
        ),
        "tenant scope",
        "cross-tenant passage",
    )?;
    let org_a_rows: Vec<_> = ctx
        .db
        .search_embedding()
        .embedding_by_org()
        .filter(&org_a.organization_id)
        .collect();
    if org_a_rows
        .iter()
        .any(|row| row.id == indexed_b.embedding_id)
        || !org_a_rows
            .iter()
            .any(|row| row.id == indexed_a.embedding_id)
    {
        return Err("organization-scoped index read crossed tenant scope".into());
    }
    if mark_embedding_synced(
        ctx,
        org_a.organization_id,
        Some(org_a.company_id),
        indexed_b.embedding_id,
        "voyage-3".into(),
        1024,
    )
    .is_ok()
    {
        return Err("cross-tenant sync succeeded".into());
    }
    if delete_search_embedding(
        ctx,
        org_a.organization_id,
        Some(org_a.company_id),
        CONTENT_TYPE.into(),
        indexed_b.evidence.passage_id,
    )
    .is_ok()
    {
        return Err("cross-tenant delete succeeded".into());
    }
    Ok(())
}

pub fn test_embedding_finalization_scrubs_payload_and_rebuilds(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let indexed = seed_indexed_passage(ctx, &fixture, "finalize-index", GENERATION_V1)?;
    let worker_id = worker(ctx, fixture.organization_id)?;
    let before = ctx
        .db
        .queue_job()
        .id()
        .find(&indexed.job_id)
        .ok_or("embedding job missing before claim")?;
    let original_input_hash = before.input_hash.clone();
    let original_semantic_key = before.semantic_key.clone();
    claim(
        ctx,
        fixture.organization_id,
        indexed.job_id,
        worker_id,
        "lease-v1",
    )?;
    let finalize = completion(worker_id, "lease-v1", &indexed.fingerprint);
    for _ in 0..2 {
        finalize_embedding_job(
            ctx,
            fixture.organization_id,
            Some(fixture.company_id),
            indexed.embedding_id,
            "voyage-3".into(),
            1024,
            indexed.job_id,
            finalize.clone(),
        )?;
    }
    let completed = ctx
        .db
        .queue_job()
        .id()
        .find(&indexed.job_id)
        .ok_or("completed embedding job missing")?;
    if completed.status != QueueJobStatus::Completed
        || completed.payload != "{}"
        || completed.input_hash != original_input_hash
        || completed.semantic_key != original_semantic_key
    {
        return Err("completed embedding job retention contract is incorrect".into());
    }
    let receipts: Vec<_> = ctx
        .db
        .queue_effect_receipt()
        .queue_effect_receipt_by_job()
        .filter(&indexed.job_id)
        .collect();
    if receipts.len() != 1
        || receipts[0].input_hash != original_input_hash
        || receipts[0].semantic_key != original_semantic_key
        || receipts[0].response_fingerprint != indexed.fingerprint
    {
        return Err("embedding receipt was not preserved exactly once".into());
    }

    let job_count = ctx.db.queue_job().iter().count();
    let unchanged = upsert_and_request(ctx, &fixture, indexed.evidence, GENERATION_V1)?;
    if unchanged.job_id != indexed.job_id || ctx.db.queue_job().iter().count() != job_count {
        return Err("same index generation was not idempotent".into());
    }
    let rebuilt = upsert_and_request(ctx, &fixture, unchanged.evidence, GENERATION_V2)?;
    if rebuilt.embedding_id != indexed.embedding_id || rebuilt.job_id == indexed.job_id {
        return Err("new index generation did not create rebuild work".into());
    }
    claim(
        ctx,
        fixture.organization_id,
        rebuilt.job_id,
        worker_id,
        "lease-v2",
    )?;
    finalize_embedding_job(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        rebuilt.embedding_id,
        "voyage-3".into(),
        1024,
        rebuilt.job_id,
        completion(worker_id, "lease-v2", &rebuilt.fingerprint),
    )?;
    let rebuilt_state = ctx
        .db
        .search_embedding()
        .id()
        .find(&rebuilt.embedding_id)
        .ok_or("rebuilt embedding state missing")?;
    if rebuilt_state.sync_status != "synced" || rebuilt_state.index_generation != GENERATION_V2 {
        return Err("new index generation was not finalized".into());
    }
    Ok(())
}

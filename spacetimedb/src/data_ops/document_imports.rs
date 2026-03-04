/// Document CSV Imports — KnowledgeArticleCategory, KnowledgeArticle
use spacetimedb::{ReducerContext, Table};

use crate::data_ops::helpers::*;
use crate::data_ops::import_tracker::{begin_import_job, finish_import_job, record_import_error};
use crate::documents::knowledge::{knowledge_article, knowledge_article_category, KnowledgeArticle, KnowledgeArticleCategory};
use crate::helpers::check_permission;

// ── KnowledgeArticleCategory ──────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_knowledge_category_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "knowledge_article_category", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "knowledge_article_category", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        ctx.db.knowledge_article_category().insert(KnowledgeArticleCategory {
            id: 0,
            name,
            description: opt_str(col(&headers, row, "description")),
            sequence: parse_u32(col(&headers, row, "sequence")),
            color: None,
            article_count: 0,
            parent_id: opt_u64(col(&headers, row, "parent_id")),
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!("Import knowledge_article_category: imported={}, errors={}", imported, errors);
    Ok(())
}

// ── KnowledgeArticle ──────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_knowledge_article_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "knowledge_article", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "knowledge_article", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        ctx.db.knowledge_article().insert(KnowledgeArticle {
            id: 0,
            name,
            description: opt_str(col(&headers, row, "description")),
            body: opt_str(col(&headers, row, "body")),
            icon: opt_str(col(&headers, row, "icon")),
            color: None,
            sequence: parse_u32(col(&headers, row, "sequence")),
            is_locked: false,
            lock_by: None,
            lock_on: None,
            is_article_item: false,
            is_article_root: opt_u64(col(&headers, row, "parent_id")).is_none(),
            is_todo_item: false,
            root_article_id: None,
            parent_id: opt_u64(col(&headers, row, "parent_id")),
            child_ids: vec![],
            previous_article_id: None,
            next_article_id: None,
            has_item_children: false,
            category_id: opt_u64(col(&headers, row, "category_id")),
            favorite_ids: vec![],
            user_sequence: 0,
            article_url: None,
            stage_id: None,
            member_ids: vec![],
            article_member_count: 0,
            article_item_count: 0,
            article_count: 0,
            internal_permission: opt_str(col(&headers, row, "internal_permission")),
            inherited_permission: None,
            inherited_permission_parent_id: None,
            is_published: parse_bool(col(&headers, row, "is_published")),
            website_url: None,
            activity_ids: vec![],
            message_follower_ids: vec![],
            message_ids: vec![],
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!("Import knowledge_article: imported={}, errors={}", imported, errors);
    Ok(())
}

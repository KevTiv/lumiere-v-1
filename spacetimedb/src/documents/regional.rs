//! Wave C — document index/retention reducers and scheduled purge.

use spacetimedb::{reducer, ReducerContext, ScheduleAt, SpacetimeType, Table};

use crate::core::privacy::data_classification;
use crate::documents::documents::{document, document_version, Document};
use crate::documents::pack_locale::{
    compute_purge_after, document_search_language_for_company, truncate_index_content,
};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

#[derive(Clone)]
#[spacetimedb::table(
    accessor = document_retention_purge_job,
    scheduled(run_document_retention_purge)
)]
pub struct DocumentRetentionPurgeJob {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
    pub organization_id: u64,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct SetDocumentIndexContentParams {
    pub content: String,
    pub language: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct SetDocumentRetentionParams {
    pub classification_id: Option<u64>,
    pub retention_days: Option<u32>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ScheduleDocumentRetentionPurgeParams {
    pub delay_seconds: Option<u64>,
}

#[reducer]
pub fn set_document_index_content(
    ctx: &ReducerContext,
    organization_id: u64,
    document_id: u64,
    params: SetDocumentIndexContentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document", "write")?;

    let doc = ctx
        .db
        .document()
        .id()
        .find(&document_id)
        .ok_or("Document not found")?;
    if doc.organization_id != organization_id {
        return Err("Document does not belong to this organization".to_string());
    }
    if doc.is_deleted {
        return Err("Cannot index a deleted document".to_string());
    }

    let content = truncate_index_content(&params.content);
    if content.is_empty() {
        return Err("index content must not be empty".to_string());
    }

    let language = params
        .language
        .or_else(|| document_search_language_for_company(ctx, organization_id, doc.company_id));

    let company_id = doc.company_id;
    ctx.db.document().id().update(Document {
        index_content: Some(content),
        index_language: language,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..doc
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "document",
            record_id: document_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some("{\"index_content\":\"set\"}".to_string()),
            changed_fields: vec!["index_content".to_string(), "index_language".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn set_document_retention(
    ctx: &ReducerContext,
    organization_id: u64,
    document_id: u64,
    params: SetDocumentRetentionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document", "write")?;

    let doc = ctx
        .db
        .document()
        .id()
        .find(&document_id)
        .ok_or("Document not found")?;
    if doc.organization_id != organization_id {
        return Err("Document does not belong to this organization".to_string());
    }

    let mut retention_days = params.retention_days.or(doc.retention_days);
    let mut classification_id = params.classification_id.or(doc.classification_id);

    if let Some(cid) = params.classification_id {
        let class = ctx
            .db
            .data_classification()
            .id()
            .find(&cid)
            .ok_or("Data classification not found")?;
        if class.organization_id != organization_id {
            return Err("Classification does not belong to this organization".to_string());
        }
        classification_id = Some(cid);
        if params.retention_days.is_none() {
            retention_days = class.retention_days.or(retention_days);
        }
    }

    let purge_after = if doc.is_deleted {
        match (doc.deleted_at, retention_days) {
            (Some(deleted_at), Some(days)) if days > 0 => {
                Some(compute_purge_after(deleted_at, days))
            }
            _ => None,
        }
    } else {
        None
    };

    let company_id = doc.company_id;
    ctx.db.document().id().update(Document {
        classification_id,
        retention_days,
        purge_after,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..doc
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "document",
            record_id: document_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "classification_id": classification_id,
                    "retention_days": retention_days,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "classification_id".to_string(),
                "retention_days".to_string(),
                "purge_after".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

fn hard_purge_document(ctx: &ReducerContext, organization_id: u64, doc: Document) {
    if crate::documents::legal_hold::document_has_active_legal_hold(ctx, organization_id, doc.id) {
        log::info!("Skipping purge for document {} — active legal hold", doc.id);
        return;
    }
    let doc_id = doc.id;
    let company_id = doc.company_id;
    let versions: Vec<u64> = ctx
        .db
        .document_version()
        .iter()
        .filter(|v| v.document_id == doc_id && v.organization_id == organization_id)
        .map(|v| v.id)
        .collect();
    for vid in versions {
        ctx.db.document_version().id().delete(&vid);
    }
    ctx.db.document().id().delete(&doc_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "document",
            record_id: doc_id,
            action: "DELETE",
            old_values: Some(
                serde_json::json!({
                    "name": doc.name,
                    "purged": true,
                    "retention_days": doc.retention_days,
                })
                .to_string(),
            ),
            new_values: None,
            changed_fields: vec!["purged".to_string()],
            metadata: Some("{\"wave\":\"c\",\"reason\":\"retention_purge\"}".to_string()),
        },
    );
}

#[reducer]
pub fn purge_expired_documents(ctx: &ReducerContext, organization_id: u64) -> Result<(), String> {
    check_permission(ctx, organization_id, "document", "delete")?;

    let now = ctx.timestamp.to_micros_since_unix_epoch();
    let victims: Vec<Document> = ctx
        .db
        .document()
        .iter()
        .filter(|d| {
            d.organization_id == organization_id
                && d.is_deleted
                && d.purge_after
                    .map(|t| t.to_micros_since_unix_epoch() <= now)
                    .unwrap_or(false)
        })
        .collect();

    for doc in victims {
        hard_purge_document(ctx, organization_id, doc);
    }
    Ok(())
}

#[reducer]
pub fn schedule_document_retention_purge(
    ctx: &ReducerContext,
    organization_id: u64,
    params: ScheduleDocumentRetentionPurgeParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document", "admin")?;
    let delay = params.delay_seconds.unwrap_or(60).max(1);
    let when = ctx.timestamp + std::time::Duration::from_secs(delay);
    ctx.db
        .document_retention_purge_job()
        .insert(DocumentRetentionPurgeJob {
            scheduled_id: 0,
            scheduled_at: ScheduleAt::Time(when),
            organization_id,
        });
    Ok(())
}

#[reducer]
pub fn run_document_retention_purge(
    ctx: &ReducerContext,
    job: DocumentRetentionPurgeJob,
) -> Result<(), String> {
    let organization_id = job.organization_id;
    let now = ctx.timestamp.to_micros_since_unix_epoch();
    let victims: Vec<Document> = ctx
        .db
        .document()
        .iter()
        .filter(|d| {
            d.organization_id == organization_id
                && d.is_deleted
                && d.purge_after
                    .map(|t| t.to_micros_since_unix_epoch() <= now)
                    .unwrap_or(false)
        })
        .collect();
    for doc in victims {
        hard_purge_document(ctx, organization_id, doc);
    }
    Ok(())
}

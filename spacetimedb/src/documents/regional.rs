//! Wave C — document index/retention reducers and scheduled purge.

use spacetimedb::{reducer, ReducerContext, ScheduleAt, SpacetimeType, Table};

use crate::core::privacy::data_classification;
use crate::documents::documents::{document, document_version, Document};
use crate::documents::pack_locale::compute_purge_after;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

#[derive(Clone)]
#[spacetimedb::table(
    accessor = document_retention_purge_job,
    index(accessor = document_retention_purge_job_by_organization, btree(columns = [organization_id])),
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
pub struct SetDocumentRetentionParams {
    pub classification_id: Option<u64>,
    pub retention_days: Option<u32>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ScheduleDocumentRetentionPurgeParams {
    pub delay_seconds: Option<u64>,
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

fn reviewed_scope_matches(expected: &[u64], actual: &[u64]) -> bool {
    let expected_set: std::collections::BTreeSet<_> = expected.iter().copied().collect();
    let actual_set: std::collections::BTreeSet<_> = actual.iter().copied().collect();
    !expected.is_empty()
        && !expected_set.contains(&0)
        && expected_set.len() == expected.len()
        && actual_set.len() == actual.len()
        && expected_set == actual_set
}

/// Bind an immediate purge to the exact set the actor reviewed. Eligibility and
/// legal holds are checked in this transaction before any irreversible write.
#[reducer]
pub fn purge_reviewed_expired_documents(
    ctx: &ReducerContext,
    organization_id: u64,
    document_ids: Vec<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document", "delete")?;
    let now = ctx.timestamp.to_micros_since_unix_epoch();
    let victims: Vec<Document> = ctx
        .db
        .document()
        .iter()
        .filter(|doc| {
            doc.organization_id == organization_id
                && doc.is_deleted
                && doc
                    .purge_after
                    .is_some_and(|expiry| expiry.to_micros_since_unix_epoch() <= now)
                && !crate::documents::legal_hold::document_has_active_legal_hold(
                    ctx,
                    organization_id,
                    doc.id,
                )
        })
        .collect();
    let actual = victims.iter().map(|doc| doc.id).collect::<Vec<_>>();
    if !reviewed_scope_matches(&document_ids, &actual) {
        return Err(
            "Affected documents or legal holds changed; review a fresh purge preview".into(),
        );
    }
    for doc in victims {
        hard_purge_document(ctx, organization_id, doc);
    }
    Ok(())
}

#[cfg(test)]
mod reviewed_purge_tests {
    use super::reviewed_scope_matches;
    #[test]
    fn reviewed_scope_requires_exact_set_and_rejects_new_removed_duplicate_or_empty_ids() {
        assert!(reviewed_scope_matches(
            &[9_007_199_254_740_993, 2],
            &[2, 9_007_199_254_740_993]
        ));
        assert!(!reviewed_scope_matches(&[1], &[1, 2]));
        assert!(!reviewed_scope_matches(&[1, 2], &[1]));
        assert!(!reviewed_scope_matches(&[1, 1], &[1]));
        assert!(!reviewed_scope_matches(&[], &[]));
        assert!(!reviewed_scope_matches(&[0], &[0]));
    }
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

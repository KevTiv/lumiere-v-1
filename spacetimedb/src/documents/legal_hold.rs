//! Wave D — document legal hold (blocks soft-delete and retention purge).

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::documents::documents::document;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

#[derive(Clone)]
#[spacetimedb::table(
    accessor = document_legal_hold,
    public,
    index(accessor = legal_hold_by_document, btree(columns = [document_id])),
    index(accessor = legal_hold_by_org, btree(columns = [organization_id]))
)]
pub struct DocumentLegalHold {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub document_id: u64,
    pub reason: String,
    pub held_by: Identity,
    pub held_at: Timestamp,
    pub is_active: bool,
    pub released_at: Option<Timestamp>,
    pub released_by: Option<Identity>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ApplyDocumentLegalHoldParams {
    pub reason: String,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ReleaseDocumentLegalHoldParams {
    pub metadata: Option<String>,
}

pub(crate) fn document_has_active_legal_hold(
    ctx: &ReducerContext,
    organization_id: u64,
    document_id: u64,
) -> bool {
    ctx.db
        .document_legal_hold()
        .legal_hold_by_document()
        .filter(&document_id)
        .any(|h| h.organization_id == organization_id && h.is_active)
}

#[reducer]
pub fn apply_document_legal_hold(
    ctx: &ReducerContext,
    organization_id: u64,
    document_id: u64,
    params: ApplyDocumentLegalHoldParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document", "admin")?;
    let reason = params.reason.trim().to_string();
    if reason.is_empty() {
        return Err("legal hold reason is required".to_string());
    }

    let doc = ctx
        .db
        .document()
        .id()
        .find(&document_id)
        .ok_or("Document not found")?;
    if doc.organization_id != organization_id {
        return Err("Document does not belong to this organization".to_string());
    }

    if document_has_active_legal_hold(ctx, organization_id, document_id) {
        return Err("Document already has an active legal hold".to_string());
    }

    let company_id = doc.company_id;
    let row = ctx.db.document_legal_hold().insert(DocumentLegalHold {
        id: 0,
        organization_id,
        document_id,
        reason: reason.clone(),
        held_by: ctx.sender(),
        held_at: ctx.timestamp,
        is_active: true,
        released_at: None,
        released_by: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "document_legal_hold",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "document_id": document_id,
                    "reason": reason,
                })
                .to_string(),
            ),
            changed_fields: vec!["is_active".to_string(), "reason".to_string()],
            metadata: Some("{\"wave\":\"d\"}".to_string()),
        },
    );
    Ok(())
}

#[reducer]
pub fn release_document_legal_hold(
    ctx: &ReducerContext,
    organization_id: u64,
    hold_id: u64,
    params: ReleaseDocumentLegalHoldParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document", "admin")?;

    let hold = ctx
        .db
        .document_legal_hold()
        .id()
        .find(&hold_id)
        .ok_or("Legal hold not found")?;
    if hold.organization_id != organization_id {
        return Err("Legal hold does not belong to this organization".to_string());
    }
    if !hold.is_active {
        return Err("Legal hold is already released".to_string());
    }

    let document_id = hold.document_id;
    let company_id = ctx
        .db
        .document()
        .id()
        .find(&document_id)
        .map(|d| d.company_id)
        .unwrap_or(None);

    ctx.db.document_legal_hold().id().update(DocumentLegalHold {
        is_active: false,
        released_at: Some(ctx.timestamp),
        released_by: Some(ctx.sender()),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata.or(hold.metadata.clone()),
        ..hold
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "document_legal_hold",
            record_id: hold_id,
            action: "UPDATE",
            old_values: Some("{\"is_active\":true}".to_string()),
            new_values: Some("{\"is_active\":false}".to_string()),
            changed_fields: vec!["is_active".to_string(), "released_at".to_string()],
            metadata: Some("{\"wave\":\"d\"}".to_string()),
        },
    );
    Ok(())
}

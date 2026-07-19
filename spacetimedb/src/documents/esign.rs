//! Wave D — external e-sign TSP envelope metadata + completed PDF version.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::documents::documents::{
    add_document_version, document, AddDocumentVersionParams, Document,
};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

#[derive(Clone)]
#[spacetimedb::table(
    accessor = document_signature_request,
    public,
    index(accessor = signature_by_document, btree(columns = [document_id])),
    index(accessor = signature_by_org, btree(columns = [organization_id])),
    index(accessor = signature_by_envelope, btree(columns = [external_envelope_id]))
)]
pub struct DocumentSignatureRequest {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub document_id: u64,
    /// External TSP name (DocuSign, Adobe Sign, ICP-Brasil provider, …).
    pub provider: String,
    pub external_envelope_id: String,
    /// pending | completed | declined | voided
    pub status: String,
    pub signers_json: Option<String>,
    pub completed_version_id: Option<u64>,
    pub requested_by: Identity,
    pub requested_at: Timestamp,
    pub completed_at: Option<Timestamp>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateDocumentSignatureRequestParams {
    pub provider: String,
    pub external_envelope_id: String,
    pub signers_json: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CompleteDocumentSignatureRequestParams {
    pub file_name: String,
    pub file_size: u64,
    pub mimetype: String,
    pub url: String,
    pub checksum: String,
    pub changes_description: Option<String>,
    pub metadata: Option<String>,
}

#[reducer]
pub fn create_document_signature_request(
    ctx: &ReducerContext,
    organization_id: u64,
    document_id: u64,
    params: CreateDocumentSignatureRequestParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document", "write")?;

    let provider = params.provider.trim().to_string();
    let envelope = params.external_envelope_id.trim().to_string();
    if provider.is_empty() {
        return Err("provider is required".to_string());
    }
    if envelope.is_empty() {
        return Err("external_envelope_id is required".to_string());
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
    if doc.is_deleted {
        return Err("Cannot request signature on a deleted document".to_string());
    }

    let company_id = doc.company_id;
    let row = ctx
        .db
        .document_signature_request()
        .insert(DocumentSignatureRequest {
            id: 0,
            organization_id,
            company_id,
            document_id,
            provider: provider.clone(),
            external_envelope_id: envelope.clone(),
            status: "pending".to_string(),
            signers_json: params.signers_json,
            completed_version_id: None,
            requested_by: ctx.sender(),
            requested_at: ctx.timestamp,
            completed_at: None,
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
            table_name: "document_signature_request",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "document_id": document_id,
                    "provider": provider,
                    "external_envelope_id": envelope,
                })
                .to_string(),
            ),
            changed_fields: vec!["status".to_string()],
            metadata: Some("{\"wave\":\"d\"}".to_string()),
        },
    );
    Ok(())
}

#[reducer]
pub fn complete_document_signature_request(
    ctx: &ReducerContext,
    organization_id: u64,
    request_id: u64,
    params: CompleteDocumentSignatureRequestParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document", "write")?;

    let req = ctx
        .db
        .document_signature_request()
        .id()
        .find(&request_id)
        .ok_or("Signature request not found")?;
    if req.organization_id != organization_id {
        return Err("Signature request does not belong to this organization".to_string());
    }
    if req.status != "pending" {
        return Err(format!(
            "signature request must be pending (got '{}')",
            req.status
        ));
    }

    let document_id = req.document_id;
    add_document_version(
        ctx,
        organization_id,
        document_id,
        AddDocumentVersionParams {
            file_name: params.file_name,
            file_size: params.file_size,
            mimetype: params.mimetype,
            url: params.url,
            checksum: params.checksum,
            changes_description: params
                .changes_description
                .or_else(|| Some("Signed copy from external TSP".to_string())),
        },
    )?;

    let version_id = ctx
        .db
        .document()
        .id()
        .find(&document_id)
        .and_then(|d: Document| d.current_version_id)
        .ok_or("signed version missing after add_document_version")?;

    let company_id = req.company_id;
    ctx.db
        .document_signature_request()
        .id()
        .update(DocumentSignatureRequest {
            status: "completed".to_string(),
            completed_version_id: Some(version_id),
            completed_at: Some(ctx.timestamp),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: params.metadata.or(req.metadata.clone()),
            ..req
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "document_signature_request",
            record_id: request_id,
            action: "UPDATE",
            old_values: Some("{\"status\":\"pending\"}".to_string()),
            new_values: Some(
                serde_json::json!({
                    "status": "completed",
                    "completed_version_id": version_id,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "status".to_string(),
                "completed_version_id".to_string(),
                "completed_at".to_string(),
            ],
            metadata: Some("{\"wave\":\"d\"}".to_string()),
        },
    );
    Ok(())
}

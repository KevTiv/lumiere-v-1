/// HR employee document vault — metadata + attachment references (no blob storage).
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::hr::pii::{document_purpose_requires_pii, PURPOSE_HR_ADMIN};
use crate::hr::relations::require_employee_in_scope;

// ── Tables ────────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = hr_employee_document,
    public,
    index(accessor = emp_doc_by_org, btree(columns = [organization_id])),
    index(accessor = emp_doc_by_company, btree(columns = [company_id])),
    index(accessor = emp_doc_by_employee, btree(columns = [employee_id]))
)]
pub struct HrEmployeeDocument {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub employee_id: u64,
    pub doc_type: String,
    pub attachment_id: String,
    /// general | tax_id | identity | payroll
    pub purpose: String,
    pub title: Option<String>,
    pub notes: Option<String>,
    pub active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateHrEmployeeDocumentParams {
    pub doc_type: String,
    pub attachment_id: String,
    pub purpose: String,
    pub title: Option<String>,
    pub notes: Option<String>,
    pub active: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct DeleteHrEmployeeDocumentParams {
    pub reason: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn normalize_purpose(purpose: &str) -> Result<String, String> {
    let p = purpose.trim().to_lowercase();
    match p.as_str() {
        "general" | "tax_id" | "identity" | "payroll" => Ok(p),
        _ => Err("purpose must be general, tax_id, identity, or payroll".to_string()),
    }
}

fn assert_document_purpose_permission(
    ctx: &ReducerContext,
    organization_id: u64,
    purpose: &str,
) -> Result<(), String> {
    if document_purpose_requires_pii(purpose) {
        check_permission(ctx, organization_id, "hr_employee", "view_pii")?;
    }
    Ok(())
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_hr_employee_document(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
    params: CreateHrEmployeeDocumentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee", "update")?;
    require_employee_in_scope(ctx, organization_id, company_id, employee_id)?;

    if params.doc_type.trim().is_empty() {
        return Err("doc_type cannot be empty".to_string());
    }
    if params.attachment_id.trim().is_empty() {
        return Err("attachment_id cannot be empty".to_string());
    }

    let purpose = normalize_purpose(&params.purpose)?;
    assert_document_purpose_permission(ctx, organization_id, &purpose)?;

    let row = ctx.db.hr_employee_document().insert(HrEmployeeDocument {
        id: 0,
        organization_id,
        company_id,
        employee_id,
        doc_type: params.doc_type.trim().to_string(),
        attachment_id: params.attachment_id.trim().to_string(),
        purpose: purpose.clone(),
        title: params.title,
        notes: params.notes,
        active: params.active,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_employee_document",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "employee_id": employee_id,
                    "doc_type": row.doc_type,
                    "purpose": purpose,
                    "attachment_id": row.attachment_id,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "doc_type".to_string(),
                "attachment_id".to_string(),
                "purpose".to_string(),
            ],
            metadata: Some(format!("hr_doc:{PURPOSE_HR_ADMIN}")),
        },
    );
    Ok(())
}

#[reducer]
pub fn delete_hr_employee_document(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
    document_id: u64,
    params: DeleteHrEmployeeDocumentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee", "update")?;
    require_employee_in_scope(ctx, organization_id, company_id, employee_id)?;

    let doc = ctx
        .db
        .hr_employee_document()
        .id()
        .find(&document_id)
        .ok_or("Employee document not found")?;
    if doc.organization_id != organization_id {
        return Err("Document belongs to a different organization".to_string());
    }
    if doc.company_id != company_id {
        return Err("Document does not belong to this company".to_string());
    }
    if doc.employee_id != employee_id {
        return Err("Document does not belong to this employee".to_string());
    }

    assert_document_purpose_permission(ctx, organization_id, &doc.purpose)?;

    ctx.db.hr_employee_document().id().delete(&document_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_employee_document",
            record_id: document_id,
            action: "DELETE",
            old_values: Some(
                serde_json::json!({
                    "doc_type": doc.doc_type,
                    "purpose": doc.purpose,
                    "attachment_id": doc.attachment_id,
                    "reason": params.reason,
                })
                .to_string(),
            ),
            new_values: None,
            changed_fields: vec!["active".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

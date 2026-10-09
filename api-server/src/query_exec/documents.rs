//! Document child and template resource reads.

use crate::error::ApiError;
use serde_json::Value;
use std::collections::BTreeSet;
use stdb_auth::{
    has_resource_read_permission, identity_sql_literal, resolve_http_sql_columns,
    FieldAccessContext,
};
use stdb_client::StdbClient;

use super::row_values::sort_rows_by_id_desc;

#[cfg(test)]
#[path = "documents_tests.rs"]
mod tests;

/// Child reads inherit the document permission, not a separately provisioned child grant.
pub(super) fn has_document_read_permission(field_access: Option<&FieldAccessContext>) -> bool {
    has_resource_read_permission(field_access, "documents")
        || field_access.is_some_and(|access| {
            access.role_permissions.iter().any(|permission| {
                matches!(
                    permission.as_str(),
                    "doc_document:read"
                        | "doc_document:*"
                        | "module:documents:read"
                        | "module:documents:*"
                )
            })
        })
}

fn document_child_table(resource: &str) -> Result<&'static str, ApiError> {
    match resource {
        "document-signature-requests" => Ok("document_signature_request"),
        "document-legal-holds" => Ok("document_legal_hold"),
        "document-external-refs" => Ok("document_external_ref"),
        _ => Err(ApiError::NotFound(format!(
            "Unknown document child resource: {resource}"
        ))),
    }
}

fn document_parent_sql(
    organization_id: u64,
    identity_hex: &str,
    field_access: Option<&FieldAccessContext>,
) -> Result<(String, String), ApiError> {
    if organization_id == 0 {
        return Err(ApiError::Unprocessable(
            "organization ID must be positive".into(),
        ));
    }
    let identity = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
    let access = field_access
        .filter(|access| access.organization_id == organization_id)
        .ok_or_else(|| {
            ApiError::Forbidden("Document read context does not match organization".into())
        })?;
    let context_identity =
        identity_sql_literal(&access.identity_hex).map_err(ApiError::Internal)?;
    if context_identity != identity || !has_document_read_permission(Some(access)) {
        return Err(ApiError::Forbidden(
            "Document read permission denied".into(),
        ));
    }
    // Match query_exec's live `documents` ACL, not creator/folder/share permissions.
    let sql = format!(
        "SELECT id, organization_id, owner_id, is_deleted FROM document WHERE organization_id = {organization_id} AND is_deleted = false AND owner_id = {identity}"
    );
    Ok((sql, identity))
}

// These relation columns are non-optional u64s. Do not accept Option wrappers,
// nulls, zero, lossy numbers, or conflicting camelCase/snake_case values.
fn document_row_id(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    fn parse(value: &Value) -> Option<u64> {
        let id = value.as_u64().or_else(|| {
            value
                .as_str()
                .filter(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))?
                .parse()
                .ok()
        })?;
        (id > 0).then_some(id)
    }
    match (row.get(camel), row.get(snake)) {
        (Some(a), Some(b)) => {
            let id = parse(a)?;
            (parse(b)? == id).then_some(id)
        }
        (Some(value), None) | (None, Some(value)) => parse(value),
        (None, None) => None,
    }
}

fn visible_document_ids(parents: &[Value], organization_id: u64, identity: &str) -> BTreeSet<u64> {
    parents
        .iter()
        .filter_map(|row| {
            if document_row_id(row, "organizationId", "organization_id") != Some(organization_id)
                || organization_id == 0
            {
                return None;
            }
            for key in ["isDeleted", "is_deleted"] {
                if row
                    .get(key)
                    .is_some_and(|value| value != &Value::Bool(false))
                {
                    return None;
                }
            }
            if row.get("isDeleted").or_else(|| row.get("is_deleted")) != Some(&Value::Bool(false)) {
                return None;
            }
            let owner = row
                .get("ownerId")
                .or_else(|| row.get("owner_id"))?
                .as_str()?;
            if identity_sql_literal(owner).ok().as_deref() != Some(identity) {
                return None;
            }
            if let Some(other) = row.get("owner_id") {
                if identity_sql_literal(other.as_str()?).ok().as_deref() != Some(identity) {
                    return None;
                }
            }
            document_row_id(row, "id", "id")
        })
        .collect()
}

fn document_child_sql(
    resource: &str,
    organization_id: u64,
    parent_ids: &[u64],
    field_access: Option<&FieldAccessContext>,
) -> Result<(String, bool), ApiError> {
    let table = document_child_table(resource)?;
    if organization_id == 0 || parent_ids.is_empty() || parent_ids.contains(&0) {
        return Err(ApiError::Unprocessable(
            "document child read requires positive organization and parent IDs".into(),
        ));
    }
    let mut columns =
        resolve_http_sql_columns(resource, field_access).map_err(ApiError::Internal)?;
    let strip_document_id = !columns.iter().any(|column| column == "document_id");
    if strip_document_id {
        // Internal relation validation must not override the browser's field projection.
        columns.push("document_id".into());
    }
    let parents = parent_ids
        .iter()
        .map(|id| format!("document_id = {id}"))
        .collect::<Vec<_>>()
        .join(" OR ");
    Ok((
        format!(
            "SELECT {} FROM {table} WHERE organization_id = {organization_id} AND ({parents})",
            columns.join(", ")
        ),
        strip_document_id,
    ))
}

fn filter_document_child_rows(
    rows: &mut Vec<Value>,
    organization_id: u64,
    parent_ids: &BTreeSet<u64>,
    strip_document_id: bool,
) {
    rows.retain(|row| {
        organization_id > 0
            && document_row_id(row, "organizationId", "organization_id") == Some(organization_id)
            && document_row_id(row, "documentId", "document_id")
                .is_some_and(|id| parent_ids.contains(&id))
    });
    if strip_document_id {
        for row in rows {
            if let Some(object) = row.as_object_mut() {
                object.remove("documentId");
                object.remove("document_id");
            }
        }
    }
}

/// Read child rows only for the actor's live documents in the selected organization.
/// No org-wide child query or full-row fallback is issued, including for superusers.
pub(super) async fn read_document_child_rows(
    client: &StdbClient,
    resource: &str,
    organization_id: u64,
    identity_hex: &str,
    field_access: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    document_child_table(resource)?;
    let (parent_sql, identity) = document_parent_sql(organization_id, identity_hex, field_access)?;
    let parents = client
        .query_sql(&parent_sql)
        .await
        .map_err(ApiError::internal)?;
    let visible_ids = visible_document_ids(&parents, organization_id, &identity);
    let parent_ids: Vec<_> = visible_ids.iter().copied().collect();
    let mut rows = Vec::new();
    // Equality/OR predicates are supported by STDB, unlike parent subqueries.
    // Bound predicate size without truncating the authorized document set.
    for ids in parent_ids.chunks(128) {
        let (sql, strip_document_id) =
            document_child_sql(resource, organization_id, ids, field_access)?;
        let mut children = client.query_sql(&sql).await.map_err(ApiError::internal)?;
        let batch_ids = ids.iter().copied().collect();
        filter_document_child_rows(
            &mut children,
            organization_id,
            &batch_ids,
            strip_document_id,
        );
        rows.extend(children);
    }
    sort_rows_by_id_desc(&mut rows);
    Ok(rows)
}

pub(super) async fn read_document_templates(
    client: &StdbClient,
    organization_id: u64,
) -> Result<Vec<Value>, ApiError> {
    let sql = format!(
        "SELECT id, organization_id, company_id, name, model, report_type, body_html, header_html, footer_html, variable_bindings_json, is_default, is_active, create_date, write_date, metadata FROM document_template WHERE organization_id = {organization_id}"
    );
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    sort_rows_by_id_desc(&mut rows);
    return Ok(rows);
}

pub(super) async fn read_mail_templates(
    client: &StdbClient,
    organization_id: u64,
) -> Result<Vec<Value>, ApiError> {
    let sql = format!(
        "SELECT id, organization_id, company_id, name, model, subject, body_html, document_template_id, attach_document, is_default, is_active, create_date, write_date, metadata FROM mail_template WHERE organization_id = {organization_id}"
    );
    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    sort_rows_by_id_desc(&mut rows);
    return Ok(rows);
}

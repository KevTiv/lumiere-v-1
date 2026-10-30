//! Read reducer-authored exclusion evidence only after current batch authorization.
use crate::{
    error::ApiError,
    query_exec::{execute_resource_query, resolve_membership_company_id},
    session::load_field_access_context,
    state::AppState,
    trusted_context::TrustedOperationContext,
    web_session::resolve_session,
};
use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, HeaderValue},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::BTreeSet, sync::Arc};
use stdb_auth::{
    has_resource_field_read_permission, has_resource_read_permission, FieldAccessContext,
};
use tower_cookies::Cookies;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ExclusionQuery {
    company_id: u64,
}

fn number(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    let parse = |value: &Value| value.as_u64().or_else(|| value.as_str()?.parse().ok());
    let a = row.get(camel);
    let b = row.get(snake);
    match (a, b) {
        (Some(a), Some(b)) if parse(a) == parse(b) => parse(a),
        (Some(value), None) | (None, Some(value)) => parse(value),
        _ => None,
    }
}
fn text<'a>(row: &'a Value, camel: &str, snake: &str) -> Option<&'a str> {
    row.get(camel).or_else(|| row.get(snake))?.as_str()
}

fn can_read(access: &FieldAccessContext) -> bool {
    has_resource_read_permission(Some(access), "message-batches")
        && ["metadata", "excluded_count"]
            .iter()
            .all(|field| has_resource_field_read_permission(Some(access), "message-batches", field))
}

fn captured_exclusions(batch: &Value, history: &[Value], org: u64, company: u64) -> Option<Value> {
    let id = number(batch, "id", "id").filter(|id| *id > 0)?;
    if number(batch, "organizationId", "organization_id") != Some(org)
        || number(batch, "companyId", "company_id") != Some(company)
    {
        return None;
    }
    let count = number(batch, "excludedCount", "excluded_count")?;
    let matches = history
        .iter()
        .filter(|row| {
            number(row, "organizationId", "organization_id") == Some(org)
                && number(row, "companyId", "company_id") == Some(company)
                && text(row, "resource", "resource") == Some("message_batch")
                && number(row, "recordId", "record_id") == Some(id)
                && text(row, "subjectResource", "subject_resource") == Some("message_batch")
                && number(row, "subjectRecordId", "subject_record_id") == Some(id)
                && number(row, "schemaVersion", "schema_version") == Some(1)
                && matches!(
                    text(row, "operation", "operation"),
                    Some("create_message_batch" | "create_invoice_reminder_batch")
                )
        })
        .collect::<Vec<_>>();
    let [capture] = matches.as_slice() else {
        return None;
    };
    let changes: Value =
        serde_json::from_str(text(capture, "changesJson", "changes_json")?).ok()?;
    let [change] = changes.as_array()?.as_slice() else {
        return None;
    };
    if change.get("field")?.as_str() != Some("exclusions") || change.get("before")? != &Value::Null
    {
        return None;
    }
    let exclusions: Value = serde_json::from_str(change.get("after")?.as_str()?).ok()?;
    let rows = exclusions.as_array()?;
    if rows.len() as u64 != count {
        return None;
    }
    let mut ids = BTreeSet::new();
    for row in rows {
        let model = row.get("model")?.as_str()?;
        if !matches!(model, "contact" | "account_move") {
            return None;
        }
        let record = number(row, "recordId", "recordId").filter(|id| *id > 0)?;
        if !ids.insert((model, record)) {
            return None;
        }
        let reason = row.get("reason")?.as_str()?;
        if !matches!(
            reason,
            "contact_inactive"
                | "channel_opted_out"
                | "no_eligible_primary_identity"
                | "invoice_unavailable"
                | "invoice_not_outstanding_posted_customer_invoice"
                | "invoice_has_no_contact"
                | "contact_unavailable"
        ) {
            return None;
        }
    }
    Some(exclusions)
}

pub(super) async fn get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(query): Query<ExclusionQuery>,
) -> Result<(HeaderMap, Json<Value>), ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    context.require_current_placement(&state.organization_placements)?;
    let org = context.organization_id();
    let actor = context.actor_identity();
    let company = query.company_id;
    if company == 0 || !can_read(context.field_access()) {
        return Err(ApiError::Forbidden(
            "Batch exclusion evidence permission denied".into(),
        ));
    }
    resolve_membership_company_id(
        context.client(),
        org,
        actor,
        Some(company),
        "Batch exclusion company denied",
    )
    .await?;
    let batches = execute_resource_query(
        context.client(),
        "message-batches",
        org,
        actor,
        Some(context.field_access()),
    )
    .await?;
    let mut output = Vec::new();
    for batch in &batches {
        if number(batch, "companyId", "company_id") != Some(company) {
            continue;
        }
        let Some(id) = number(batch, "id", "id").filter(|id| *id > 0) else {
            return Err(ApiError::Internal("Invalid message batch identity".into()));
        };
        // Private captured values are never queried through the interactive token.
        // Every returned source is authorized first, including company and fields.
        let sql=format!("SELECT organization_id, company_id, resource, record_id, subject_resource, subject_record_id, operation, schema_version, changes_json FROM business_change WHERE organization_id = {org} AND company_id = {company} AND resource = 'message_batch' AND record_id = {id}");
        let history = state
            .stdb
            .query_sql(&sql)
            .await
            .map_err(ApiError::internal)?;
        output.push(json!({"id":id.to_string(),"organizationId":org.to_string(),"companyId":company.to_string(),"exclusions":captured_exclusions(batch,&history,org,company)}));
    }
    let access = load_field_access_context(&state.stdb, actor, org)
        .await
        .map_err(ApiError::Internal)?
        .ok_or(ApiError::Unauthorized)?;
    if !can_read(&access) {
        return Err(ApiError::Forbidden("Batch evidence access changed".into()));
    }
    resolve_membership_company_id(
        context.client(),
        org,
        actor,
        Some(company),
        "Batch exclusion company denied",
    )
    .await?;
    context.require_current_placement(&state.organization_placements)?;
    let mut response_headers = HeaderMap::new();
    response_headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    Ok((response_headers, Json(json!({"data":output}))))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_metadata_and_forged_audit_are_not_captured_exclusion_evidence() {
        let exclusions = json!([{"model":"contact","recordId":"9007199254740993","contactId":"9007199254740993","reason":"channel_opted_out"}]);
        let batch = json!({"id":9,"organizationId":7,"companyId":12,"excludedCount":1,"metadata":json!({"batch_exclusions_v1":exclusions}).to_string()});
        assert_eq!(captured_exclusions(&batch, &[], 7, 12), None);
        let capture = json!({"organizationId":7,"companyId":12,"resource":"message_batch","recordId":9,"subjectResource":"message_batch","subjectRecordId":9,"operation":"create_message_batch","schemaVersion":1,"changesJson":json!([{"field":"exclusions","before":null,"after":exclusions.to_string()}]).to_string()});
        assert_eq!(
            captured_exclusions(&batch, &[capture.clone()], 7, 12),
            Some(exclusions)
        );
        let mut foreign = capture.clone();
        foreign["companyId"] = json!(13);
        assert_eq!(captured_exclusions(&batch, &[foreign], 7, 12), None);
        assert_eq!(
            captured_exclusions(&batch, &[capture.clone(), capture], 7, 12),
            None
        );
    }
}

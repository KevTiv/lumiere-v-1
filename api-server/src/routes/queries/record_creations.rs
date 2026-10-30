//! Exact actor/company-scoped recovery for atomic configurable creates.
//! This deliberately does not register a general receipt-table resource.

use crate::error::ApiError;
use crate::query_exec::{
    preserve_query_timestamp_precision, resolve_crm_company_id, resolve_sales_company_id,
};
use crate::state::AppState;
use crate::trusted_context::TrustedOperationContext;
use serde_json::{json, Value};
use stdb_auth::{has_resource_read_permission, identity_sql_literal, permission_allowed};

fn model(resource: &str) -> Option<(&'static str, &'static str, &'static str)> {
    match resource {
        "lead-creations" => Some(("crm_lead", "leads", "lead")),
        "opportunity-creations" => Some(("opportunity", "opportunities", "opportunity")),
        "contact-creations" => Some(("contact", "contacts", "contact")),
        "quotation-creations" => Some(("sale_order", "sale-orders", "sale_order")),
        _ => None,
    }
}

fn valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 128
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn exact_response(mut rows: Vec<Value>) -> Value {
    for row in &mut rows {
        for field in [
            "organizationId",
            "organization_id",
            "companyId",
            "company_id",
            "recordId",
            "record_id",
        ] {
            if let Some(value) = row.get_mut(field) {
                if let Some(id) = value.as_u64() {
                    *value = Value::String(id.to_string());
                }
            }
        }
    }
    preserve_query_timestamp_precision(&mut rows);
    json!({"data": rows})
}

pub(super) async fn read_record_creation(
    state: &AppState,
    context: &TrustedOperationContext,
    resource: &str,
    requested_company: Option<u64>,
    operation_key: Option<&str>,
) -> Result<Option<Value>, ApiError> {
    let Some((model, permission_resource, create_resource)) = model(resource) else {
        return Ok(None);
    };
    // Recovering one's own immutable create receipt is permitted to a creator
    // even when normal record-read permission was not granted. It reveals no
    // business content, only the exact result identity and fingerprint.
    let access = context.field_access();
    if !has_resource_read_permission(Some(access), permission_resource)
        && !permission_allowed(access, create_resource, "create")
    {
        return Err(ApiError::Forbidden(
            "Record creation recovery is not permitted".into(),
        ));
    }
    let key = operation_key.filter(|key| valid_key(key)).ok_or_else(|| {
        ApiError::BadRequest("A valid operationKey is required for creation recovery".into())
    })?;
    let company_id = if model == "sale_order" {
        resolve_sales_company_id(
            context.client(),
            context.organization_id(),
            context.actor_identity(),
            requested_company,
        )
        .await?
    } else {
        resolve_crm_company_id(
            context.client(),
            context.organization_id(),
            context.actor_identity(),
            requested_company,
        )
        .await?
    };
    let organization_id = context.organization_id();
    let actor = identity_sql_literal(context.actor_identity()).map_err(ApiError::Internal)?;
    let id = format!("{organization_id}:{company_id}:{model}:{key}");
    let sql = format!(
        "SELECT id, organization_id, company_id, model, operation_key, payload_hash, record_id, created_by, created_at FROM record_creation_receipt WHERE id = '{id}' AND organization_id = {organization_id} AND company_id = {company_id} AND model = '{model}' AND created_by = {actor}"
    );
    let data = state
        .stdb
        .query_sql(&sql)
        .await
        .map_err(ApiError::internal)?;
    context.require_current_placement(&state.organization_placements)?;
    Ok(Some(exact_response(data)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn recovery_wire_response_keeps_full_width_saved_identity_and_timestamp() {
        use axum::{body::to_bytes, response::IntoResponse, Json};
        let response = Json(exact_response(vec![json!({
            "id":"1:2:contact:attempt", "organizationId":1_u64,
            "companyId":9_007_199_254_740_995_u64,
            "recordId":9_007_199_254_740_993_u64,
            "createdAt":{"microsSinceUnixEpoch":9_007_199_254_740_993_i64}
        })]))
        .into_response();
        let bytes = to_bytes(response.into_body(), 16_384).await.unwrap();
        let decoded: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(decoded["data"][0]["recordId"], "9007199254740993");
        assert_eq!(decoded["data"][0]["companyId"], "9007199254740995");
        assert_eq!(decoded["data"][0]["organizationId"], "1");
        assert_eq!(
            decoded["data"][0]["createdAt"]["microsSinceUnixEpoch"],
            "9007199254740993"
        );
    }

    #[test]
    fn only_admitted_exact_resources_select_receipts() {
        assert_eq!(model("lead-creations"), Some(("crm_lead", "leads", "lead")));
        assert_eq!(
            model("quotation-creations"),
            Some(("sale_order", "sale-orders", "sale_order"))
        );
        assert!(model("record-creation-receipts").is_none());
        assert!(model("record_creation_receipt").is_none());
    }

    #[test]
    fn receipt_keys_cannot_broaden_the_fixed_owner_query() {
        assert!(valid_key("attempt-123_abc"));
        for key in ["", "' OR 1=1", "abc:other", "a/b", "a b"] {
            assert!(!valid_key(key));
        }
        assert!(!valid_key(&"x".repeat(129)));
    }
}

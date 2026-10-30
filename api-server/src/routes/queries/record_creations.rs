//! Exact actor/company-scoped recovery for atomic configurable creates.
//! This deliberately does not register a general receipt-table resource.

use crate::error::ApiError;
use crate::query_exec::{
    preserve_query_timestamp_precision, resolve_crm_company_id, resolve_sales_company_id,
};
use crate::session::load_field_access_context;
use crate::state::AppState;
use crate::trusted_context::TrustedOperationContext;
use serde_json::{json, Value};
use stdb_auth::{
    has_resource_read_permission, identity_sql_literal, permission_allowed, FieldAccessContext,
};
use stdb_client::StdbClient;

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
    let data = read_authorized_record_creation(
        &state.stdb,
        context,
        resource,
        requested_company,
        operation_key,
    )
    .await?;
    context.require_current_placement(&state.organization_placements)?;
    Ok(data)
}

fn require_receipt_access(
    access: &FieldAccessContext,
    organization_id: u64,
    permission_resource: &str,
    create_resource: &str,
) -> Result<(), ApiError> {
    if access.organization_id != organization_id
        || (!has_resource_read_permission(Some(access), permission_resource)
            && !permission_allowed(access, create_resource, "create"))
    {
        return Err(ApiError::Forbidden(
            "Record creation recovery is not permitted".into(),
        ));
    }
    Ok(())
}

async fn receipt_company(
    context: &TrustedOperationContext,
    model: &str,
    requested_company: Option<u64>,
) -> Result<u64, ApiError> {
    if model == "sale_order" {
        resolve_sales_company_id(
            context.client(),
            context.organization_id(),
            context.actor_identity(),
            requested_company,
        )
        .await
    } else {
        resolve_crm_company_id(
            context.client(),
            context.organization_id(),
            context.actor_identity(),
            requested_company,
        )
        .await
    }
}

async fn read_authorized_record_creation(
    owner: &StdbClient,
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
    let organization_id = context.organization_id();
    require_receipt_access(
        context.field_access(),
        organization_id,
        permission_resource,
        create_resource,
    )?;
    let key = operation_key.filter(|key| valid_key(key)).ok_or_else(|| {
        ApiError::BadRequest("A valid operationKey is required for creation recovery".into())
    })?;
    let company_id = receipt_company(context, model, requested_company).await?;
    let actor = identity_sql_literal(context.actor_identity()).map_err(ApiError::Internal)?;
    let id = format!("{organization_id}:{company_id}:{model}:{key}");
    let sql = format!(
        "SELECT id, organization_id, company_id, model, operation_key, payload_hash, record_id, created_by, created_at FROM record_creation_receipt WHERE id = '{id}' AND organization_id = {organization_id} AND company_id = {company_id} AND model = '{model}' AND created_by = {actor}"
    );
    let data = owner.query_sql(&sql).await.map_err(ApiError::internal)?;
    // Owner-token data must not outlive current actor/company authorization.
    // This is the final authorization snapshot across independent native reads.
    let current_access =
        load_field_access_context(owner, context.actor_identity(), organization_id)
            .await
            .map_err(ApiError::Internal)?
            .ok_or_else(|| ApiError::Forbidden("Record creation recovery access changed".into()))?;
    require_receipt_access(
        &current_access,
        organization_id,
        permission_resource,
        create_resource,
    )?;
    receipt_company(context, model, Some(company_id)).await?;
    Ok(Some(exact_response(data)))
}

#[cfg(test)]
mod tests {
    use super::super::read_reauthorization_test::{fixture, Revocation, Source};
    use super::*;

    fn private_receipt() -> Value {
        json!({"id":"42:7:contact:attempt","organization_id":42,"company_id":7,"model":"contact","operation_key":"attempt",
            "record_id":9_007_199_254_740_993_u64,"payload_hash":format!("sha256:{}","b".repeat(64)),"created_by":{"__identity__":format!("0x{}","ab".repeat(32))},"created_at":{"microsSinceUnixEpoch":9_007_199_254_740_993_i64}})
    }

    #[tokio::test]
    async fn current_creator_can_recover_exact_identity_without_record_read_permission() {
        let fixture = fixture(
            Source::CreationReceipt {
                rows: vec![private_receipt()],
            },
            Revocation::None,
        )
        .await;
        let data = read_authorized_record_creation(
            &fixture.owner,
            &fixture.context,
            "contact-creations",
            Some(7),
            Some("attempt"),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(data["data"][0]["recordId"], "9007199254740993");
        assert_eq!(data["data"][0]["companyId"], "7");
        let queries = fixture.queries.lock().unwrap();
        let source = queries
            .iter()
            .position(|sql| sql.contains(" FROM record_creation_receipt "))
            .unwrap();
        let refreshed = queries
            .iter()
            .position(|sql| sql.contains(" FROM user_profile "))
            .unwrap();
        assert!(source < refreshed);
        assert!(queries
            .iter()
            .skip(refreshed + 1)
            .any(|sql| sql.contains(" FROM user_organization ")));
    }

    async fn rejects_changed_recovery_authority(revocation: Revocation) {
        let fixture = fixture(
            Source::CreationReceipt {
                rows: vec![private_receipt()],
            },
            revocation,
        )
        .await;
        assert!(matches!(
            read_authorized_record_creation(
                &fixture.owner,
                &fixture.context,
                "contact-creations",
                Some(7),
                Some("attempt")
            )
            .await,
            Err(ApiError::Forbidden(_))
        ));
        let queries = fixture.queries.lock().unwrap();
        assert!(
            queries
                .iter()
                .any(|sql| sql.contains(" FROM record_creation_receipt ")),
            "fixture must revoke after the private source was read"
        );
        assert!(queries
            .iter()
            .any(|sql| sql.contains(" FROM user_profile ")));
    }

    #[tokio::test]
    async fn late_creator_permission_revocation_hides_the_private_receipt() {
        rejects_changed_recovery_authority(Revocation::ResourcePermission).await;
    }

    #[tokio::test]
    async fn late_membership_revocation_hides_the_private_receipt() {
        rejects_changed_recovery_authority(Revocation::Membership).await;
    }

    #[tokio::test]
    async fn late_company_reassignment_hides_the_original_company_receipt() {
        rejects_changed_recovery_authority(Revocation::Company).await;
    }

    #[tokio::test]
    async fn late_actor_deactivation_hides_the_private_receipt() {
        rejects_changed_recovery_authority(Revocation::InactiveProfile).await;
    }

    #[tokio::test]
    async fn unavailable_current_policy_never_exposes_receipts_using_stale_grants() {
        let fixture = fixture(
            Source::CreationReceipt {
                rows: vec![private_receipt()],
            },
            Revocation::AuthorityUnavailable,
        )
        .await;
        assert!(matches!(
            read_authorized_record_creation(
                &fixture.owner,
                &fixture.context,
                "contact-creations",
                Some(7),
                Some("attempt")
            )
            .await,
            Err(ApiError::Internal(_))
        ));
    }

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

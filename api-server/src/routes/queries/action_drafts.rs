//! Exact, currently authorized readback of a proposed or reviewed AI effect.
//!
//! The draft table remains outside the generic registry. This bounded adapter
//! extends the existing exact-record route without changing inbox visibility.

use crate::error::ApiError;
use crate::query_exec::{
    preserve_query_timestamp_precision, resolve_membership_company_id, row_u64,
};
use crate::session::{load_field_access_context, parse_stdb_identity_hex};
use crate::trusted_context::TrustedOperationContext;
use serde_json::Value;
use stdb_auth::{
    has_resource_field_read_permission, has_resource_read_permission, permission_allowed,
    FieldAccessContext,
};
use stdb_client::StdbClient;

const RESOURCE: &str = "ai_action_draft";
const COLUMNS: &[&str] = &[
    "id",
    "organization_id",
    "company_id",
    "status",
    "reducer_name",
    "params_json",
    "summary",
    "confidence",
    "elevated",
    "warnings_json",
    "source_query",
    "ui_context_json",
    "proposed_by",
    "reviewed_by",
    "reviewed_at",
    "reject_reason",
    "executed_at",
    "execution_error",
    "execution_record_id",
    "expires_at",
    "create_date",
    "write_date",
    "metadata",
];

fn not_found() -> ApiError {
    ApiError::NotFound("Authoritative resource not found".into())
}

fn require_read(access: &FieldAccessContext, organization_id: u64) -> Result<(), ApiError> {
    if access.organization_id != organization_id
        || !has_resource_read_permission(Some(access), RESOURCE)
    {
        return Err(not_found());
    }
    // This fixed snapshot cannot silently turn masked values into defaults.
    // Normalize the route alias for field evaluation; do not add a public
    // registry entry or infer a read grant from permission to approve.
    let mut fields = access.clone();
    for rule in &mut fields.field_permissions {
        if matches!(
            rule.resource.as_str(),
            "ai-action-drafts" | "ai_action_drafts" | "ai-action-draft"
        ) {
            rule.resource = RESOURCE.into();
        }
    }
    if COLUMNS
        .iter()
        .any(|field| !has_resource_field_read_permission(Some(&fields), RESOURCE, field))
    {
        return Err(not_found());
    }
    Ok(())
}

fn identity_matches(value: Option<&Value>, actor: &str) -> bool {
    let Some(value) = value else {
        return false;
    };
    let identity = value
        .as_str()
        .or_else(|| value.get("__identity__").and_then(Value::as_str));
    identity.and_then(parse_stdb_identity_hex).as_deref() == Some(actor)
        || value
            .get("some")
            .is_some_and(|nested| identity_matches(Some(nested), actor))
}

fn row_visible(row: &Value, actor: &str, access: &FieldAccessContext) -> bool {
    identity_matches(
        row.get("proposedBy").or_else(|| row.get("proposed_by")),
        actor,
    ) || identity_matches(
        row.get("reviewedBy").or_else(|| row.get("reviewed_by")),
        actor,
    ) || (row.get("status").and_then(Value::as_str) == Some("pending")
        && permission_allowed(access, RESOURCE, "write"))
}

fn require_exact_row(row: &Value, org: u64, company: u64, id: u64) -> Result<(), ApiError> {
    for (camel, snake, expected) in [
        ("id", "id", id),
        ("organizationId", "organization_id", org),
        ("companyId", "company_id", company),
    ] {
        if row_u64(row, camel, snake).ok().flatten() != Some(expected) {
            return Err(not_found());
        }
    }
    Ok(())
}

pub(super) async fn read(
    owner: &StdbClient,
    context: &TrustedOperationContext,
    requested_company: u64,
    id: u64,
) -> Result<Value, ApiError> {
    let org = context.organization_id();
    if requested_company == 0 || id == 0 {
        return Err(not_found());
    }
    require_read(context.field_access(), org)?;
    let actor = parse_stdb_identity_hex(context.actor_identity()).ok_or_else(not_found)?;
    let company = resolve_membership_company_id(
        context.client(),
        org,
        &actor,
        Some(requested_company),
        "Cannot read another company's AI action draft",
    )
    .await?;
    let sql = format!(
        "SELECT {} FROM ai_action_draft WHERE organization_id = {org} AND company_id = {company} AND id = {id} LIMIT 2",
        COLUMNS.join(", "),
    );
    let mut rows = context
        .client()
        .query_sql(&sql)
        .await
        .map_err(ApiError::internal)?;
    let [row] = rows.as_slice() else {
        return Err(not_found());
    };
    require_exact_row(row, org, company, id)?;
    if !row_visible(row, &actor, context.field_access()) {
        return Err(not_found());
    }
    let current = load_field_access_context(owner, &actor, org)
        .await
        .map_err(ApiError::Internal)?
        .ok_or_else(not_found)?;
    require_read(&current, org)?;
    if !row_visible(row, &actor, &current) {
        return Err(not_found());
    }
    resolve_membership_company_id(
        context.client(),
        org,
        &actor,
        Some(company),
        "Cannot read another company's AI action draft",
    )
    .await?;
    for row in &mut rows {
        for field in [
            "id",
            "organizationId",
            "organization_id",
            "companyId",
            "company_id",
            "executionRecordId",
            "execution_record_id",
        ] {
            if let Some(value) = row.get_mut(field) {
                if let Some(exact) = value.as_u64() {
                    *value = Value::String(exact.to_string());
                }
            }
        }
    }
    preserve_query_timestamp_precision(&mut rows);
    rows.pop().ok_or_else(not_found)
}

#[cfg(test)]
mod tests {
    use super::super::read_reauthorization_test::{fixture, Revocation, Source};
    use super::*;
    use serde_json::json;

    fn row() -> Value {
        json!({"id":9,"organization_id":42,"company_id":7,"status":"approved", "reducer_name":"create_task", "params_json":"{}", "execution_record_id":9007199254740993u64,
            "proposed_by":{"__identity__":format!("0x{}", "cd".repeat(32))}, "reviewed_by":{"some":{"__identity__":format!("0x{}", "ab".repeat(32))}}})
    }

    #[tokio::test]
    async fn exact_terminal_readback_preserves_effect_identity_for_independent_reviewer() {
        let fixture = fixture(Source::ActionDraft { row: row() }, Revocation::None).await;
        let result = read(&fixture.owner, &fixture.context, 7, 9).await.unwrap();
        assert_eq!(result["status"], "approved");
        assert_eq!(result["id"], "9");
        assert_eq!(result["executionRecordId"], "9007199254740993");
        assert!(fixture
            .queries
            .lock()
            .unwrap()
            .iter()
            .all(|sql| !sql.contains("ORDER BY")));
    }

    #[tokio::test]
    async fn terminal_readback_rechecks_current_resource_fields_membership_and_profile() {
        for revocation in [
            Revocation::ResourcePermission,
            Revocation::DraftFields,
            Revocation::Membership,
            Revocation::Company,
            Revocation::InactiveProfile,
            Revocation::AuthorityUnavailable,
        ] {
            let fixture = fixture(Source::ActionDraft { row: row() }, revocation).await;
            assert!(read(&fixture.owner, &fixture.context, 7, 9).await.is_err());
        }
    }

    #[tokio::test]
    async fn other_company_and_other_actors_terminal_draft_remain_unavailable() {
        let foreign_company = fixture(Source::ActionDraft { row: row() }, Revocation::None).await;
        assert!(read(&foreign_company.owner, &foreign_company.context, 8, 9)
            .await
            .is_err());
        assert!(!foreign_company
            .queries
            .lock()
            .unwrap()
            .iter()
            .any(|sql| sql.contains(" FROM ai_action_draft ")));
        let mut foreign = row();
        foreign["reviewed_by"] = Value::Null;
        let fixture = fixture(Source::ActionDraft { row: foreign }, Revocation::None).await;
        assert!(read(&fixture.owner, &fixture.context, 7, 9).await.is_err());
    }

    #[test]
    fn pending_review_and_terminal_visibility_require_current_authority() {
        let mut access = FieldAccessContext {
            organization_id: 42,
            role_id: 1,
            role_permissions: vec!["ai_action_draft:read".into()],
            ..FieldAccessContext::default()
        };
        let actor = "ab".repeat(32);
        assert!(require_read(&access, 42).is_ok());
        assert!(require_read(&access, 43).is_err());
        let mut pending = row();
        pending["reviewed_by"] = Value::Null;
        pending["status"] = json!("pending");
        assert!(!row_visible(&pending, &actor, &access));
        access.role_permissions.push("ai_action_draft:write".into());
        assert!(row_visible(&pending, &actor, &access));
        pending["status"] = json!("approved");
        assert!(!row_visible(&pending, &actor, &access));
        access.role_permissions = vec!["ai_action_draft:write".into()];
        assert!(require_read(&access, 42).is_err());
    }

    #[test]
    fn field_restrictions_never_become_an_unmasked_draft_snapshot() {
        for resource in [RESOURCE, "ai-action-drafts", "ai_action_drafts"] {
            let mut access = FieldAccessContext {
                organization_id: 42,
                role_id: 1,
                role_permissions: vec!["ai_action_draft:read".into()],
                ..FieldAccessContext::default()
            };
            access.field_permissions.push(
                serde_json::from_value(json!({
                    "organizationId":42,"roleId":1,"resource":resource,
                    "action":"read","allowedFields":["status"]
                }))
                .unwrap(),
            );
            assert!(require_read(&access, 42).is_err());
        }
    }

    #[test]
    fn exact_response_rejects_foreign_or_ambiguous_scope() {
        assert!(require_exact_row(&row(), 42, 7, 9).is_ok());
        for (org, company, id) in [(43, 7, 9), (42, 8, 9), (42, 7, 10)] {
            assert!(require_exact_row(&row(), org, company, id).is_err());
        }
    }
}

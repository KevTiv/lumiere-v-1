//! Invalidation-only owner subscriptions for private workflow assignments.
//! Queries are fixed here and run on a separate bridge from ordinary actor SQL.

use std::collections::BTreeSet;

use serde_json::{json, Value};
use stdb_auth::{has_resource_read_permission, identity_sql_literal};
use stdb_client::StdbClient;

use crate::auth_password::identity_cell_to_hex;
use crate::error::ApiError;
use crate::session::normalize_identity_hex_for_sql;
use crate::trusted_context::TrustedOperationContext;

use super::workflow_tables::WORKFLOW_INVALIDATION_TABLES;

pub(super) fn resource_table(resource: &str) -> Option<&'static str> {
    WORKFLOW_INVALIDATION_TABLES
        .iter()
        .find_map(|(key, table)| (*key == resource).then_some(*table))
}

/// Per-table invalidations keep workflow task changes separate from authority
/// changes. No private record, actor, principal or source value is forwarded.
pub(super) fn callback_resources(table: &str, fallback: &[String]) -> Vec<String> {
    WORKFLOW_INVALIDATION_TABLES
        .iter()
        .find_map(|(key, candidate)| (*candidate == table).then(|| vec![(*key).into()]))
        .unwrap_or_else(|| fallback.to_vec())
}

pub(super) fn subscription_queries(
    resources: &[String],
    organization_id: u64,
    company_id: u64,
) -> Result<Vec<String>, ApiError> {
    if organization_id == 0 || company_id == 0 {
        return Err(ApiError::Forbidden(
            "workflow subscription requires exact scope".into(),
        ));
    }
    let mut tables = BTreeSet::new();
    for resource in resources {
        let table = resource_table(resource)
            .ok_or_else(|| ApiError::BadRequest("unsupported private workflow resource".into()))?;
        tables.insert(table);
    }
    Ok(tables.into_iter().map(|table| {
        format!("SELECT * FROM {table} WHERE organization_id = {organization_id} AND company_id = {company_id}")
    }).collect())
}

pub(super) async fn require_current_scope(
    owner: &StdbClient,
    context: &TrustedOperationContext,
    company: u64,
) -> Result<(), ApiError> {
    let org = context.organization_id();
    let access = context.field_access();
    if org == 0
        || company == 0
        || access.organization_id != org
        || !has_resource_read_permission(Some(access), "workflows")
    {
        return Err(ApiError::Forbidden(
            "workflow subscription permission denied".into(),
        ));
    }
    let actor = normalize_identity_hex_for_sql(context.actor_identity());
    let identity = identity_sql_literal(&actor).map_err(ApiError::Internal)?;
    // These are bounded exact reads. Role/field permissions come from the
    // freshly authenticated common session context, never client parameters.
    let organization_sql =
        format!("SELECT id, is_active FROM organization WHERE id = {org} LIMIT 2");
    let company_sql = format!("SELECT id, organization_id, deleted_at FROM company WHERE organization_id = {org} AND id = {company} LIMIT 2");
    let profile_sql = format!("SELECT identity, organization_id, is_active, is_superuser FROM user_profile WHERE organization_id = {org} AND identity = {identity} LIMIT 2");
    let membership_sql = format!("SELECT user_identity, organization_id, company_id, is_active FROM user_organization WHERE organization_id = {org} AND user_identity = {identity} AND is_active = true LIMIT 2");
    let (organizations, companies, profiles, memberships) = tokio::try_join!(
        owner.query_sql(&organization_sql),
        owner.query_sql(&company_sql),
        owner.query_sql(&profile_sql),
        owner.query_sql(&membership_sql),
    )
    .map_err(ApiError::internal)?;
    if current_scope_matches(
        org,
        company,
        &actor,
        access.is_superuser,
        &organizations,
        &companies,
        &profiles,
        &memberships,
    ) {
        Ok(())
    } else {
        Err(ApiError::Forbidden(
            "workflow subscription company access denied".into(),
        ))
    }
}

fn cell<'a>(row: &'a Value, camel: &str, snake: &str) -> Option<&'a Value> {
    row.get(camel).or_else(|| row.get(snake))
}

fn number(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    cell(row, camel, snake)
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
}

fn active(row: &Value) -> bool {
    cell(row, "isActive", "is_active").and_then(Value::as_bool) == Some(true)
}

fn identity_matches(row: &Value, camel: &str, snake: &str, actor: &str) -> bool {
    cell(row, camel, snake)
        .and_then(identity_cell_to_hex)
        .is_some_and(|identity| normalize_identity_hex_for_sql(&identity) == actor)
}

#[allow(clippy::too_many_arguments)]
fn current_scope_matches(
    org: u64,
    company: u64,
    actor: &str,
    expected_superuser: bool,
    organizations: &[Value],
    companies: &[Value],
    profiles: &[Value],
    memberships: &[Value],
) -> bool {
    let ([organization], [company_row], [profile]) = (organizations, companies, profiles) else {
        return false;
    };
    if number(organization, "id", "id") != Some(org)
        || !active(organization)
        || number(company_row, "id", "id") != Some(company)
        || number(company_row, "organizationId", "organization_id") != Some(org)
        || !cell(company_row, "deletedAt", "deleted_at").is_some_and(Value::is_null)
        || number(profile, "organizationId", "organization_id") != Some(org)
        || !identity_matches(profile, "identity", "identity", actor)
        || !active(profile)
        || cell(profile, "isSuperuser", "is_superuser").and_then(Value::as_bool)
            != Some(expected_superuser)
    {
        return false;
    }
    // Preserve the native workflow policy's explicit current-profile bypass.
    if expected_superuser {
        return true;
    }
    let [membership] = memberships else {
        return false;
    };
    number(membership, "organizationId", "organization_id") == Some(org)
        && identity_matches(membership, "userIdentity", "user_identity", actor)
        && active(membership)
        && cell(membership, "companyId", "company_id").is_some_and(|value| {
            value.is_null()
                || value.as_u64().or_else(|| value.as_str()?.parse().ok()) == Some(company)
        })
}

/// Reconnect through common session authorization after an authority change.
/// Rebuild the notice from finite metadata rather than forwarding private rows.
pub(super) fn authority_refresh_notice(message: &Value) -> Option<String> {
    if message.get("type")?.as_str()? != "change" {
        return None;
    }
    let table = message.get("table")?.as_str()?;
    if !matches!(
        table,
        "organization"
            | "company"
            | "user_profile"
            | "user_organization"
            | "user_role_assignment"
            | "role"
            | "org_permission"
            | "field_permission"
            | "sod_conflict_rule"
            | "policy_snapshot"
            | "delegated_admin_scope"
            | "workflow_candidate_group_member"
            | "workflow_delegation"
    ) {
        return None;
    }
    let op = message.get("op")?.as_str()?;
    if !matches!(op, "insert" | "update" | "delete") {
        return None;
    }
    Some(json!({
        "type":"change", "op":op, "table":table,
        "resources":["auth", "workflow-human-tasks", "workflow-candidate-group-members", "workflow-delegations"]
    }).to_string())
}

#[cfg(test)]
mod tests;

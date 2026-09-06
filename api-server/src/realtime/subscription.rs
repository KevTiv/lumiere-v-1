//! Realtime request validation, authorization, and subscription SQL planning.

use std::collections::HashSet;

use serde::Deserialize;
use stdb_auth::{
    full_client_subscription_resources_vec, has_resource_read_permission,
    subscription_resource_keys_vec, FieldAccessContext,
};

use crate::error::ApiError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ClientSubscribe {
    pub(super) resources: Vec<String>,
    pub(super) organization_id: u64,
    #[serde(default)]
    pub(super) company_ids: Vec<u64>,
    #[serde(default)]
    pub(super) active_company_id: Option<u64>,
}

pub(super) fn parse_tables_from_sql(sql: &str) -> HashSet<String> {
    let mut out = HashSet::new();
    let lower = sql.to_ascii_lowercase();
    let mut rest = lower.as_str();
    while let Some(idx) = rest.find("from ") {
        rest = &rest[idx + 5..];
        rest = rest.trim_start();
        let name: String = rest
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
            .collect();
        if !name.is_empty() {
            out.insert(name);
        }
    }
    out
}

/// SpacetimeDB subscriptions must return complete table rows. The bridge
/// consumes those rows internally and emits invalidations, never row payloads.
pub(super) fn subscription_select_all(sql: &str) -> Result<String, ApiError> {
    let from = sql
        .find(" FROM ")
        .ok_or_else(|| ApiError::BadRequest("subscription SQL has no FROM clause".into()))?;
    let table_scope = &sql[from..];
    let table_scope = table_scope
        .split_once(" ORDER BY ")
        .map_or(table_scope, |(scope, _)| scope);
    Ok(format!("SELECT *{table_scope}"))
}

pub(super) fn validate_resources(requested: &[String]) -> Result<(), ApiError> {
    let mut allowed: HashSet<String> = subscription_resource_keys_vec()
        .into_iter()
        .chain(full_client_subscription_resources_vec())
        .collect();
    allowed.extend(
        crate::cold_tier::read_descriptor::subscription_resource_keys()
            .map_err(ApiError::internal)?,
    );
    for r in requested {
        let t = r.trim();
        if t.is_empty() || !allowed.contains(t) {
            return Err(ApiError::BadRequest(format!(
                "Unknown or disallowed realtime resource: {t}"
            )));
        }
    }
    Ok(())
}

fn bootstrap_realtime_resource(resource: &str) -> bool {
    matches!(
        resource,
        "auth"
            | "user-profile"
            | "user-role-assignment"
            | "auth-role-table"
            | "user-organization"
            | "field-permissions"
            | "org-permissions"
            | "policy-snapshots"
            | "roles"
            | "user-roles"
            | "form-configuration"
    )
}

pub(super) fn authorized_resources(
    requested: &[String],
    field_access: Option<&FieldAccessContext>,
) -> Result<Vec<String>, ApiError> {
    validate_resources(requested)?;
    Ok(requested
        .iter()
        .map(|resource| resource.trim())
        .filter(|resource| {
            bootstrap_realtime_resource(resource)
                || has_resource_read_permission(field_access, resource)
        })
        .map(str::to_owned)
        .collect())
}

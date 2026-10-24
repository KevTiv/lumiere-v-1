//! Minimal company-scoped directory for the existing project-task assignment command.
//! The general membership endpoint remains self-only.

use crate::auth_password::identity_cell_to_hex;
use crate::error::ApiError;
use crate::query_exec::{
    execute_authorized_resource_record, resolve_membership_company_id, row_u64,
};
use crate::trusted_context::TrustedOperationContext;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
use stdb_auth::{
    has_resource_read_permission, identity_sql_literal, permission_allowed,
    resolve_http_sql_columns,
};
use stdb_client::StdbClient;

const DIRECTORY_LIMIT: usize = 2_000;

fn active(row: &Value) -> bool {
    row.get("isActive")
        .or_else(|| row.get("is_active"))
        .and_then(Value::as_bool)
        == Some(true)
}

fn identity(row: &Value, camel: &str, snake: &str) -> Option<String> {
    let hex = identity_cell_to_hex(row.get(camel).or_else(|| row.get(snake))?)?;
    identity_sql_literal(&hex).ok()?;
    Some(hex)
}

pub(super) fn eligible_identities(
    memberships: &[Value],
    org_id: u64,
    company_id: u64,
) -> HashSet<String> {
    memberships
        .iter()
        .filter_map(|row| {
            if !active(row)
                || row_u64(row, "organizationId", "organization_id")
                    .ok()
                    .flatten()
                    != Some(org_id)
            {
                return None;
            }
            // A missing column is not proof of an organization-wide membership.
            row.get("companyId").or_else(|| row.get("company_id"))?;
            match row_u64(row, "companyId", "company_id") {
                Ok(None) => {}
                Ok(Some(id)) if id == company_id => {}
                _ => return None,
            }
            identity(row, "userIdentity", "user_identity")
        })
        .collect()
}

fn directory_rows(
    profiles: &[Value],
    eligible: &HashSet<String>,
    org_id: u64,
    include_name: bool,
) -> Vec<Value> {
    let mut people = BTreeMap::new();
    for profile in profiles {
        if !active(profile)
            || row_u64(profile, "organizationId", "organization_id")
                .ok()
                .flatten()
                != Some(org_id)
        {
            continue;
        }
        let Some(id) = identity(profile, "identity", "identity") else {
            continue;
        };
        if !eligible.contains(&id) {
            continue;
        }
        let name = include_name
            .then(|| profile.get("name").and_then(Value::as_str))
            .flatten()
            .unwrap_or("")
            .trim();
        people.insert(id.clone(), json!({"id": id, "name": name}));
    }
    people.into_values().collect()
}

pub(super) async fn read_task_assignees(
    owner: &StdbClient,
    context: &TrustedOperationContext,
    company_id: Option<u64>,
    task_id: Option<u64>,
) -> Result<Vec<Value>, ApiError> {
    let access = context.field_access();
    if !has_resource_read_permission(Some(access), "tasks")
        || !permission_allowed(access, "project_task", "write")
    {
        return Err(ApiError::Forbidden(
            "Task assignment permission is required".into(),
        ));
    }
    if !resolve_http_sql_columns("tasks", Some(access))
        .map_err(ApiError::Internal)?
        .iter()
        .any(|column| column == "user_ids")
    {
        return Err(ApiError::Forbidden(
            "Task assignment read access is required".into(),
        ));
    }
    let requested_company = company_id
        .filter(|id| *id > 0)
        .ok_or_else(|| ApiError::BadRequest("companyId is required for task assignees".into()))?;
    let org_id = context.organization_id();
    let company = resolve_membership_company_id(
        context.client(),
        org_id,
        context.actor_identity(),
        Some(requested_company),
        "Cannot assign tasks in another company",
    )
    .await?;
    if !crate::workflow_reads::allowed_company_ids(owner, org_id, Some(access))
        .await?
        .contains(&company)
    {
        return Err(ApiError::Forbidden(
            "Task assignment company access denied".into(),
        ));
    }
    if let Some(task) = task_id {
        if task == 0 {
            return Err(ApiError::BadRequest("Invalid taskId".into()));
        }
        if execute_authorized_resource_record(
            context.client(),
            "tasks",
            org_id,
            company,
            task,
            Some(access),
        )
        .await?
        .is_none()
        {
            return Err(ApiError::NotFound("Task not found in this company".into()));
        }
    }
    let memberships = owner.query_sql(&format!(
        "SELECT user_identity, organization_id, company_id, is_active FROM user_organization WHERE organization_id = {org_id} AND is_active = true LIMIT {}", DIRECTORY_LIMIT + 1,
    )).await.map_err(ApiError::internal)?;
    if memberships.len() > DIRECTORY_LIMIT {
        return Err(ApiError::Unavailable(
            "The task assignment directory exceeds the supported size".into(),
        ));
    }
    let eligible = eligible_identities(&memberships, org_id, company);
    if eligible.is_empty() {
        return Ok(vec![]);
    }
    // Read only assignment identity and a permitted display name; never profile details.
    let include_name = resolve_http_sql_columns("user-profile", Some(access))
        .map_err(ApiError::Internal)?
        .iter()
        .any(|column| column == "name");
    let columns = if include_name {
        "identity, organization_id, is_active, name"
    } else {
        "identity, organization_id, is_active"
    };
    let mut predicates = eligible
        .iter()
        .map(|id| identity_sql_literal(id).map(|literal| format!("identity = {literal}")))
        .collect::<Result<Vec<_>, _>>()
        .map_err(ApiError::Internal)?;
    predicates.sort();
    let profiles = owner.query_sql(&format!(
        "SELECT {columns} FROM user_profile WHERE organization_id = {org_id} AND is_active = true AND ({}) LIMIT {}", predicates.join(" OR "), DIRECTORY_LIMIT + 1,
    )).await.map_err(ApiError::internal)?;
    if profiles.len() > DIRECTORY_LIMIT {
        return Err(ApiError::Unavailable(
            "The task assignment directory exceeds the supported size".into(),
        ));
    }
    Ok(directory_rows(&profiles, &eligible, org_id, include_name))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn member(id: &str, org: u64, company: Value, active: bool) -> Value {
        json!({"userIdentity": id, "organizationId": org, "companyId": company, "isActive": active})
    }

    #[test]
    fn directory_requires_active_membership_and_exact_scope() {
        let a = "a".repeat(64);
        let b = "b".repeat(64);
        let c = "c".repeat(64);
        let rows = vec![
            member(&a, 1, json!(7), true),
            member(&a, 1, json!(7), true),
            member(&b, 1, Value::Null, true),
            member(&c, 2, json!(7), true),
            member(&c, 1, json!(8), true),
            member(&c, 1, json!(7), false),
            json!({"userIdentity": c, "organizationId": 1, "isActive": true}),
            member("invalid", 1, json!(7), true),
        ];
        assert_eq!(eligible_identities(&rows, 1, 7), HashSet::from([a, b]));
    }

    #[test]
    fn directory_excludes_inactive_and_foreign_profiles_and_limits_projection() {
        let a = "a".repeat(64);
        let b = "b".repeat(64);
        let eligible = HashSet::from([a.clone(), b.clone()]);
        let profiles = vec![
            json!({"identity": a, "organizationId": 1, "isActive": true, "name": " Ada ", "email": "private@example.test"}),
            json!({"identity": b, "organizationId": 1, "isActive": false}),
            json!({"identity": b, "organizationId": 2, "isActive": true}),
        ];
        assert_eq!(
            directory_rows(&profiles, &eligible, 1, true),
            vec![json!({"id": a, "name": "Ada"})]
        );
        assert_eq!(
            directory_rows(&profiles, &eligible, 1, false),
            vec![json!({"id": a, "name": ""})]
        );
    }
}

//! Candidate role/group/unit and delegation authorization.
use super::{
    allowed_company_ids, enum_tag, project_human_task, row_company_allowed, row_u64,
    sort_rows_by_id_desc, u64_list_field, HUMAN_TASK_LIST_COLS,
};
use crate::auth_password::identity_cell_to_hex;
use crate::error::ApiError;
use crate::session::normalize_identity_hex_for_sql;
use serde_json::Value;
use std::collections::HashSet;
use stdb_auth::{identity_sql_literal, FieldAccessContext};
use stdb_client::StdbClient;

pub(super) async fn query_human_task_inbox(
    owner: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    field_access: Option<&FieldAccessContext>,
    open_only: bool,
) -> Result<Vec<Value>, ApiError> {
    let caller = normalize_identity_hex_for_sql(identity_hex);
    let company_ids = allowed_company_ids(owner, organization_id, field_access).await?;
    let scope = CandidateScope::load(owner, organization_id, &caller, field_access).await?;

    let sql = format!(
        "SELECT {HUMAN_TASK_LIST_COLS} FROM workflow_human_task WHERE organization_id = {organization_id}"
    );
    let rows = owner.query_sql(&sql).await.map_err(ApiError::internal)?;

    let instance_revisions = load_instance_revisions(owner, organization_id).await?;

    let mut out = Vec::new();
    for row in rows {
        if !row_company_allowed(&row, &company_ids) {
            continue;
        }
        if open_only {
            let status = enum_tag(&row, "status");
            if !matches!(status.as_deref(), Some("Open") | Some("Claimed")) {
                continue;
            }
        }
        if !scope.can_view_task(&row, &caller) {
            continue;
        }
        let options = scope.delegated_options(&row, &caller);
        let mut projected = project_human_task(row, &instance_revisions);
        if let Some(object) = projected.as_object_mut() {
            object.insert("actingForOptions".to_string(), Value::Array(options));
        }
        out.push(projected);
    }
    sort_rows_by_id_desc(&mut out);
    Ok(out)
}

pub(super) async fn load_instance_revisions(
    owner: &StdbClient,
    organization_id: u64,
) -> Result<std::collections::HashMap<u64, u64>, ApiError> {
    let sql = format!(
        "SELECT id, revision FROM workflow_instance WHERE organization_id = {organization_id}"
    );
    let rows = owner.query_sql(&sql).await.map_err(ApiError::internal)?;
    let mut map = std::collections::HashMap::new();
    for r in rows {
        if let (Some(id), Some(rev)) = (row_u64(&r, "id"), row_u64(&r, "revision")) {
            map.insert(id, rev);
        }
    }
    Ok(map)
}

#[derive(Default)]
struct PrincipalScope {
    roles: HashSet<u64>,
    groups: Vec<(u64, u64)>,
    units: Vec<(Option<u64>, u64)>,
    companies: HashSet<u64>,
    label: String,
}

struct DelegatedScope {
    identity: String,
    company_id: u64,
    principal: PrincipalScope,
}

pub(super) struct CandidateScope {
    principal: PrincipalScope,
    acting_for: Vec<DelegatedScope>,
    is_superuser: bool,
}

fn cell<'a>(row: &'a Value, camel: &str, snake: &str) -> Option<&'a Value> {
    row.get(camel).or_else(|| row.get(snake))
}

fn id_value(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
}

fn active(row: &Value) -> bool {
    cell(row, "isActive", "is_active").and_then(Value::as_bool) == Some(true)
}

fn micros(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_str().and_then(|v| v.parse().ok()))
        .or_else(|| {
            value
                .get("__timestamp_micros_since_unix_epoch__")
                .and_then(micros)
        })
        .or_else(|| value.get("microsSinceUnixEpoch").and_then(micros))
}

fn effective_window(row: &Value, at: i64) -> bool {
    active(row)
        && cell(row, "validFrom", "valid_from")
            .and_then(micros)
            .is_some_and(|start| start <= at)
        && cell(row, "validUntil", "valid_until")
            .and_then(micros)
            .is_some_and(|end| at < end)
}

impl PrincipalScope {
    async fn load(
        owner: &StdbClient,
        org: u64,
        identity: &str,
        live_roles: &HashSet<u64>,
        at: i64,
    ) -> Result<Self, ApiError> {
        let identity = identity_sql_literal(identity).map_err(ApiError::Internal)?;
        let profiles = owner.query_sql(&format!("SELECT name, is_active FROM user_profile WHERE organization_id = {org} AND identity = {identity}"))
            .await.map_err(ApiError::internal)?;
        if profiles.len() != 1 || !active(&profiles[0]) {
            return Ok(Self::default());
        }
        let memberships = owner.query_sql(&format!("SELECT role_id, company_id, department_id, is_active FROM user_organization WHERE organization_id = {org} AND user_identity = {identity}"))
            .await.map_err(ApiError::internal)?;
        let assignments = owner.query_sql(&format!("SELECT role_id, is_active, expires_at FROM user_role_assignment WHERE organization_id = {org} AND user_identity = {identity}"))
            .await.map_err(ApiError::internal)?;
        let groups = owner.query_sql(&format!("SELECT group_id, company_id, is_active FROM workflow_candidate_group_member WHERE organization_id = {org} AND member_identity = {identity}"))
            .await.map_err(ApiError::internal)?;
        let companies = owner
            .query_sql(&format!(
                "SELECT id FROM company WHERE organization_id = {org}"
            ))
            .await
            .map_err(ApiError::internal)?;
        let company_ids = companies
            .iter()
            .filter_map(|row| row_u64(row, "id"))
            .collect();
        let mut result = Self::from_rows(
            &memberships,
            &assignments,
            &groups,
            live_roles,
            &company_ids,
            at,
        );
        result.label = profiles[0]
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Delegated approver")
            .to_string();
        Ok(result)
    }

    fn from_rows(
        memberships: &[Value],
        assignments: &[Value],
        groups: &[Value],
        live_roles: &HashSet<u64>,
        companies: &HashSet<u64>,
        at: i64,
    ) -> Self {
        let mut result = Self::default();
        for row in memberships.iter().filter(|row| active(row)) {
            let Some(company) = cell(row, "companyId", "company_id") else {
                continue;
            };
            let company_id = company
                .as_u64()
                .or_else(|| company.as_str().and_then(|v| v.parse().ok()));
            if company.is_null() {
                result.companies.extend(companies);
            } else if let Some(id) = company_id.filter(|id| companies.contains(id)) {
                result.companies.insert(id);
            } else {
                continue;
            }
            if let Some(role) = cell(row, "roleId", "role_id")
                .and_then(id_value)
                .filter(|id| live_roles.contains(id))
            {
                result.roles.insert(role);
            }
            if let Some(unit) = cell(row, "departmentId", "department_id")
                .and_then(id_value)
                .filter(|id| *id > 0)
            {
                result.units.push((company_id, unit));
            }
        }
        if result.companies.is_empty() {
            return result;
        }
        for row in assignments.iter().filter(|row| active(row)) {
            let current = cell(row, "expiresAt", "expires_at").is_some_and(|expires| {
                expires.is_null() || micros(expires).is_some_and(|expiry| at < expiry)
            });
            if current {
                if let Some(role) = cell(row, "roleId", "role_id")
                    .and_then(id_value)
                    .filter(|id| live_roles.contains(id))
                {
                    result.roles.insert(role);
                }
            }
        }
        for row in groups.iter().filter(|row| active(row)) {
            if let (Some(company), Some(group)) = (
                cell(row, "companyId", "company_id").and_then(id_value),
                cell(row, "groupId", "group_id").and_then(id_value),
            ) {
                if result.companies.contains(&company) {
                    result.groups.push((company, group));
                }
            }
        }
        result
    }

    fn matches(&self, task: &Value) -> bool {
        let Some(company) = cell(task, "companyId", "company_id").and_then(id_value) else {
            return false;
        };
        if !self.companies.contains(&company) {
            return false;
        }
        let groups = self
            .groups
            .iter()
            .filter(|(id, _)| *id == company)
            .map(|(_, group)| *group)
            .collect();
        let units = self
            .units
            .iter()
            .filter(|(id, _)| id.is_none_or(|id| id == company))
            .map(|(_, unit)| *unit)
            .collect();
        principal_matches_candidates(task, &self.roles, &groups, &units)
    }
}

impl CandidateScope {
    async fn load(
        owner: &StdbClient,
        org: u64,
        caller_hex: &str,
        field_access: Option<&FieldAccessContext>,
    ) -> Result<Self, ApiError> {
        let at = chrono::Utc::now().timestamp_micros();
        let roles = owner
            .query_sql(&format!(
                "SELECT id, is_active FROM role WHERE organization_id = {org}"
            ))
            .await
            .map_err(ApiError::internal)?;
        let live_roles = roles
            .iter()
            .filter(|row| active(row))
            .filter_map(|row| row_u64(row, "id"))
            .collect();
        let principal = PrincipalScope::load(owner, org, caller_hex, &live_roles, at).await?;
        let caller = identity_sql_literal(caller_hex).map_err(ApiError::Internal)?;
        let delegations = owner.query_sql(&format!("SELECT delegator_identity, role_id, company_id, is_active, valid_from, valid_until FROM workflow_delegation WHERE organization_id = {org} AND delegatee_identity = {caller}"))
            .await.map_err(ApiError::internal)?;
        let mut acting_for = Vec::new();
        for row in delegations.iter().filter(|row| effective_window(row, at)) {
            let Some(company_id) = cell(row, "companyId", "company_id")
                .and_then(id_value)
                .filter(|id| principal.companies.contains(id))
            else {
                continue;
            };
            let Some(identity) =
                cell(row, "delegatorIdentity", "delegator_identity").and_then(identity_cell_to_hex)
            else {
                continue;
            };
            let mut delegator =
                PrincipalScope::load(owner, org, &identity, &live_roles, at).await?;
            if let Some(role) = cell(row, "roleId", "role_id").filter(|role| !role.is_null()) {
                let Some(role) = id_value(role) else {
                    continue;
                };
                if !delegator.roles.contains(&role) {
                    continue;
                }
                delegator.roles.retain(|id| *id == role);
            }
            if !delegator.roles.is_empty() && delegator.companies.contains(&company_id) {
                acting_for.push(DelegatedScope {
                    identity,
                    company_id,
                    principal: delegator,
                });
            }
        }
        Ok(Self {
            principal,
            acting_for,
            is_superuser: field_access.is_some_and(|fa| fa.is_superuser),
        })
    }

    fn delegated_options(&self, task: &Value, caller: &str) -> Vec<Value> {
        let requester = cell(task, "requestedBy", "requested_by").and_then(identity_cell_to_hex);
        if requester.as_deref() == Some(caller) {
            return Vec::new();
        }
        let company = cell(task, "companyId", "company_id").and_then(id_value);
        let mut seen = HashSet::new();
        self.acting_for.iter().filter(|delegation| {
            company == Some(delegation.company_id) && requester.as_deref() != Some(delegation.identity.as_str())
                && delegation.principal.matches(task) && seen.insert(delegation.identity.clone())
        }).map(|delegation| serde_json::json!({"identityHex":delegation.identity,"label":delegation.principal.label})).collect()
    }

    fn can_view_task(&self, row: &Value, caller: &str) -> bool {
        self.is_superuser
            || self.principal.matches(row)
            || (cell(row, "companyId", "company_id")
                .and_then(id_value)
                .is_some_and(|id| self.principal.companies.contains(&id))
                && cell(row, "claimedBy", "claimed_by")
                    .and_then(identity_cell_to_hex)
                    .as_deref()
                    == Some(caller))
            || !self.delegated_options(row, caller).is_empty()
    }
}

pub(super) fn principal_matches_candidates(
    row: &Value,
    role_ids: &HashSet<u64>,
    group_ids: &HashSet<u64>,
    unit_ids: &HashSet<u64>,
) -> bool {
    let task_roles = u64_list_field(row, "candidateRoleIds", "candidate_role_ids");
    let task_groups = u64_list_field(row, "candidateGroupIds", "candidate_group_ids");
    let task_units = u64_list_field(row, "candidateUnitIds", "candidate_unit_ids");

    let role_match = !task_roles.is_empty() && task_roles.iter().any(|r| role_ids.contains(r));
    let group_match = !task_groups.is_empty() && task_groups.iter().any(|g| group_ids.contains(g));
    let unit_match = !task_units.is_empty() && task_units.iter().any(|u| unit_ids.contains(u));
    role_match || group_match || unit_match
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn principal() -> PrincipalScope {
        PrincipalScope::from_rows(
            &[json!({"company_id":7,"role_id":2,"department_id":4,"is_active":true})],
            &[
                json!({"role_id":3,"is_active":true,"expires_at":101}),
                json!({"role_id":5,"is_active":true,"expires_at":100}),
                json!({"role_id":6,"is_active":false,"expires_at":null}),
            ],
            &[
                json!({"company_id":7,"group_id":9,"is_active":true}),
                json!({"company_id":8,"group_id":10,"is_active":true}),
            ],
            &HashSet::from([2, 3, 5, 6]),
            &HashSet::from([7, 8]),
            100,
        )
    }

    #[test]
    fn current_roles_and_candidate_memberships_do_not_cross_companies() {
        let scope = principal();
        assert_eq!(scope.roles, HashSet::from([2, 3]));
        assert!(scope.matches(&json!({"company_id":7,"candidate_role_ids":[3]})));
        assert!(!scope.matches(&json!({"company_id":7,"candidate_role_ids":[5]})));
        assert!(!scope.matches(&json!({"company_id":8,"candidate_role_ids":[3]})));
        assert!(!scope.matches(&json!({"company_id":8,"candidate_group_ids":[9]})));
        assert!(!scope.matches(&json!({"company_id":8,"candidate_unit_ids":[4]})));
    }

    #[test]
    fn delegation_windows_fail_closed_and_use_exclusive_expiry() {
        for valid in [
            json!({"is_active":true,"valid_from":100,"valid_until":101}),
            json!({"isActive":true,"validFrom":{"__timestamp_micros_since_unix_epoch__":99},"validUntil":{"microsSinceUnixEpoch":101}}),
        ] {
            assert!(effective_window(&valid, 100));
        }
        for invalid in [
            json!({"is_active":false,"valid_from":99,"valid_until":101}),
            json!({"is_active":true,"valid_from":101,"valid_until":102}),
            json!({"is_active":true,"valid_from":99,"valid_until":100}),
            json!({"is_active":true}),
            json!({"is_active":true,"valid_from":"bad","valid_until":101}),
        ] {
            assert!(!effective_window(&invalid, 100));
        }
    }

    #[test]
    fn delegated_visibility_uses_principals_roles_and_company_without_self_approval() {
        let caller = "ab".repeat(32);
        let delegator = "cd".repeat(32);
        let scope = CandidateScope {
            principal: PrincipalScope::default(),
            acting_for: vec![DelegatedScope {
                identity: delegator.clone(),
                company_id: 7,
                principal: principal(),
            }],
            is_superuser: false,
        };
        let task = json!({"company_id":7,"candidate_role_ids":[2],"requested_by":"ef".repeat(32)});
        assert_eq!(scope.delegated_options(&task, &caller).len(), 1);
        assert!(scope.can_view_task(&task, &caller));
        assert!(!scope.can_view_task(&json!({"company_id":8,"candidate_role_ids":[2]}), &caller));
        assert!(scope
            .delegated_options(
                &json!({"company_id":7,"candidate_role_ids":[2],"requested_by":caller}),
                &caller
            )
            .is_empty());
        assert!(scope
            .delegated_options(
                &json!({"company_id":7,"candidate_role_ids":[2],"requested_by":delegator}),
                &caller
            )
            .is_empty());
    }
}

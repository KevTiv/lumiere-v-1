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
        out.push(project_human_task(row, &instance_revisions));
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

pub(super) struct CandidateScope {
    role_ids: HashSet<u64>,
    group_ids: HashSet<u64>,
    unit_ids: HashSet<u64>,
    /// Delegators this caller may act for, plus optional pinned role.
    acting_for: Vec<(String, Option<u64>)>,
    is_superuser: bool,
}

impl CandidateScope {
    async fn load(
        owner: &StdbClient,
        organization_id: u64,
        caller_hex: &str,
        field_access: Option<&FieldAccessContext>,
    ) -> Result<Self, ApiError> {
        let is_superuser = field_access.map(|f| f.is_superuser).unwrap_or(false);
        let mut role_ids = HashSet::new();
        if let Some(fa) = field_access {
            if fa.role_id > 0 {
                role_ids.insert(fa.role_id);
            }
        }

        let id_lit = identity_sql_literal(caller_hex).map_err(ApiError::Internal)?;

        // Additional role assignments for the caller.
        let ura_sql = format!(
            "SELECT role_id, organization_id FROM user_role_assignment WHERE user_identity = {id_lit}"
        );
        if let Ok(rows) = owner.query_sql(&ura_sql).await {
            for r in rows {
                let org = row_u64(&r, "organizationId").or_else(|| row_u64(&r, "organization_id"));
                if org != Some(organization_id) {
                    continue;
                }
                if let Some(rid) = row_u64(&r, "roleId").or_else(|| row_u64(&r, "role_id")) {
                    role_ids.insert(rid);
                }
            }
        }

        // Group memberships.
        let mut group_ids = HashSet::new();
        let grp_sql = format!(
            "SELECT group_id, organization_id, company_id, is_active FROM workflow_candidate_group_member WHERE member_identity = {id_lit}"
        );
        if let Ok(rows) = owner.query_sql(&grp_sql).await {
            for r in rows {
                let org = row_u64(&r, "organizationId").or_else(|| row_u64(&r, "organization_id"));
                let active = r
                    .get("isActive")
                    .or_else(|| r.get("is_active"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if org != Some(organization_id) || !active {
                    continue;
                }
                if let Some(gid) = row_u64(&r, "groupId").or_else(|| row_u64(&r, "group_id")) {
                    group_ids.insert(gid);
                }
            }
        }

        // Unit = department_id on active org membership.
        let mut unit_ids = HashSet::new();
        let uo_sql = format!(
            "SELECT department_id, organization_id, company_id, is_active FROM user_organization WHERE user_id = {id_lit}"
        );
        if let Ok(rows) = owner.query_sql(&uo_sql).await {
            for r in rows {
                let org = row_u64(&r, "organizationId").or_else(|| row_u64(&r, "organization_id"));
                let active = r
                    .get("isActive")
                    .or_else(|| r.get("is_active"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                if org != Some(organization_id) || !active {
                    continue;
                }
                if let Some(did) =
                    row_u64(&r, "departmentId").or_else(|| row_u64(&r, "department_id"))
                {
                    if did > 0 {
                        unit_ids.insert(did);
                    }
                }
            }
        }

        // Active delegations where caller is the delegatee.
        let mut acting_for = Vec::new();
        let del_sql = format!(
            "SELECT delegator_identity, role_id, organization_id, company_id, is_active, valid_from, valid_until FROM workflow_delegation WHERE delegatee_identity = {id_lit}"
        );
        if let Ok(rows) = owner.query_sql(&del_sql).await {
            for r in rows {
                let org = row_u64(&r, "organizationId").or_else(|| row_u64(&r, "organization_id"));
                let active = r
                    .get("isActive")
                    .or_else(|| r.get("is_active"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if org != Some(organization_id) || !active {
                    continue;
                }
                let Some(delegator) = r
                    .get("delegatorIdentity")
                    .or_else(|| r.get("delegator_identity"))
                    .and_then(identity_cell_to_hex)
                else {
                    continue;
                };
                let role = row_u64(&r, "roleId").or_else(|| row_u64(&r, "role_id"));
                acting_for.push((delegator, role));
            }
        }

        Ok(Self {
            role_ids,
            group_ids,
            unit_ids,
            acting_for,
            is_superuser,
        })
    }

    fn can_view_task(&self, row: &Value, caller_hex: &str) -> bool {
        if self.is_superuser {
            return true;
        }

        // Already claimed by caller → visible.
        if let Some(claimed) = row
            .get("claimedBy")
            .or_else(|| row.get("claimed_by"))
            .and_then(identity_cell_to_hex)
        {
            if claimed == caller_hex {
                return true;
            }
        }

        if principal_matches_candidates(row, &self.role_ids, &self.group_ids, &self.unit_ids) {
            return true;
        }

        // Delegation: principal = delegator must match candidates (role pin optional).
        for (delegator, pinned_role) in &self.acting_for {
            let mut roles = self.role_ids.clone();
            if let Some(r) = pinned_role {
                roles = HashSet::from([*r]);
            }
            // For delegation visibility we check the task candidates against the
            // (possibly pinned) role set; group/unit still use the caller's memberships
            // because memberships are not delegated.
            if principal_matches_candidates(row, &roles, &self.group_ids, &self.unit_ids) {
                let _ = delegator;
                return true;
            }
        }

        false
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

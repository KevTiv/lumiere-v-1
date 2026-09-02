//! Decision-time workflow authorization and effective-dated delegation.
//!
//! Human-task reducers must call [`authorize_workflow_decision`] immediately before
//! appending a decision or invoking a guarded action. The result is evidence meant
//! to be copied onto the append-only decision event.

use std::collections::{HashSet, VecDeque};

use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::{company, organization};
use crate::core::permissions::{
    org_permission, role, sod_conflict_rule, user_role_assignment, PermissionAction,
    PermissionEffect, PermissionSubject,
};
use crate::core::users::{user_organization, user_profile};
use crate::helpers::{write_audit_log_v2, AuditLogParams};

/// One organizational workflow delegation. `role_id = None` delegates all of
/// the delegator's otherwise eligible workflow roles; `Some` delegates only that role.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow_delegation,
    index(accessor = workflow_delegation_by_company, btree(columns = [organization_id, company_id])),
    index(accessor = workflow_delegation_by_delegatee, btree(columns = [delegatee_identity]))
)]
pub struct WorkflowDelegation {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub organization_id: u64,
    pub company_id: u64,
    pub delegator_identity: Identity,
    pub delegatee_identity: Identity,
    pub role_id: Option<u64>,
    /// Inclusive start of the delegation window.
    pub valid_from: Timestamp,
    /// Exclusive end of the delegation window.
    pub valid_until: Timestamp,
    pub is_active: bool,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub revoked_by: Option<Identity>,
    pub revoked_at: Option<Timestamp>,
    pub reason: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateWorkflowDelegationParams {
    pub delegator_identity: Identity,
    pub delegatee_identity: Identity,
    pub role_id: Option<u64>,
    pub valid_from: Timestamp,
    pub valid_until: Timestamp,
    pub reason: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowRoleSource {
    OrganizationMembership,
    RoleAssignment,
}

/// A role proven current at the supplied decision timestamp.
#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub struct CurrentWorkflowRole {
    pub role_id: u64,
    pub role_name: String,
    pub source: WorkflowRoleSource,
    pub assignment_id: Option<u64>,
    pub expires_at: Option<Timestamp>,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowAuthorizationBypass {
    CompanyMembership,
    CandidateRole,
    ResourcePermission,
}

/// Input contract used by human-task decision reducers.
#[derive(SpacetimeType, Clone, Debug)]
pub struct WorkflowAuthorizationRequest {
    pub organization_id: u64,
    pub company_id: u64,
    pub requester_identity: Identity,
    /// Set only when the actor is exercising a workflow delegation.
    pub acting_for_identity: Option<Identity>,
    pub candidate_role_ids: Vec<u64>,
    /// Existing permission grammar: `resource:action`.
    pub required_permission: String,
}

/// Auditable proof of the principal used for a workflow decision.
#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub struct WorkflowAuthorizationDecision {
    pub actor_identity: Identity,
    pub acting_for_identity: Option<Identity>,
    pub matched_role_id: Option<u64>,
    pub delegation_id: Option<u64>,
    pub superuser_bypass: bool,
    pub bypassed_checks: Vec<WorkflowAuthorizationBypass>,
}

/// Require active company access for `identity` at decision time.
///
/// A company-unrestricted organization membership (`company_id = None`) grants
/// access to every live company in that organization. A current superuser may
/// bypass membership, but the returned Boolean forces callers to persist that fact.
pub(crate) fn require_workflow_company_access(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    identity: Identity,
) -> Result<bool, String> {
    let profile = ctx
        .db
        .user_profile()
        .identity()
        .find(identity)
        .ok_or("workflow actor profile not found")?;
    if !profile.is_active {
        return Err("workflow actor account is inactive".to_string());
    }

    let organization = ctx
        .db
        .organization()
        .id()
        .find(&organization_id)
        .ok_or("workflow organization not found")?;
    if !organization.is_active {
        return Err("workflow organization is inactive".to_string());
    }

    let company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("workflow company not found")?;
    if company.organization_id != organization_id || company.deleted_at.is_some() {
        return Err("workflow company is outside the organization or inactive".to_string());
    }

    let has_access = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&identity)
        .any(|membership| {
            membership.organization_id == organization_id
                && membership.is_active
                && membership
                    .company_id
                    .is_none_or(|member_company_id| member_company_id == company_id)
        });

    if has_access {
        Ok(false)
    } else if profile.is_superuser {
        Ok(true)
    } else {
        Err("workflow actor has no active access to this company".to_string())
    }
}

/// Resolve the identity's live roles, discarding inactive roles and assignments
/// whose exclusive expiry has passed.
pub(crate) fn current_workflow_roles(
    ctx: &ReducerContext,
    organization_id: u64,
    identity: Identity,
    at: Timestamp,
) -> Result<Vec<CurrentWorkflowRole>, String> {
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&identity)
        .find(|membership| membership.organization_id == organization_id && membership.is_active)
        .ok_or("identity is not an active organization member")?;

    let mut resolved = Vec::new();
    let base_role = ctx
        .db
        .role()
        .id()
        .find(&membership.role_id)
        .ok_or("organization membership role not found")?;
    if base_role.organization_id == organization_id && base_role.is_active {
        resolved.push(CurrentWorkflowRole {
            role_id: base_role.id,
            role_name: base_role.name,
            source: WorkflowRoleSource::OrganizationMembership,
            assignment_id: None,
            expires_at: None,
        });
    }

    for assignment in ctx
        .db
        .user_role_assignment()
        .role_assign_by_user()
        .filter(&identity)
        .filter(|assignment| {
            assignment.organization_id == organization_id
                && assignment.is_active
                && assignment.expires_at.is_none_or(|expiry| expiry > at)
        })
    {
        let Some(assigned_role) = ctx.db.role().id().find(&assignment.role_id) else {
            continue;
        };
        if assigned_role.organization_id != organization_id || !assigned_role.is_active {
            continue;
        }
        if resolved
            .iter()
            .any(|current| current.role_id == assigned_role.id)
        {
            continue;
        }
        resolved.push(CurrentWorkflowRole {
            role_id: assigned_role.id,
            role_name: assigned_role.name,
            source: WorkflowRoleSource::RoleAssignment,
            assignment_id: Some(assignment.id),
            expires_at: assignment.expires_at,
        });
    }

    resolved.sort_by_key(|current| current.role_id);
    Ok(resolved)
}

/// Re-evaluate configured SOD rules against every current role at decision time.
pub(crate) fn validate_workflow_sod(
    ctx: &ReducerContext,
    organization_id: u64,
    identity: Identity,
    at: Timestamp,
) -> Result<(), String> {
    let current_roles = current_workflow_roles(ctx, organization_id, identity, at)?;
    let mut permissions = Vec::new();
    for current in current_roles {
        let Some(role) = ctx.db.role().id().find(&current.role_id) else {
            continue;
        };
        permissions.extend(role.permissions);
    }
    permissions.sort();
    permissions.dedup();

    for conflict in ctx
        .db
        .sod_conflict_rule()
        .sod_by_org()
        .filter(&organization_id)
        .filter(|conflict| conflict.is_active)
    {
        if permission_set_has(&permissions, &conflict.permission_a)
            && permission_set_has(&permissions, &conflict.permission_b)
        {
            return Err(format!(
                "workflow segregation of duties conflict: {} and {}",
                conflict.permission_a, conflict.permission_b
            ));
        }
    }
    Ok(())
}

/// Authorize the connected actor for a workflow decision.
pub(crate) fn authorize_workflow_decision(
    ctx: &ReducerContext,
    request: &WorkflowAuthorizationRequest,
) -> Result<WorkflowAuthorizationDecision, String> {
    authorize_workflow_decision_for_actor(ctx, ctx.sender(), request)
}

/// Trusted internal variant for service-mediated decisions and domain tests.
/// Callers must bind `actor_identity` to an authenticated service/user identity.
pub(crate) fn authorize_workflow_decision_for_actor(
    ctx: &ReducerContext,
    actor_identity: Identity,
    request: &WorkflowAuthorizationRequest,
) -> Result<WorkflowAuthorizationDecision, String> {
    if actor_identity == request.requester_identity
        || request.acting_for_identity == Some(request.requester_identity)
    {
        return Err("workflow self-approval is not allowed".to_string());
    }

    let superuser_bypass = require_workflow_company_access(
        ctx,
        request.organization_id,
        request.company_id,
        actor_identity,
    )?;
    let mut bypassed_checks = Vec::new();
    if superuser_bypass {
        bypassed_checks.push(WorkflowAuthorizationBypass::CompanyMembership);
    }

    let actor_has_membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&actor_identity)
        .any(|membership| {
            membership.organization_id == request.organization_id && membership.is_active
        });
    if actor_has_membership {
        validate_workflow_sod(ctx, request.organization_id, actor_identity, ctx.timestamp)?;
    }

    let (principal_identity, principal_roles, delegation_id) =
        if let Some(acting_for_identity) = request.acting_for_identity {
            require_workflow_company_access(
                ctx,
                request.organization_id,
                request.company_id,
                acting_for_identity,
            )?;
            validate_workflow_sod(
                ctx,
                request.organization_id,
                acting_for_identity,
                ctx.timestamp,
            )?;
            let principal_roles = current_workflow_roles(
                ctx,
                request.organization_id,
                acting_for_identity,
                ctx.timestamp,
            )?;
            let eligible_role_ids: HashSet<_> = principal_roles
                .iter()
                .filter(|current| {
                    request.candidate_role_ids.is_empty()
                        || request.candidate_role_ids.contains(&current.role_id)
                })
                .map(|current| current.role_id)
                .collect();
            let delegation = find_effective_delegation(
                ctx,
                request.organization_id,
                request.company_id,
                acting_for_identity,
                actor_identity,
                ctx.timestamp,
                &eligible_role_ids,
            )
            .ok_or("no effective workflow delegation exists for this actor")?;
            (acting_for_identity, principal_roles, Some(delegation.id))
        } else {
            let roles = if actor_has_membership {
                current_workflow_roles(ctx, request.organization_id, actor_identity, ctx.timestamp)?
            } else {
                Vec::new()
            };
            (actor_identity, roles, None)
        };
    let delegation_role = delegation_id.and_then(|id| {
        ctx.db
            .workflow_delegation()
            .id()
            .find(&id)
            .and_then(|delegation| delegation.role_id)
    });
    let matched_role_id = principal_roles
        .iter()
        .find(|current| {
            (request.candidate_role_ids.is_empty()
                || request.candidate_role_ids.contains(&current.role_id))
                && delegation_role.is_none_or(|role_id| role_id == current.role_id)
        })
        .map(|current| current.role_id);

    if matched_role_id.is_none() {
        if superuser_bypass && request.acting_for_identity.is_none() {
            bypassed_checks.push(WorkflowAuthorizationBypass::CandidateRole);
        } else {
            return Err("workflow actor has no current candidate role".to_string());
        }
    }

    if !has_required_permission(
        ctx,
        request.organization_id,
        principal_identity,
        &principal_roles,
        &request.required_permission,
    )? {
        if superuser_bypass && request.acting_for_identity.is_none() {
            bypassed_checks.push(WorkflowAuthorizationBypass::ResourcePermission);
        } else {
            return Err(format!(
                "workflow permission denied: {}",
                request.required_permission
            ));
        }
    }

    Ok(WorkflowAuthorizationDecision {
        actor_identity,
        acting_for_identity: request.acting_for_identity,
        matched_role_id,
        delegation_id,
        superuser_bypass,
        bypassed_checks,
    })
}

/// Create a delegation as the connected delegator or as an explicit superuser administrator.
#[spacetimedb::reducer]
pub fn create_workflow_delegation(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateWorkflowDelegationParams,
) -> Result<(), String> {
    let sender = ctx
        .db
        .user_profile()
        .identity()
        .find(ctx.sender())
        .ok_or("workflow delegation creator profile not found")?;
    if !sender.is_active {
        return Err("workflow delegation creator is inactive".to_string());
    }
    if ctx.sender() != params.delegator_identity && !sender.is_superuser {
        return Err("only the delegator or a superuser may create a delegation".to_string());
    }
    insert_workflow_delegation(ctx, organization_id, company_id, params, ctx.sender())?;
    Ok(())
}

pub(crate) fn insert_workflow_delegation(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateWorkflowDelegationParams,
    created_by: Identity,
) -> Result<WorkflowDelegation, String> {
    if params.delegator_identity == params.delegatee_identity {
        return Err("workflow delegation cannot target self".to_string());
    }
    if params.valid_until <= params.valid_from || params.valid_until <= ctx.timestamp {
        return Err("workflow delegation requires a future end after its start".to_string());
    }
    require_workflow_company_access(ctx, organization_id, company_id, params.delegator_identity)?;
    require_workflow_company_access(ctx, organization_id, company_id, params.delegatee_identity)?;

    if let Some(role_id) = params.role_id {
        let role = ctx
            .db
            .role()
            .id()
            .find(&role_id)
            .ok_or("delegated role not found")?;
        if role.organization_id != organization_id || !role.is_active {
            return Err("delegated role is outside the organization or inactive".to_string());
        }
        let delegator_roles = current_workflow_roles(
            ctx,
            organization_id,
            params.delegator_identity,
            ctx.timestamp,
        )?;
        if !delegator_roles
            .iter()
            .any(|current| current.role_id == role_id)
        {
            return Err("delegator does not currently hold the delegated role".to_string());
        }
    }

    let candidate = DelegationWindow {
        role_id: params.role_id,
        valid_from: params.valid_from,
        valid_until: params.valid_until,
    };
    for existing in ctx
        .db
        .workflow_delegation()
        .workflow_delegation_by_company()
        .filter((&organization_id, &company_id))
        .filter(|delegation| delegation.is_active)
    {
        let existing_window = DelegationWindow::from(&existing);
        if existing.delegator_identity == params.delegator_identity
            && existing.delegatee_identity == params.delegatee_identity
            && windows_overlap(&candidate, &existing_window)
            && roles_overlap(candidate.role_id, existing.role_id)
        {
            return Err("overlapping workflow delegation already exists".to_string());
        }
    }

    if delegation_would_cycle(
        ctx,
        organization_id,
        company_id,
        params.delegator_identity,
        params.delegatee_identity,
        &candidate,
    ) {
        return Err("workflow delegation would create a cycle".to_string());
    }

    let row = ctx.db.workflow_delegation().insert(WorkflowDelegation {
        id: 0,
        organization_id,
        company_id,
        delegator_identity: params.delegator_identity,
        delegatee_identity: params.delegatee_identity,
        role_id: params.role_id,
        valid_from: params.valid_from,
        valid_until: params.valid_until,
        is_active: true,
        created_by,
        created_at: ctx.timestamp,
        revoked_by: None,
        revoked_at: None,
        reason: params.reason,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "workflow_delegation",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "delegator_identity": row.delegator_identity.to_hex().to_string(),
                    "delegatee_identity": row.delegatee_identity.to_hex().to_string(),
                    "role_id": row.role_id,
                    "valid_from_micros": row.valid_from.to_micros_since_unix_epoch(),
                    "valid_until_micros": row.valid_until.to_micros_since_unix_epoch(),
                })
                .to_string(),
            ),
            changed_fields: vec!["is_active".to_string()],
            metadata: None,
        },
    );
    Ok(row)
}

#[spacetimedb::reducer]
pub fn revoke_workflow_delegation(
    ctx: &ReducerContext,
    organization_id: u64,
    delegation_id: u64,
) -> Result<(), String> {
    let delegation = ctx
        .db
        .workflow_delegation()
        .id()
        .find(&delegation_id)
        .ok_or("workflow delegation not found")?;
    if delegation.organization_id != organization_id {
        return Err("workflow delegation belongs to another organization".to_string());
    }
    let sender = ctx
        .db
        .user_profile()
        .identity()
        .find(ctx.sender())
        .ok_or("workflow delegation revoker profile not found")?;
    if ctx.sender() != delegation.delegator_identity
        && ctx.sender() != delegation.delegatee_identity
        && !sender.is_superuser
    {
        return Err("only a delegation party or superuser may revoke it".to_string());
    }
    if !delegation.is_active {
        return Err("workflow delegation is already inactive".to_string());
    }
    ctx.db
        .workflow_delegation()
        .id()
        .update(WorkflowDelegation {
            is_active: false,
            revoked_by: Some(ctx.sender()),
            revoked_at: Some(ctx.timestamp),
            ..delegation.clone()
        });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(delegation.company_id),
            table_name: "workflow_delegation",
            record_id: delegation.id,
            action: "REVOKE",
            old_values: Some(r#"{"is_active":true}"#.to_string()),
            new_values: Some(r#"{"is_active":false}"#.to_string()),
            changed_fields: vec!["is_active".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

fn find_effective_delegation(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    delegator_identity: Identity,
    delegatee_identity: Identity,
    at: Timestamp,
    eligible_role_ids: &HashSet<u64>,
) -> Option<WorkflowDelegation> {
    ctx.db
        .workflow_delegation()
        .workflow_delegation_by_company()
        .filter((&organization_id, &company_id))
        .filter(|delegation| {
            delegation.is_active
                && delegation.delegator_identity == delegator_identity
                && delegation.delegatee_identity == delegatee_identity
                && delegation.valid_from <= at
                && at < delegation.valid_until
                && delegation
                    .role_id
                    .is_none_or(|role_id| eligible_role_ids.contains(&role_id))
        })
        .min_by_key(|delegation| delegation.id)
}

fn has_required_permission(
    ctx: &ReducerContext,
    organization_id: u64,
    principal_identity: Identity,
    current_roles: &[CurrentWorkflowRole],
    required_permission: &str,
) -> Result<bool, String> {
    let (resource, action) = required_permission
        .split_once(':')
        .ok_or("workflow permission must use resource:action syntax")?;
    if resource.is_empty() || action.is_empty() {
        return Err("workflow permission must use non-empty resource:action syntax".to_string());
    }
    let role_ids: HashSet<u64> = current_roles.iter().map(|role| role.role_id).collect();

    let matching_org_permissions: Vec<_> = ctx
        .db
        .org_permission()
        .perm_by_org()
        .filter(&organization_id)
        .filter(|permission| {
            permission_subject_matches(&permission.subject, principal_identity, &role_ids)
                && permission_resource_matches(&permission.resource, resource)
                && permission_action_matches(&permission.action, action)
        })
        .collect();
    if matching_org_permissions
        .iter()
        .any(|permission| permission.effect == PermissionEffect::Deny)
    {
        return Ok(false);
    }
    if matching_org_permissions
        .iter()
        .any(|permission| permission.effect == PermissionEffect::Allow)
    {
        return Ok(true);
    }

    for current in current_roles {
        let Some(role) = ctx.db.role().id().find(&current.role_id) else {
            continue;
        };
        if permission_set_has(&role.permissions, required_permission) {
            return Ok(true);
        }
    }

    Ok(false)
}

fn permission_set_has(permissions: &[String], required_permission: &str) -> bool {
    if permissions.iter().any(|permission| permission == "*:*") {
        return true;
    }
    let wildcard = required_permission
        .split_once(':')
        .map(|(resource, _)| format!("{resource}:*"));
    permissions.iter().any(|permission| {
        permission == required_permission
            || wildcard
                .as_ref()
                .is_some_and(|wildcard| permission == wildcard)
    })
}

fn permission_subject_matches(
    subject: &PermissionSubject,
    identity: Identity,
    role_ids: &HashSet<u64>,
) -> bool {
    match subject {
        PermissionSubject::Role(role_id) => role_ids.contains(role_id),
        PermissionSubject::User(user_identity) => *user_identity == identity,
    }
}

fn permission_resource_matches(configured: &str, requested: &str) -> bool {
    configured == "*" || configured == requested
}

fn permission_action_matches(configured: &PermissionAction, requested: &str) -> bool {
    matches!(configured, PermissionAction::All)
        || matches!(
            (configured, requested),
            (PermissionAction::Read, "read")
                | (PermissionAction::Write, "write")
                | (PermissionAction::Create, "create")
                | (PermissionAction::Delete, "delete")
        )
}

#[derive(Clone, Copy)]
struct DelegationWindow {
    role_id: Option<u64>,
    valid_from: Timestamp,
    valid_until: Timestamp,
}

impl From<&WorkflowDelegation> for DelegationWindow {
    fn from(delegation: &WorkflowDelegation) -> Self {
        Self {
            role_id: delegation.role_id,
            valid_from: delegation.valid_from,
            valid_until: delegation.valid_until,
        }
    }
}

fn windows_overlap(left: &DelegationWindow, right: &DelegationWindow) -> bool {
    left.valid_from < right.valid_until && right.valid_from < left.valid_until
}

fn roles_overlap(left: Option<u64>, right: Option<u64>) -> bool {
    left.is_none() || right.is_none() || left == right
}

fn delegation_would_cycle(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    delegator_identity: Identity,
    delegatee_identity: Identity,
    candidate: &DelegationWindow,
) -> bool {
    let relevant: Vec<_> = ctx
        .db
        .workflow_delegation()
        .workflow_delegation_by_company()
        .filter((&organization_id, &company_id))
        .filter(|delegation| {
            delegation.is_active
                && windows_overlap(candidate, &DelegationWindow::from(delegation))
                && roles_overlap(candidate.role_id, delegation.role_id)
        })
        .collect();
    let mut queue = VecDeque::from([delegatee_identity]);
    let mut visited = HashSet::new();
    while let Some(identity) = queue.pop_front() {
        if identity == delegator_identity {
            return true;
        }
        if !visited.insert(identity) {
            continue;
        }
        queue.extend(
            relevant
                .iter()
                .filter(|delegation| delegation.delegator_identity == identity)
                .map(|delegation| delegation.delegatee_identity),
        );
    }
    false
}

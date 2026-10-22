//! Conservative action hints for the current actor or one explicit delegate.
//! Reducers retain decision-time authority, revision checks and business effects.

use super::{cell, enum_tag, identity, number};
use serde::Serialize;
use serde_json::Value;
use stdb_auth::FieldAccessContext;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum WorkAction {
    Claim,
    Approve,
    Reject,
    Complete,
}

fn role_grants(permissions: &[String], required: &str) -> bool {
    let wildcard = required
        .split_once(':')
        .map(|(resource, _)| format!("{resource}:*"));
    permissions.iter().any(|permission| {
        permission == "*:*" || permission == required || wildcard.as_ref() == Some(permission)
    })
}

/// Match the workflow reducer's explicit permission grammar. Module grants and
/// a profile's superuser flag do not invent workflow decision authority here.
fn permits(access: &FieldAccessContext, action: &str) -> bool {
    let grants: Vec<_> = access
        .org_permissions
        .iter()
        .filter(|grant| {
            matches!(grant.resource.as_str(), "*" | "workflow_task")
                && (matches!(grant.action.as_str(), "*" | "all") || grant.action == action)
        })
        .collect();
    if grants.iter().any(|grant| !grant.allow) {
        return false;
    }
    grants.iter().any(|grant| grant.allow)
        || role_grants(&access.role_permissions, &format!("workflow_task:{action}"))
}

pub(super) fn has_sod_conflict(access: &FieldAccessContext, rules: &[Value]) -> bool {
    rules.iter().any(|rule| {
        let left = cell(rule, "permissionA", "permission_a").and_then(Value::as_str);
        let right = cell(rule, "permissionB", "permission_b").and_then(Value::as_str);
        left.zip(right).is_some_and(|(left, right)| {
            role_grants(&access.role_permissions, left)
                && role_grants(&access.role_permissions, right)
        })
    })
}

pub(super) struct ActionContext<'a> {
    pub caller: &'a str,
    pub principal: &'a str,
    pub eligible: bool,
    pub access: Option<&'a FieldAccessContext>,
    pub actor_has_sod_conflict: bool,
    pub sod_rules: &'a [Value],
    pub unvoted_candidates: &'a [String],
}

pub(super) fn work_actions(row: &Value, context: ActionContext<'_>) -> Vec<WorkAction> {
    let Some(access) = context.access else {
        return Vec::new();
    };
    let Some(requester) = identity(row, "requestedBy", "requested_by") else {
        return Vec::new();
    };
    if !context.eligible
        || context.actor_has_sod_conflict
        || has_sod_conflict(access, context.sod_rules)
        || requester == context.caller
        || requester == context.principal
        || number(row, "revision", "revision").is_none_or(|revision| revision == 0)
        || number(row, "instanceRevision", "instance_revision").is_none_or(|revision| revision == 0)
    {
        return Vec::new();
    }
    let status = enum_tag(row, "status");
    if !matches!(status.as_deref(), Some("Open" | "Claimed")) {
        return Vec::new();
    }
    let assignment = enum_tag(row, "assignment");
    if !matches!(
        assignment.as_deref(),
        Some("AnyCandidate" | "SingleCandidate" | "AllCandidates")
    ) {
        return Vec::new();
    }
    let claimant = identity(row, "claimedBy", "claimed_by");
    let all = assignment.as_deref() == Some("AllCandidates");
    if (all
        && !context
            .unvoted_candidates
            .iter()
            .any(|candidate| candidate == context.principal))
        || (!all
            && claimant
                .as_deref()
                .is_some_and(|actor| actor != context.caller))
        || (status.as_deref() == Some("Claimed") && claimant.is_none())
    {
        return Vec::new();
    }

    let mut actions = Vec::new();
    if !all && status.as_deref() == Some("Open") && claimant.is_none() && permits(access, "write") {
        actions.push(WorkAction::Claim);
    }
    if assignment.as_deref() == Some("SingleCandidate")
        && claimant.as_deref() != Some(context.caller)
    {
        return actions;
    }
    match enum_tag(row, "kind").as_deref() {
        Some("ApproveReject") => {
            if permits(access, "approve") {
                actions.push(WorkAction::Approve);
            }
            if permits(access, "reject") {
                actions.push(WorkAction::Reject);
            }
        }
        Some("Complete" | "EvidenceReview") if permits(access, "complete") => {
            actions.push(WorkAction::Complete)
        }
        _ => {}
    }
    actions
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use stdb_auth::ActionPermission;

    fn row() -> Value {
        json!({"status":"Open", "assignment":"AnyCandidate", "kind":"ApproveReject", "revision":1,
            "instanceRevision":2,"requestedBy":"ab".repeat(32),"claimedBy":null})
    }
    fn access(permissions: &[&str]) -> FieldAccessContext {
        FieldAccessContext {
            role_permissions: permissions.iter().map(|value| (*value).into()).collect(),
            ..FieldAccessContext::default()
        }
    }
    fn actions(row: &Value, access: &FieldAccessContext, eligible: bool) -> Vec<WorkAction> {
        work_actions(
            row,
            ActionContext {
                caller: &"cd".repeat(32),
                principal: &"cd".repeat(32),
                eligible,
                access: Some(access),
                actor_has_sod_conflict: false,
                sod_rules: &[],
                unvoted_candidates: &[],
            },
        )
    }

    #[test]
    fn reader_requester_revoked_candidate_and_other_claimant_cannot_act() {
        let mut task = row();
        assert!(actions(&task, &access(&["workflow:read"]), true).is_empty());
        let writer = access(&["workflow_task:*"]);
        assert!(actions(&task, &writer, false).is_empty());
        task["requestedBy"] = json!("cd".repeat(32));
        assert!(actions(&task, &writer, true).is_empty());
        task["requestedBy"] = json!("ab".repeat(32));
        task["claimedBy"] = json!("ef".repeat(32));
        assert!(actions(&task, &writer, true).is_empty());
    }

    #[test]
    fn claim_and_decision_permissions_are_distinct_and_deny_wins() {
        assert_eq!(
            actions(&row(), &access(&["workflow_task:write"]), true),
            vec![WorkAction::Claim]
        );
        assert_eq!(
            actions(&row(), &access(&["workflow_task:approve"]), true),
            vec![WorkAction::Approve]
        );
        let mut writer = access(&["workflow_task:*"]);
        writer.org_permissions.push(ActionPermission {
            resource: "workflow_task".into(),
            action: "all".into(),
            allow: false,
        });
        assert!(actions(&row(), &writer, true).is_empty());
        assert!(actions(&row(), &access(&["module:workflows:*"]), true).is_empty());
    }

    #[test]
    fn single_candidate_requires_claim_and_kind_controls_decision() {
        let mut task = row();
        task["assignment"] = json!({"tag":"SingleCandidate"});
        let writer = access(&["workflow_task:*"]);
        assert_eq!(actions(&task, &writer, true), vec![WorkAction::Claim]);
        task["status"] = json!({"Claimed":[]});
        task["claimedBy"] = json!("cd".repeat(32));
        task["kind"] = json!("Complete");
        assert_eq!(actions(&task, &writer, true), vec![WorkAction::Complete]);
        task["status"] = json!("Completed");
        assert!(actions(&task, &writer, true).is_empty());
    }

    #[test]
    fn delegation_uses_principal_grants_but_claim_belongs_to_actual_actor() {
        let mut task = row();
        task["assignment"] = json!("SingleCandidate");
        task["status"] = json!("Claimed");
        task["claimedBy"] = json!("cd".repeat(32));
        let principal = access(&["workflow_task:approve"]);
        let caller = "cd".repeat(32);
        let delegate = "ef".repeat(32);
        let context = || ActionContext {
            caller: &caller,
            principal: &delegate,
            eligible: true,
            access: Some(&principal),
            actor_has_sod_conflict: false,
            sod_rules: &[],
            unvoted_candidates: &[],
        };
        assert_eq!(work_actions(&task, context()), vec![WorkAction::Approve]);
        task["claimedBy"] = json!(delegate);
        assert!(work_actions(&task, context()).is_empty());
        task["claimedBy"] = json!(caller);
        task["requestedBy"] = json!(delegate);
        assert!(work_actions(&task, context()).is_empty());
    }

    #[test]
    fn all_candidates_requires_an_unvoted_snapshot_member() {
        let mut task = row();
        task["assignment"] = json!("AllCandidates");
        let writer = access(&["workflow_task:*"]);
        assert!(actions(&task, &writer, true).is_empty());
        let caller = "cd".repeat(32);
        let candidates = vec![caller.clone()];
        assert_eq!(
            work_actions(
                &task,
                ActionContext {
                    caller: &caller,
                    principal: &caller,
                    eligible: true,
                    access: Some(&writer),
                    actor_has_sod_conflict: false,
                    sod_rules: &[],
                    unvoted_candidates: &candidates
                }
            ),
            vec![WorkAction::Approve, WorkAction::Reject]
        );
    }

    #[test]
    fn active_sod_conflicts_disable_direct_and_delegated_actions() {
        let writer = access(&["workflow_task:*", "invoice:create", "invoice:approve"]);
        let rules = vec![json!({"permissionA":"invoice:create","permissionB":"invoice:approve"})];
        assert!(has_sod_conflict(&writer, &rules));
        assert!(work_actions(
            &row(),
            ActionContext {
                caller: &"cd".repeat(32),
                principal: &"cd".repeat(32),
                eligible: true,
                access: Some(&writer),
                actor_has_sod_conflict: false,
                sod_rules: &rules,
                unvoted_candidates: &[]
            }
        )
        .is_empty());
    }
}

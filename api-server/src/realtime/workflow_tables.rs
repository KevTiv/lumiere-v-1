//! API-owned invalidation resources over existing private workflow bindings.
//! Shared with build.rs; these are not public query/row-subscription grants.

pub(super) const WORKFLOW_INVALIDATION_TABLES: &[(&str, &str)] = &[
    ("workflow-human-tasks", "workflow_human_task"),
    (
        "workflow-candidate-group-members",
        "workflow_candidate_group_member",
    ),
    ("workflow-delegations", "workflow_delegation"),
];

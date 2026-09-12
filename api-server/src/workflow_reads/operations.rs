//! Workflow runtime, outbox and migration projections.
use super::enum_tag;
use serde_json::{json, Value};

pub(super) fn project_outbox(mut row: Value) -> Value {
    if let Some(obj) = row.as_object_mut() {
        obj.remove("payload");
    }
    row
}

pub(super) fn project_decision_event(mut row: Value) -> Value {
    if let Some(tag) = enum_tag(&row, "command_kind") {
        if let Some(obj) = row.as_object_mut() {
            obj.insert("commandKindTag".into(), json!(tag));
        }
    }
    row
}

pub(super) fn project_migration_plan(mut row: Value) -> Value {
    if let Some(tag) = enum_tag(&row, "compatibility") {
        if let Some(obj) = row.as_object_mut() {
            obj.insert("compatibilityTag".into(), json!(tag));
        }
    }
    // Mapping vectors can be large; list view uses ids/status only.
    if let Some(obj) = row.as_object_mut() {
        obj.remove("nodeMappings");
        obj.remove("node_mappings");
        obj.remove("forkMappings");
        obj.remove("fork_mappings");
        obj.remove("edgeMappings");
        obj.remove("edge_mappings");
    }
    row
}

pub(super) fn project_migration_preflight(mut row: Value) -> Value {
    if let Some(tag) = enum_tag(&row, "compatibility") {
        if let Some(obj) = row.as_object_mut() {
            obj.insert("compatibilityTag".into(), json!(tag));
        }
    }
    row
}

pub(super) fn project_migration_result(mut row: Value) -> Value {
    if let Some(tag) = enum_tag(&row, "outcome") {
        if let Some(obj) = row.as_object_mut() {
            obj.insert("outcomeTag".into(), json!(tag));
        }
    }
    row
}

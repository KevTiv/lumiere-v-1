//! Workflow definition projections.
use serde_json::Value;

pub(super) fn project_workflow_version(mut row: Value) -> Value {
    // snapshot_fields can be large; omit from list projection if present under either key.
    if let Some(obj) = row.as_object_mut() {
        obj.remove("snapshotFields");
        obj.remove("snapshot_fields");
    }
    row
}

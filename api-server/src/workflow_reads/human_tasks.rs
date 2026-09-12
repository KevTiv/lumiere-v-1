//! Human-task inbox and event projection.
use serde_json::{json, Value};

pub(super) fn project_human_task(
    mut row: Value,
    instance_revisions: &std::collections::HashMap<u64, u64>,
) -> Value {
    if let Some(obj) = row.as_object_mut() {
        let model = obj
            .get("subjectModel")
            .or_else(|| obj.get("subject_model"))
            .cloned()
            .unwrap_or(Value::Null);
        let subject_id = obj
            .get("subjectId")
            .or_else(|| obj.get("subject_id"))
            .cloned()
            .unwrap_or(Value::Null);
        let node_key = obj
            .get("nodeKey")
            .or_else(|| obj.get("node_key"))
            .cloned()
            .unwrap_or(Value::Null);
        obj.insert(
            "summary".into(),
            json!({
                "subjectModel": model,
                "subjectId": subject_id,
                "nodeKey": node_key,
            }),
        );
        let instance_id = obj
            .get("workflowInstanceId")
            .or_else(|| obj.get("workflow_instance_id"))
            .and_then(|v| {
                v.as_u64()
                    .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
            });
        if let Some(iid) = instance_id {
            if let Some(rev) = instance_revisions.get(&iid) {
                obj.insert("instanceRevision".into(), json!(*rev));
                obj.insert("instance_revision".into(), json!(*rev));
            }
        }
    }
    row
}

pub(super) fn project_task_event(row: Value) -> Value {
    row
}

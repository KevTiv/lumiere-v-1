use super::*;

fn readback(kind: &str, acting_for: Option<&str>) -> WorkTaskReadbackRequest {
    WorkTaskReadbackRequest::parse(
        "workflow-human-tasks",
        Some("finance"),
        Some(1),
        Some(kind),
        Some("attempt-1"),
        Some(&format!("sha256:{}", "12".repeat(32))),
        acting_for,
    )
    .unwrap()
    .unwrap()
}

fn records(kind: &str) -> (Value, Value, Value) {
    let decision = kind == "decision";
    let status = if decision { "Open" } else { "Claimed" };
    let task = json!({
        "id": 1, "organization_id":42, "company_id":7,
        "workflow_instance_id":101, "assignment":if decision {"AllCandidates"} else {"AnyCandidate"}, "revision":5,
        "requested_by":"ab".repeat(32), "status":"Open"
    });
    let receipt = json!({
        "scope_key":format!("42:1:{kind}:attempt-1"), "organization_id":42,
        "company_id":7, "task_id":1, "command_kind":if decision {"Decision"} else {"Claim"},
        "idempotency_key":"attempt-1", "input_hash":format!("sha256:{}", "12".repeat(32)),
        "result_status":status, "result_revision":2, "created_by":"cd".repeat(32),
        "domain_receipt":"PRIVATE BUSINESS PAYLOAD"
    });
    let event = json!({
        "id":10, "organization_id":42, "company_id":7, "task_id":1,
        "workflow_instance_id":101, "command_kind":if decision {"Decision"} else {"Claim"},
        "idempotency_key":"attempt-1", "input_hash":format!("sha256:{}", "12".repeat(32)),
        "prior_status":"Open", "next_status":status, "prior_revision":1, "next_revision":2,
        "decision":if decision {json!("Approve")} else {Value::Null},
        "actor":"cd".repeat(32), "acting_for":null, "comment":"PRIVATE COMMENT"
    });
    (task, receipt, event)
}

fn evidence(
    task: &Value,
    receipt: &Value,
    event: &Value,
    request: &WorkTaskReadbackRequest,
) -> Option<Value> {
    matching_evidence(
        task,
        receipt,
        event,
        request.attempt.as_ref().unwrap(),
        42,
        7,
        1,
        &"cd".repeat(32),
    )
    .map(|(evidence, _)| evidence)
}

#[test]
fn command_parameters_require_one_scoped_task_and_complete_canonical_attempt() {
    let hash = format!("sha256:{}", "12".repeat(32));
    let identity = "ef".repeat(32);
    for (resource, scope, task, kind, key, input, principal) in [
        (
            "workflow-human-tasks",
            None,
            Some(1),
            Some("claim"),
            Some("key"),
            Some(hash.as_str()),
            None,
        ),
        (
            "activities",
            Some("finance"),
            Some(1),
            Some("claim"),
            Some("key"),
            Some(hash.as_str()),
            None,
        ),
        (
            "workflow-human-tasks",
            Some("finance"),
            None,
            Some("claim"),
            Some("key"),
            Some(hash.as_str()),
            None,
        ),
        (
            "workflow-human-tasks",
            Some("finance"),
            Some(0),
            Some("claim"),
            Some("key"),
            Some(hash.as_str()),
            None,
        ),
        (
            "workflow-human-tasks",
            Some("finance"),
            Some(1),
            None,
            Some("key"),
            Some(hash.as_str()),
            None,
        ),
        (
            "workflow-human-tasks",
            Some("finance"),
            Some(1),
            Some("claim"),
            None,
            Some(hash.as_str()),
            None,
        ),
        (
            "workflow-human-tasks",
            Some("finance"),
            Some(1),
            Some("claim"),
            Some("key"),
            None,
            None,
        ),
        (
            "workflow-human-tasks",
            Some("finance"),
            Some(1),
            Some("invalidate"),
            Some("key"),
            Some(hash.as_str()),
            None,
        ),
        (
            "workflow-human-tasks",
            Some("finance"),
            Some(1),
            Some("claim"),
            Some(" \t"),
            Some(hash.as_str()),
            None,
        ),
        (
            "workflow-human-tasks",
            Some("finance"),
            Some(1),
            Some("claim"),
            Some("key"),
            Some("sha256:bad"),
            None,
        ),
        (
            "workflow-human-tasks",
            Some("finance"),
            Some(1),
            Some("claim"),
            Some("key"),
            Some(hash.as_str()),
            Some("unknown"),
        ),
        (
            "workflow-human-tasks",
            Some("finance"),
            Some(1),
            None,
            None,
            None,
            Some(identity.as_str()),
        ),
    ] {
        assert!(
            WorkTaskReadbackRequest::parse(resource, scope, task, kind, key, input, principal)
                .is_err()
        );
    }
    assert!(WorkTaskReadbackRequest::parse(
        "task-assignees",
        None,
        Some(1),
        None,
        None,
        None,
        None
    )
    .unwrap()
    .is_none());
    assert!(WorkTaskReadbackRequest::parse(
        "workflow-human-tasks",
        None,
        None,
        None,
        None,
        None,
        None
    )
    .unwrap()
    .is_none());
    assert!(WorkTaskReadbackRequest::parse(
        "workflow-human-tasks",
        Some("finance"),
        Some(1),
        None,
        None,
        None,
        None
    )
    .unwrap()
    .is_some());
    for key in ["k".repeat(257), "key\nnext".into()] {
        assert!(WorkTaskReadbackRequest::parse(
            "workflow-human-tasks",
            Some("finance"),
            Some(1),
            Some("claim"),
            Some(&key),
            Some(&hash),
            None
        )
        .is_err());
    }
    let board = WorkBoardRequest::parse(
        "workflow-human-tasks",
        Some(7),
        Some("finance"),
        None,
        None,
        Some("cursor"),
        None,
    )
    .unwrap()
    .unwrap();
    assert!(board.with_readback(Some(readback("claim", None))).is_err());
    assert_eq!(sql_text("reviewer's-key"), "'reviewer''s-key'");
}

#[test]
fn exact_read_ignores_presentation_but_retains_candidate_company_and_team_scope() {
    let scope = CandidateScope::test_scope();
    let caller = "cd".repeat(32);
    let mut board = WorkBoardRequest::parse(
        "workflow-human-tasks",
        Some(7),
        Some("finance"),
        Some("available"),
        Some("department:4"),
        None,
        None,
    )
    .unwrap()
    .unwrap()
    .with_readback(Some(readback("decision", None)))
    .unwrap();
    let mut task = json!({"organizationId":42,"companyId":7,"candidateRoleIds":[2],"candidateUnitIds":[4],"requestedBy":"ab".repeat(32),"status":"Approved","claimedBy":null});
    assert!(visible_row(&task, &board, 42, &caller, &scope));
    board.view = WorkView::Mine;
    assert!(visible_row(&task, &board, 42, &caller, &scope));
    task["candidateUnitIds"] = json!([5]);
    assert!(!visible_row(&task, &board, 42, &caller, &scope));
    task["candidateUnitIds"] = json!([4]);
    task["companyId"] = json!(8);
    assert!(!visible_row(&task, &board, 42, &caller, &scope));
    task["companyId"] = json!(7);
    board.team = None;
    task["candidateRoleIds"] = json!([99]);
    task["candidateUnitIds"] = json!([]);
    assert!(!visible_row(&task, &board, 42, &caller, &scope));
    task["claimedBy"] = json!(caller);
    assert!(visible_row(&task, &board, 42, &caller, &scope)); // Historical assignment remains readable.
}

#[test]
fn exact_receipt_and_event_bind_actor_principal_company_kind_key_and_input() {
    let request = readback("claim", None);
    let (task, receipt, event) = records("claim");
    let output = evidence(&task, &receipt, &event, &request).unwrap();
    assert_eq!(output["resultRevision"], "2");
    assert_eq!(output["decision"], Value::Null);
    assert_eq!(output["actorIdentityHex"], "cd".repeat(32));
    assert!(!output.to_string().contains("PRIVATE"));
    for (field, value) in [
        ("organization_id", json!(43)),
        ("company_id", json!(8)),
        ("task_id", json!(2)),
        ("command_kind", json!("Decision")),
        ("idempotency_key", json!("other-attempt")),
        ("input_hash", json!(format!("sha256:{}", "34".repeat(32)))),
    ] {
        let mut changed = receipt.clone();
        changed[field] = value.clone();
        assert!(
            evidence(&task, &changed, &event, &request).is_none(),
            "receipt {field}"
        );
        let mut changed = event.clone();
        changed[field] = value;
        assert!(
            evidence(&task, &receipt, &changed, &request).is_none(),
            "event {field}"
        );
    }
    let mut changed = receipt.clone();
    changed["created_by"] = json!("ef".repeat(32));
    assert!(evidence(&task, &changed, &event, &request).is_none());
    let mut changed = event.clone();
    changed["actor"] = json!("ef".repeat(32));
    assert!(evidence(&task, &receipt, &changed, &request).is_none());
    changed = event.clone();
    changed["acting_for"] = json!("ef".repeat(32));
    assert!(evidence(&task, &receipt, &changed, &request).is_none());
    let delegated = readback("claim", Some(&"ef".repeat(32)));
    assert!(evidence(&task, &receipt, &changed, &delegated).is_some());
    assert!(evidence(&task, &receipt, &event, &delegated).is_none());
    changed["acting_for"] = json!("invalid");
    assert!(evidence(&task, &receipt, &changed, &request).is_none());
}

#[test]
fn partial_approve_and_complete_confirm_own_attempt_even_after_a_later_vote() {
    let request = readback("decision", None);
    let (mut task, mut receipt, mut event) = records("decision");
    for decision in ["Approve", "Complete"] {
        event["decision"] = json!(decision);
        let output = evidence(&task, &receipt, &event, &request).unwrap();
        assert_eq!(output["decision"], decision.to_ascii_lowercase());
        assert_eq!(output["resultStatus"], "Open");
        assert_eq!(output["resultRevision"], "2");
    }
    event["decision"] = json!("Reject");
    assert!(evidence(&task, &receipt, &event, &request).is_none());
    event["next_status"] = json!("Rejected");
    receipt["result_status"] = json!("Rejected");
    assert!(evidence(&task, &receipt, &event, &request).is_some());
    task["revision"] = json!(1);
    assert!(evidence(&task, &receipt, &event, &request).is_none());
    task["revision"] = json!(5);
    for (field, value) in [
        ("prior_revision", json!(0)),
        ("prior_revision", json!(2)),
        ("next_revision", json!(3)),
        ("workflow_instance_id", json!(102)),
        ("next_status", json!("Approved")),
    ] {
        let mut changed = event.clone();
        changed[field] = value;
        assert!(
            evidence(&task, &receipt, &changed, &request).is_none(),
            "{field}"
        );
    }
    receipt["result_revision"] = json!(3);
    assert!(evidence(&task, &receipt, &event, &request).is_none());
}

#[test]
fn evidence_authority_is_live_without_requiring_an_unvoted_or_open_task() {
    fn authority<'a>(
        caller: &'a str,
        principal: &'a str,
        access: &'a FieldAccessContext,
        eligible: bool,
    ) -> ActionContext<'a> {
        ActionContext {
            caller,
            principal,
            eligible,
            access: Some(access),
            actor_has_sod_conflict: false,
            sod_rules: &[],
            unvoted_candidates: &[],
        }
    }
    let (mut task, _, _) = records("decision");
    let caller = "cd".repeat(32);
    let principal = "ef".repeat(32);
    let mut access = FieldAccessContext {
        role_permissions: vec!["workflow_task:approve".into()],
        ..FieldAccessContext::default()
    };
    task["status"] = json!("Approved");
    assert!(may_read_command_evidence(
        &task,
        &authority(&caller, &principal, &access, true),
        WorkAction::Approve
    ));
    assert!(!may_read_command_evidence(
        &task,
        &authority(&caller, &principal, &access, false),
        WorkAction::Approve
    ));
    assert!(!may_read_command_evidence(
        &task,
        &authority(&caller, &principal, &access, true),
        WorkAction::Reject
    ));
    task["requested_by"] = json!(principal);
    assert!(!may_read_command_evidence(
        &task,
        &authority(&caller, &principal, &access, true),
        WorkAction::Approve
    ));
    task["requested_by"] = json!(caller);
    assert!(!may_read_command_evidence(
        &task,
        &authority(&caller, &principal, &access, true),
        WorkAction::Approve
    ));
    task["requested_by"] = json!("ab".repeat(32));
    access.role_permissions.clear();
    assert!(!may_read_command_evidence(
        &task,
        &authority(&caller, &principal, &access, true),
        WorkAction::Approve
    ));
}

#[test]
fn resubmission_requires_an_exact_cancelled_to_cancelled_event_without_a_principal() {
    let request = readback("resubmit", None);
    let (mut task, mut receipt, mut event) = records("claim");
    task["status"] = json!("Cancelled");
    receipt["command_kind"] = json!("Resubmit");
    receipt["scope_key"] = json!("42:1:resubmit:attempt-1");
    receipt["result_status"] = json!("Cancelled");
    event["command_kind"] = json!("Resubmit");
    event["prior_status"] = json!("Cancelled");
    event["next_status"] = json!("Cancelled");
    let output = evidence(&task, &receipt, &event, &request).unwrap();
    assert_eq!(output["commandKind"], "resubmit");
    assert_eq!(output["decision"], Value::Null);
    assert_eq!(output["resultStatus"], "Cancelled");
    for (field, value) in [
        ("prior_status", json!("Open")),
        ("next_status", json!("Open")),
        ("decision", json!("Approve")),
        ("acting_for", json!("ef".repeat(32))),
    ] {
        let mut changed = event.clone();
        changed[field] = value;
        assert!(
            evidence(&task, &receipt, &changed, &request).is_none(),
            "{field}"
        );
    }
    task["status"] = json!("Open");
    assert!(evidence(&task, &receipt, &event, &request).is_none());
    assert!(WorkTaskReadbackRequest::parse(
        "workflow-human-tasks",
        Some("finance"),
        Some(1),
        Some("resubmit"),
        Some("attempt-1"),
        Some(&format!("sha256:{}", "12".repeat(32))),
        Some(&"ef".repeat(32)),
    )
    .is_err());
}

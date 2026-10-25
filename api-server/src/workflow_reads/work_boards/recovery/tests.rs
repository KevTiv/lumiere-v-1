use super::*;
use lumiere_contracts::bindings::WorkflowTaskGuardedAction;
use spacetimedb_sats::serde::SerdeWrapper;
use stdb_auth::ActionPermission;

fn access() -> FieldAccessContext {
    FieldAccessContext {
        organization_id: 42,
        role_permissions: [
            "workflow_instance:create",
            "workflow_task:write",
            "purchase_order:read",
            "purchase_order:write",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect(),
        ..FieldAccessContext::default()
    }
}

fn task(model: &str, key: GuardedActionKey) -> Value {
    json!({
        "id":1, "organization_id":42, "company_id":7, "workflow_instance_id":101,
        "subject_model":model, "subject_id":201, "status":"Cancelled", "revision":5,
        "instanceRevision":8, "subject_revision_hash":"material-hash",
        "guarded_action":serde_json::to_value(SerdeWrapper::from_ref(&WorkflowTaskGuardedAction { key, schema_version:1 })).unwrap(),
    })
}

#[test]
fn recovery_requires_current_own_management_source_and_registered_operation_grants() {
    let row = task("purchase_order", GuardedActionKey::ConfirmPurchaseOrder);
    let actor = access();
    assert!(has_authority(&row, &actor));
    // Approval is a different authority: recovery does not cast a vote.
    assert!(!actor
        .role_permissions
        .iter()
        .any(|grant| grant == "workflow_task:approve"));
    for missing in &actor.role_permissions {
        let mut revoked = actor.clone();
        revoked.role_permissions.retain(|grant| grant != missing);
        assert!(!has_authority(&row, &revoked), "{missing}");
    }
    for (resource, action) in [
        ("workflow_instance", "create"),
        ("workflow_task", "write"),
        ("purchase_order", "read"),
        ("purchase_order", "write"),
    ] {
        let mut denied = actor.clone();
        denied.org_permissions.push(ActionPermission {
            resource: resource.into(),
            action: action.into(),
            allow: false,
        });
        assert!(!has_authority(&row, &denied), "{resource}:{action}");
    }
    let mut other_org = actor.clone();
    other_org.organization_id = 43;
    assert!(!has_authority(&row, &other_org));
    assert!(has_authority(
        &task("purchase_order", GuardedActionKey::SendPurchaseOrder),
        &actor
    ));
    assert!(!has_authority(
        &task("purchase_order", GuardedActionKey::PostPayment),
        &actor
    ));
    assert!(!has_authority(
        &task("sale_order", GuardedActionKey::ConfirmSalesOrder),
        &actor
    ));
    let payment = task("account_payment", GuardedActionKey::PostPayment);
    let mut payment_actor = actor;
    payment_actor
        .role_permissions
        .extend(["account_payment:read".into(), "payment:post".into()]);
    assert!(has_authority(&payment, &payment_actor));
    payment_actor
        .role_permissions
        .retain(|grant| grant != "payment:post");
    assert!(!has_authority(&payment, &payment_actor));
}

#[test]
fn payment_hint_requires_a_complete_valid_bank_link_set() {
    assert_eq!(complete_bank_links(&[]), Some(HashSet::new()));
    let ids = complete_bank_links(&[json!({"payment_ids":[1,"2"]}), json!({"payment_ids":[2,3]})])
        .unwrap();
    assert_eq!(ids, HashSet::from([1, 2, 3]));
    assert!(complete_bank_links(&vec![json!({"payment_ids":[]}); MAX_BANK_LINES + 1]).is_none());
    for line in [
        json!({}),
        json!({"payment_ids":null}),
        json!({"payment_ids":[0]}),
        json!({"payment_ids":["bad"]}),
    ] {
        assert!(complete_bank_links(&[line]).is_none());
    }
}

#[test]
fn recovery_hint_respects_the_registered_operation_source_state() {
    for state in ["Draft", "Sent", "ToApprove"] {
        assert!(source_state_permits(
            &GuardedActionKey::ConfirmPurchaseOrder,
            Some(state)
        ));
        assert_eq!(
            source_state_permits(&GuardedActionKey::SendPurchaseOrder, Some(state)),
            state == "Draft"
        );
    }
    assert!(source_state_permits(
        &GuardedActionKey::PostPayment,
        Some("NotPaid")
    ));
    for state in [
        None,
        Some("Paid"),
        Some("Reversed"),
        Some("Cancelled"),
        Some("Purchase"),
    ] {
        assert!(!source_state_permits(&GuardedActionKey::PostPayment, state));
        assert!(!source_state_permits(
            &GuardedActionKey::ConfirmPurchaseOrder,
            state
        ));
    }
}

fn evidence() -> Value {
    json!({
        "organizationId":"42", "companyId":"7", "taskId":"1", "workflowInstanceId":"101",
        "eventId":"10", "commandKind":"resubmit", "idempotencyKey":"rétry", "inputHash":"sha256:exact",
        "actorIdentityHex":"cd".repeat(32), "actingForIdentityHex":null, "decision":null,
        "priorRevision":"4", "resultRevision":"5", "resultStatus":"Cancelled",
    })
}

fn link() -> Value {
    json!({
        "previous_task_id":1, "scope_key":"42:7:6:rétry", "organization_id":42, "company_id":7,
        "expected_task_revision":4, "expected_instance_revision":8, "expected_subject_revision_hash":"material-hash",
        "result_task_revision":5, "event_id":10, "successor_task_id":2, "successor_instance_id":102,
        "successor_task_revision":1, "successor_instance_revision":3,
        "idempotency_key":"rétry", "input_hash":"sha256:exact", "created_by":"cd".repeat(32),
        "reason":"PRIVATE REASON", "correlation_id":"PRIVATE CORRELATION",
    })
}

#[test]
fn recovery_link_binds_exact_event_actor_revisions_and_successor_without_payload() {
    let row = task("purchase_order", GuardedActionKey::ConfirmPurchaseOrder);
    let caller = "cd".repeat(32);
    let output = matching_link(&row, &link(), evidence(), 42, 7, &caller).unwrap();
    assert_eq!(output["priorInstanceRevision"], "8");
    assert_eq!(output["subjectRevisionHash"], "material-hash");
    assert_eq!(output["successorTaskId"], "2");
    assert_eq!(output["successorInstanceId"], "102");
    assert_eq!(output["successorTaskRevision"], "1");
    assert_eq!(output["successorInstanceRevision"], "3");
    assert!(!output.to_string().contains("PRIVATE"));
    for (field, value) in [
        ("organization_id", json!(43)),
        ("company_id", json!(8)),
        ("previous_task_id", json!(2)),
        ("scope_key", json!("42:7:5:rétry")),
        ("event_id", json!(11)),
        ("expected_task_revision", json!(3)),
        ("result_task_revision", json!(6)),
        ("expected_instance_revision", json!(0)),
        ("expected_instance_revision", json!(9)),
        ("expected_subject_revision_hash", json!("changed")),
        ("idempotency_key", json!("other")),
        ("input_hash", json!("sha256:other")),
        ("created_by", json!("ef".repeat(32))),
        ("successor_task_id", json!(1)),
        ("successor_task_id", json!(0)),
        ("successor_instance_id", json!(101)),
        ("successor_instance_id", json!(0)),
        ("successor_task_revision", json!(0)),
        ("successor_instance_revision", json!(0)),
    ] {
        let mut changed = link();
        changed[field] = value;
        assert!(
            matching_link(&row, &changed, evidence(), 42, 7, &caller).is_none(),
            "{field}"
        );
    }
    // The link contains immutable creation revisions. A later successor vote
    // does not replace them or require a read of that actor's current electorate.
    let mut later = row;
    later["revision"] = json!(6);
    assert!(matching_link(&later, &link(), evidence(), 42, 7, &caller).is_some());
}

//! Necessary operation permission hints for the existing guarded adapters.
//! Dynamic stock, employee, business-state and field validations remain native.

use lumiere_contracts::bindings::{GuardedActionKey, WorkflowTaskGuardedAction};
use serde_json::Value;
use spacetimedb_sats::serde::SerdeWrapper;
use stdb_auth::{permission_allowed, FieldAccessContext};

use super::{cell, enum_tag};

/// Prospective final approvals must also have the adapter's canonical operation
/// permission. This does not apply to claims, rejects, completion-only tasks,
/// earlier quorum votes or immutable evidence for an already executed command.
pub(super) fn may_execute_approval(
    row: &Value,
    actor: &FieldAccessContext,
    unvoted_count: usize,
) -> bool {
    if enum_tag(row, "assignment").as_deref() == Some("AllCandidates") && unvoted_count > 1 {
        return true;
    }
    let Some(guarded) = cell(row, "guardedAction", "guarded_action") else {
        return false;
    };
    if guarded.is_null() {
        return true;
    }
    let Some(action) = guarded_action(row) else {
        return false;
    };
    let Some(model) = cell(row, "subjectModel", "subject_model").and_then(Value::as_str) else {
        return false;
    };
    let permissions: &[(&str, &str)] = match (model, action.key) {
        (
            "purchase_order",
            GuardedActionKey::ConfirmPurchaseOrder | GuardedActionKey::SendPurchaseOrder,
        ) => &[("purchase_order", "write")],
        ("sale_order", GuardedActionKey::ConfirmSalesOrder) => &[("sale_order", "confirm")],
        ("account_move", GuardedActionKey::PostAccountMove) => &[("account_move", "write")],
        ("account_payment", GuardedActionKey::PostPayment) => &[("payment", "post")],
        ("hr_expense_sheet", GuardedActionKey::ApproveExpenseSheet) => {
            &[("hr_expense_sheet", "approve")]
        }
        ("account_payment", GuardedActionKey::ReverseBankStatementSettlement) => &[
            ("account_bank_statement_line", "write"),
            ("account_bank_statement", "write"),
            ("payment", "reverse"),
            ("account_move", "write"),
        ],
        _ => return false,
    };
    permissions
        .iter()
        .all(|(resource, action)| permission_allowed(actor, resource, action))
}

pub(super) fn guarded_action(row: &Value) -> Option<WorkflowTaskGuardedAction> {
    let guarded = cell(row, "guardedAction", "guarded_action")?;
    // query_sql unwraps Option but retains this SATS product/enum. Decode the
    // pinned generated type rather than copying its numeric variant mapping.
    if !strict_product_shape(guarded) {
        return None;
    }
    let SerdeWrapper(action) =
        serde_json::from_value::<SerdeWrapper<WorkflowTaskGuardedAction>>(guarded.clone()).ok()?;
    (action.schema_version == 1).then_some(action)
}

fn strict_product_shape(value: &Value) -> bool {
    let key = match value {
        Value::Array(fields) if fields.len() == 2 => &fields[0],
        Value::Object(fields) if fields.len() == 2 && fields.contains_key("schema_version") => {
            let Some(key) = fields.get("key") else {
                return false;
            };
            key
        }
        _ => return false,
    };
    match key {
        Value::Array(variant) if variant.len() == 2 => {
            variant[0].as_u64().is_some() && variant[1].as_array().is_some_and(Vec::is_empty)
        }
        Value::Object(variant) if variant.len() == 1 => variant.values().all(|payload| {
            payload.as_array().is_some_and(Vec::is_empty)
                || payload.as_object().is_some_and(serde_json::Map::is_empty)
        }),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use stdb_auth::ActionPermission;

    fn access(permissions: &[&str]) -> FieldAccessContext {
        FieldAccessContext {
            role_permissions: permissions.iter().map(|value| (*value).into()).collect(),
            ..FieldAccessContext::default()
        }
    }

    fn task(model: &str, key: GuardedActionKey) -> Value {
        let action = WorkflowTaskGuardedAction {
            key,
            schema_version: 1,
        };
        json!({
            "subjectModel":model, "assignment":"AnyCandidate",
            "guardedAction":serde_json::to_value(SerdeWrapper::from_ref(&action)).unwrap()
        })
    }

    #[test]
    fn guarded_adapters_require_only_their_known_top_level_operation_permissions() {
        for (model, key, required) in [
            (
                "purchase_order",
                GuardedActionKey::ConfirmPurchaseOrder,
                "purchase_order:write",
            ),
            (
                "purchase_order",
                GuardedActionKey::SendPurchaseOrder,
                "purchase_order:write",
            ),
            (
                "sale_order",
                GuardedActionKey::ConfirmSalesOrder,
                "sale_order:confirm",
            ),
            (
                "account_move",
                GuardedActionKey::PostAccountMove,
                "account_move:write",
            ),
            (
                "account_payment",
                GuardedActionKey::PostPayment,
                "payment:post",
            ),
            (
                "hr_expense_sheet",
                GuardedActionKey::ApproveExpenseSheet,
                "hr_expense_sheet:approve",
            ),
        ] {
            let row = task(model, key);
            assert!(!may_execute_approval(
                &row,
                &access(&["workflow_task:approve"]),
                0
            ));
            // Stock/employee validations are intentionally left to the reducer.
            assert!(may_execute_approval(&row, &access(&[required]), 0));
        }
        let row = task(
            "account_payment",
            GuardedActionKey::ReverseBankStatementSettlement,
        );
        assert!(!may_execute_approval(
            &row,
            &access(&["payment:reverse"]),
            0
        ));
        assert!(may_execute_approval(
            &row,
            &access(&[
                "account_bank_statement_line:write",
                "account_bank_statement:write",
                "payment:reverse",
                "account_move:write"
            ]),
            0
        ));
    }

    #[test]
    fn explicit_deny_wins_and_earlier_quorum_votes_do_not_execute_the_adapter() {
        let mut row = task("purchase_order", GuardedActionKey::ConfirmPurchaseOrder);
        let mut actor = access(&["purchase_order:*"]);
        actor.org_permissions.push(ActionPermission {
            resource: "purchase_order".into(),
            action: "write".into(),
            allow: false,
        });
        assert!(!may_execute_approval(&row, &actor, 0));
        row["assignment"] = json!("AllCandidates");
        assert!(may_execute_approval(&row, &actor, 2));
        assert!(!may_execute_approval(&row, &actor, 1));
        row["guardedAction"] = Value::Null;
        assert!(may_execute_approval(&row, &actor, 1));
    }

    #[test]
    fn unknown_malformed_or_wrong_subject_guarded_actions_fail_closed() {
        let actor = access(&["*:*"]);
        let mut row = task("purchase_order", GuardedActionKey::ConfirmPurchaseOrder);
        // Actual array-form product and unit enum returned by HTTP SQL.
        row["guardedAction"] = json!([[0, []], 1]);
        assert!(may_execute_approval(&row, &actor, 0));
        for guarded in [
            json!([[0, []], 2]),
            json!([[0, []], 1, "extra"]),
            json!([[255, []], 1]),
            json!([[0, ["payload"]], 1]),
            json!({"key":{"ConfirmPurchaseOrder":[]},"schema_version":1,"input":"private"}),
            json!({"key":{"Unknown":[]},"schema_version":1}),
            json!({}),
            json!("ConfirmPurchaseOrder"),
        ] {
            row["guardedAction"] = guarded;
            assert!(!may_execute_approval(&row, &actor, 0));
        }
        row.as_object_mut().unwrap().remove("guardedAction");
        assert!(!may_execute_approval(&row, &actor, 0));
        assert!(!may_execute_approval(
            &task("purchase_order", GuardedActionKey::PostPayment),
            &actor,
            0
        ));
        assert!(!may_execute_approval(
            &task("purchase_order", GuardedActionKey::ApproveAiActionDraft),
            &actor,
            0
        ));
    }
}

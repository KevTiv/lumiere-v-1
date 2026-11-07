//! Discoverable import paths. This catalog never grants permission to execute them.

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Readiness {
    TaskExecution,
    NativePreview,
    EvidenceOnly,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Capability {
    key: &'static str,
    module: &'static str,
    label: &'static str,
    target_entities: &'static [&'static str],
    required_facts: &'static [&'static str],
    readiness: Readiness,
    blocking_reason: Option<&'static str>,
    destination: &'static str,
}

/// Keep availability in the server that owns dispatch, rather than in each client.
pub(super) fn catalog() -> Vec<Capability> {
    vec![
        Capability {
            key: "historical_expense_journals",
            module: "accounting",
            label: "Historical expense journals",
            target_entities: &["account_move", "account_move_line"],
            required_facts: &[
                "confirmed expense classification",
                "confirmed positive amount",
                "confirmed date or explicit posting date",
                "company journal, debit account, credit account and currency",
            ],
            readiness: Readiness::TaskExecution,
            blocking_reason: None,
            destination: "/accounting",
        },
        native("products", "products", "Product master records", &["product"], &["name", "category", "unit", "reviewed prices"], "/products"),
        native("contacts", "sales", "Customer and supplier contacts", &["contact"], &["name", "customer or supplier role"], "/sales"),
        native("warehouse_locations", "warehouse", "Warehouse locations", &["stock_location"], &["name", "location type", "parent location"], "/warehouse"),
        held("sales_history", "sales", "Historical sales", &["sale_order", "sale_order_line"], "Resolve customer, product, units, historical prices, tax and document identity before preparing orders.", "/sales"),
        held("crm_history", "crm", "CRM history", &["crm_lead"], "CRM CSV import remains subject to its existing feature gate and permissions; a saved-task execution adapter is not available.", "/crm"),
        held("purchasing_history", "purchasing", "Historical purchases", &["purchase_order", "purchase_order_line"], "Resolve supplier, product, units, historical prices, tax and document identity before preparing purchases.", "/purchasing"),
        held("historical_reports", "reports", "Historical report evidence", &[], "Reports consume verified ERP records and explicitly dated source evidence; importing a report does not create transactions.", "/reports"),
        held("subscriptions", "subscriptions", "Subscriptions", &["subscription"], "Confirm customer, recurring terms, dates and opening balances before preparing subscriptions.", "/subscriptions"),
        held("employee_expenses", "expenses", "Employee expense claims", &["expense"], "Historical expense journals are available in Accounting; employee claims require employee, policy and settlement decisions.", "/expenses"),
        held("stock_history", "warehouse", "Historical stock movements", &["stock_move"], "Resolve item identity, dated movement direction, locations and units; an old stock report must not become current stock.", "/warehouse"),
        held("fleet_history", "fleet", "Fleet history", &["fleet_vehicle"], "Resolve vehicle and service identities, dates and costs before preparing fleet records.", "/fleet"),
        held("overview", "overview", "Verified overview totals", &[], "Overview totals are derived from verified records; source observations remain labeled separately.", "/overview"),
        held("tasks", "tasks", "Import follow-up tasks", &[], "Unresolved import decisions remain attached to their saved task; source rows do not automatically create operational tasks.", "/tasks"),
        held("approvals", "approvals", "Import approvals", &[], "Proposal approval uses the current company policy and the exact proposal revision; source text is not an approval.", "/approvals"),
        held("documents", "documents", "Original source documents", &[], "Original files remain attached to the saved import; document descriptions do not imply ERP transactions.", "/documents"),
        held("calendar", "calendar", "Dated source evidence", &[], "A source date does not automatically create a calendar event.", "/calendar"),
        held("settings", "settings", "Import setup", &[], "Company settings and accounting references must be configured through their existing authorized workflows.", "/settings"),
        held("ai_assistant", "ai-assistant", "Import assistance", &[], "Chat reads the same saved task and decisions; suggested interpretations require confirmation before execution.", "/ai-assistant"),
    ]
}

fn native(
    key: &'static str,
    module: &'static str,
    label: &'static str,
    target_entities: &'static [&'static str],
    required_facts: &'static [&'static str],
    destination: &'static str,
) -> Capability {
    Capability {
        key,
        module,
        label,
        target_entities,
        required_facts,
        readiness: Readiness::NativePreview,
        blocking_reason: None,
        destination,
    }
}

fn held(
    key: &'static str,
    module: &'static str,
    label: &'static str,
    target_entities: &'static [&'static str],
    reason: &'static str,
    destination: &'static str,
) -> Capability {
    Capability {
        key,
        module,
        label,
        target_entities,
        required_facts: &[],
        readiness: Readiness::EvidenceOnly,
        blocking_reason: Some(reason),
        destination,
    }
}

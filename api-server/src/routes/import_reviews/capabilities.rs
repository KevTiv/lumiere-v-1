//! Discoverable import paths. This catalog never grants permission to execute them.

use serde::{Deserialize, Serialize};

use super::module_backfill::Module;

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Readiness {
    TaskExecution,
    NativePreview,
    ReviewedRecords,
    EvidenceOnly,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Capability {
    key: &'static str,
    version: u8,
    module: &'static str,
    label: &'static str,
    target_entities: &'static [&'static str],
    required_facts: &'static [&'static str],
    readiness: Readiness,
    blocking_reason: Option<&'static str>,
    destination: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    reviewed_record: Option<&'static ReviewedRecord>,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
enum ReviewInput {
    Customer,
}

struct SourceShape {
    keys: &'static [&'static str],
    labels: &'static [&'static str],
}

#[derive(Deserialize)]
pub(super) struct SourceItem {
    fields: Vec<SourceField>,
}

#[derive(Deserialize)]
struct SourceField {
    key: String,
    label: String,
}

impl SourceShape {
    fn matches(&self, item: &SourceItem) -> bool {
        (!self.keys.is_empty()
            && self
                .keys
                .iter()
                .all(|key| item.fields.iter().any(|field| field.key == *key)))
            || (!self.labels.is_empty()
                && self
                    .labels
                    .iter()
                    .all(|label| item.fields.iter().any(|field| field.label == *label)))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewedRecord {
    dispatch: Module,
    inputs: &'static [ReviewInput],
    preview_fields: &'static [PreviewField],
    #[serde(skip)]
    source_shape: SourceShape,
}

#[derive(Serialize)]
struct PreviewField {
    key: &'static str,
    label: &'static str,
}

const fn field(key: &'static str, label: &'static str) -> PreviewField {
    PreviewField { key, label }
}

const CUSTOMER_SALES: ReviewedRecord = ReviewedRecord {
    dispatch: Module::Sales,
    inputs: &[ReviewInput::Customer],
    preview_fields: &[
        field("customer", "Customer"),
        field("product", "Product"),
        field("quantity", "Quantity"),
        field("unit", "Unit"),
        field("unitPrice", "Unit price"),
        field("amount", "Total"),
        field("currency", "Currency"),
    ],
    source_shape: SourceShape {
        keys: &["customer_label", "quantity", "unit_price", "amount"],
        labels: &["Source customer label", "Recorded sales total (RWF)"],
    },
};

const INVENTORY_COUNTS: ReviewedRecord = ReviewedRecord {
    dispatch: Module::Warehouse,
    inputs: &[],
    preview_fields: &[
        field("product", "Product"),
        field("pieces", "Pieces"),
        field("kilograms", "Weight (kg)"),
    ],
    source_shape: SourceShape {
        keys: &["pieces", "kilograms"],
        labels: &["Recorded piece count", "Recorded weight (kg)"],
    },
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReviewOperation<'a> {
    key: &'static str,
    version: u8,
    label: &'static str,
    destination: &'static str,
    reviewed_record: &'static ReviewedRecord,
    item_ids: Vec<&'a str>,
}

/// Candidates come from the server's routes and immutable source shape. The
/// owning operation rechecks permissions, revisions, and values at execution.
pub(super) fn review_operations<'a>(
    target: &str,
    items: &'a [(String, SourceItem)],
) -> Vec<ReviewOperation<'a>> {
    catalog()
        .into_iter()
        .filter(|capability| capability.target_entities.contains(&target))
        .filter_map(|capability| {
            let reviewed_record = capability.reviewed_record?;
            let item_ids: Vec<_> = items
                .iter()
                .filter(|(_, item)| reviewed_record.source_shape.matches(item))
                .map(|(id, _)| id.as_str())
                .collect();
            (!item_ids.is_empty()).then_some(ReviewOperation {
                key: capability.key,
                version: capability.version,
                label: capability.label,
                destination: capability.destination,
                reviewed_record,
                item_ids,
            })
        })
        .collect()
}

/// Keep availability in the server that owns dispatch, rather than in each client.
pub(super) fn catalog() -> Vec<Capability> {
    vec![
        Capability {
            key: "historical_expense_journals",
            version: 1,
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
            destination: "/accounting?tab=journal-entries",
            reviewed_record: None,
        },
        native("products", "products", "Product master records", &["product"], &["name", "category", "unit", "reviewed prices"], "/products"),
        native("contacts", "crm", "Customer and supplier contacts", &["contact"], &["name", "customer or supplier role"], "/crm?tab=contacts"),
        native("warehouse_locations", "warehouse", "Warehouse locations", &["stock_location"], &["name", "location type", "parent location"], "/warehouse?tab=locations"),
        Capability {
            key: "customer_sales_backfill",
            version: 1,
            module: "sales",
            label: "Customer sales summaries",
            target_entities: &["source_observation"],
            required_facts: &["customer match", "product or summary scope", "report period", "quantity, unit price, and total"],
            readiness: Readiness::ReviewedRecords,
            blocking_reason: None,
            destination: "/sales?tab=customer-sales",
            reviewed_record: Some(&CUSTOMER_SALES),
        },
        held("sales_history", "sales", "Historical sales", &["sale_order", "sale_order_line"], "Resolve customer, product, units, historical prices, tax and document identity before preparing orders.", "/sales"),
        held("crm_history", "crm", "CRM history", &["crm_lead"], "CRM CSV import remains subject to its existing feature gate and permissions; a saved-task execution adapter is not available.", "/crm"),
        held("purchasing_history", "purchasing", "Historical purchases", &["purchase_order", "purchase_order_line"], "Resolve supplier, product, units, historical prices, tax and document identity before preparing purchases.", "/purchasing"),
        held("historical_reports", "reports", "Historical report evidence", &[], "Reports consume verified ERP records and explicitly dated source evidence; importing a report does not create transactions.", "/reports"),
        held("subscriptions", "subscriptions", "Subscriptions", &["subscription"], "Confirm customer, recurring terms, dates and opening balances before preparing subscriptions.", "/subscriptions"),
        held("employee_expenses", "expenses", "Employee expense claims", &["expense"], "Historical expense journals are available in Accounting; employee claims require employee, policy and settlement decisions.", "/expenses"),
        held("opening_balances", "accounting", "Opening balances", &["account_move", "account_move_line"], "Confirm the cutover date, account and currency references, and balancing entries. The saved expense workflow cannot prepare opening balances.", "/accounting?tab=journal-entries"),
        held("historical_payments", "accounting", "Historical payments", &["account_payment"], "Use Accounting’s payment workflows with confirmed settlement, journal and document references. The saved task keeps source evidence for payments.", "/accounting?tab=payments"),
        Capability {
            key: "inventory_count_backfill",
            version: 1,
            module: "warehouse",
            label: "Dated inventory counts",
            target_entities: &["source_observation"],
            required_facts: &["count date", "product label", "piece count", "weight in kilograms"],
            readiness: Readiness::ReviewedRecords,
            blocking_reason: None,
            destination: "/warehouse?tab=recorded-counts",
            reviewed_record: Some(&INVENTORY_COUNTS),
        },
        held("stock_counts", "warehouse", "Stock counts", &["stock_cycle_count"], "Confirm a count date, item, location, unit and quantity in Warehouse. Historical counts stay available as dated evidence.", "/warehouse?tab=cycle-counts"),
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
        version: 1,
        module,
        label,
        target_entities,
        required_facts,
        readiness: Readiness::NativePreview,
        blocking_reason: None,
        destination,
        reviewed_record: None,
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
        version: 1,
        module,
        label,
        target_entities,
        required_facts: &[],
        readiness: Readiness::EvidenceOnly,
        blocking_reason: Some(reason),
        destination,
        reviewed_record: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn row(id: &str, fields: &[(&str, &str)]) -> (String, SourceItem) {
        (
            id.into(),
            SourceItem {
                fields: fields
                    .iter()
                    .map(|(key, label)| SourceField {
                        key: (*key).into(),
                        label: (*label).into(),
                    })
                    .collect(),
            },
        )
    }

    #[test]
    fn discovers_registered_operations_from_canonical_keys_and_legacy_labels() {
        let items = [
            row(
                "5",
                &[
                    ("customer_label", "Client"),
                    ("quantity", "Quantité"),
                    ("unit_price", "Prix"),
                    ("amount", "Total"),
                ],
            ),
            row(
                "6",
                &[
                    ("count", "Recorded piece count"),
                    ("weight", "Recorded weight (kg)"),
                ],
            ),
            row("7", &[("pieces", "Pièces")]),
        ];
        assert!(review_operations("product", &items).is_empty());
        let operations = review_operations("source_observation", &items);
        assert_eq!(operations.len(), 2);
        assert_eq!(operations[0].key, "customer_sales_backfill");
        assert_eq!(operations[0].item_ids, ["5"]);
        assert_eq!(operations[1].key, "inventory_count_backfill");
        assert_eq!(operations[1].item_ids, ["6"]);
        let projected = serde_json::to_value(&operations).unwrap();
        assert_eq!(projected[0]["reviewedRecord"]["dispatch"], "sales");
        assert_eq!(
            projected[0]["reviewedRecord"]["inputs"],
            json!(["customer"])
        );
        assert_eq!(
            projected[1]["destination"],
            "/warehouse?tab=recorded-counts"
        );
        assert_eq!(
            projected[1]["reviewedRecord"]["previewFields"][2]["key"],
            "kilograms"
        );
    }

    #[test]
    fn does_not_offer_shop_sales_without_its_owning_operation() {
        let items = [row(
            "8",
            &[
                ("shop", "Boutique"),
                ("sale_date", "Date"),
                ("product_label", "Produit"),
                ("sold_quantity", "Quantité"),
                ("sale_unit_price", "Prix"),
                ("sale_amount", "Total"),
                ("currency_code", "Devise"),
            ],
        )];
        assert!(review_operations("source_observation", &items).is_empty());
    }
}

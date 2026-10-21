//! Canonical query resource registry (`crates/stdb-auth/assets/resource_registry.json`).
//!
//! Edit the JSON asset, then run `make codegen` to refresh TypeScript `query-registry.ts`.

use once_cell::sync::Lazy;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize)]
pub struct ResourceEntry {
    pub table: String,
    pub aliases: Vec<String>,
    #[serde(rename = "default_restricted")]
    pub default_restricted: Vec<String>,
    pub mandatory: Vec<String>,
}

static RESOURCE_REGISTRY: Lazy<HashMap<String, ResourceEntry>> = Lazy::new(|| {
    serde_json::from_str(include_str!("../assets/resource_registry.json"))
        .expect("resource_registry.json must be valid JSON")
});

/// Lookup a registered query resource by key (e.g. `"leads"`).
pub fn registry_get(key: &str) -> Option<&ResourceEntry> {
    RESOURCE_REGISTRY.get(key)
}

/// All registered query resource keys.
pub fn registry_keys() -> Vec<String> {
    let mut keys: Vec<String> = RESOURCE_REGISTRY.keys().cloned().collect();
    keys.sort();
    keys
}

/// JSON registry for codegen and tooling (canonical Rust-owned asset).
pub fn registry_json() -> &'static str {
    include_str!("../assets/resource_registry.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_timesheet_approvals_resolve_to_the_canonical_table() {
        let entry = registry_get("project-timesheet-approvals")
            .expect("project timesheet approvals must be registered");

        assert_eq!(entry.table, "project_timesheet_approval");
        assert!(entry
            .mandatory
            .iter()
            .any(|field| field == "organization_id"));
    }

    #[test]
    fn fleet_lifecycle_resources_resolve_to_canonical_tables() {
        for (resource, table) in [
            ("fleet-service-types", "fleet_vehicle_service_type"),
            ("fleet-service-records", "fleet_service_record"),
            ("fleet-inspections", "fleet_inspection"),
        ] {
            let entry = registry_get(resource).expect("Fleet resource must be registered");
            assert_eq!(entry.table, table);
            assert!(entry
                .mandatory
                .iter()
                .any(|field| field == "organization_id"));
            assert!(entry.mandatory.iter().any(|field| field == "company_id"));
        }
    }

    #[test]
    fn stock_picking_projection_exposes_purchase_receipt_identity() {
        let entry = registry_get("stock-pickings").expect("stock pickings must be registered");

        assert!(entry
            .default_restricted
            .iter()
            .any(|field| field == "purchase_id"));
    }

    #[test]
    fn stock_move_projection_exposes_purchase_receipt_line_identity() {
        let entry = registry_get("stock-moves").expect("stock moves must be registered");

        for field in ["purchase_line_id", "is_done"] {
            assert!(
                entry.default_restricted.iter().any(|f| f == field),
                "stock-moves projection must expose {field}"
            );
        }
    }

    #[test]
    fn rfq_child_projections_expose_company_scope() {
        for resource in ["purchase-rfq-bids", "purchase-rfq-lines"] {
            let entry = registry_get(resource).expect("RFQ child resource must be registered");
            assert!(
                entry
                    .default_restricted
                    .iter()
                    .any(|field| field == "company_id"),
                "{resource} must expose company_id for purchasing scope enforcement"
            );
        }
    }

    #[test]
    fn workflow_readback_projections_expose_exact_effect_fields() {
        for (resource, fields) in [
            (
                "account-payments",
                &["reconciled_invoice_ids", "reconciled_bill_ids"][..],
            ),
            ("sale-orders", &["order_line"][..]),
            ("stock-production-serials", &["is_locked"][..]),
        ] {
            let entry = registry_get(resource).expect("workflow resource must be registered");
            for field in fields {
                assert!(
                    entry
                        .default_restricted
                        .iter()
                        .any(|candidate| candidate == field),
                    "{resource} projection must expose {field} for exact workflow readback"
                );
            }
        }
    }

    #[test]
    fn replenishment_projection_exposes_scheduler_state() {
        let entry =
            registry_get("replenishment-rules").expect("replenishment rules must be registered");

        for field in ["last_run", "next_run", "metadata"] {
            assert!(
                entry
                    .default_restricted
                    .iter()
                    .any(|candidate| candidate == field),
                "replenishment projection must expose {field}"
            );
        }
    }

    #[test]
    fn finance_workflow_projections_expose_owner_fields() {
        for (resource, fields) in [
            (
                "account-move-lines",
                &["amount_residual", "currency_id", "journal_id"][..],
            ),
            (
                "payment-transactions",
                &[
                    "partner_id",
                    "partner_type",
                    "currency_id",
                    "payment_account_id",
                ][..],
            ),
            (
                "payment-reconciliations",
                &["currency_id", "reversed_reconciliation_id"][..],
            ),
            (
                "expenses",
                &[
                    "client_request_id",
                    "attachment_ids",
                    "has_receipt",
                    "currency_id",
                    "date",
                    "unit_amount",
                    "quantity",
                    "description",
                    "tax_ids",
                    "product_id",
                    "account_id",
                    "analytic_account_id",
                    "project_id",
                    "line_kind",
                    "mileage_distance",
                    "mileage_rate_id",
                    "per_diem_days",
                    "per_diem_rate_id",
                    "payment_mode",
                    "merchant_key",
                ][..],
            ),
            (
                "report-templates",
                &[
                    "company_id",
                    "orientation",
                    "paper_format",
                    "template_content",
                    "write_date",
                ][..],
            ),
        ] {
            let entry = registry_get(resource).expect("finance resource must be registered");
            for field in fields {
                assert!(
                    entry
                        .default_restricted
                        .iter()
                        .any(|candidate| candidate == field),
                    "{resource} must expose {field} for the existing workflow"
                );
            }
            assert!(entry
                .mandatory
                .iter()
                .any(|field| field == "organization_id"));
        }
    }

    #[test]
    fn asset_and_period_projections_expose_exact_owner_scope_and_relations() {
        for (resource, fields) in [
            (
                "account-assets",
                &["organization_id", "depreciation_board_ids"][..],
            ),
            ("account-periods", &["organization_id"][..]),
        ] {
            let entry = registry_get(resource).expect("accounting resource must be registered");
            for field in fields {
                assert!(entry
                    .default_restricted
                    .iter()
                    .any(|column| column == field));
            }
            assert!(entry.mandatory.iter().any(|column| column == "company_id"));
        }
    }
}

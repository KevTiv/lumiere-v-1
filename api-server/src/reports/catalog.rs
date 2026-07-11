use serde::Serialize;

use super::common::ReportKey;

pub const CATALOG_SCHEMA_VERSION: u16 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReportAvailability {
    Preview,
    Planned,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportCatalogEntry {
    pub key: ReportKey,
    pub schema_version: u16,
    pub title: &'static str,
    pub description: &'static str,
    pub mandatory_sections: &'static [&'static str],
    pub authoritative_sources: &'static [&'static str],
    pub availability: ReportAvailability,
    pub max_window_days: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportCatalogV1 {
    pub catalog_schema_version: u16,
    pub reports: Vec<ReportCatalogEntry>,
}

pub const REPORT_CATALOG: [ReportCatalogEntry; 10] = [
    ReportCatalogEntry {
        key: ReportKey::DailyBusinessSummaryV1,
        schema_version: 1,
        title: "Daily Business Summary",
        description: "Daily sales, receipts, purchases, fees, stock alerts, and exceptions.",
        mandatory_sections: &[
            "sales",
            "receipts",
            "purchases",
            "expenses_and_fees",
            "stock_alerts",
            "exceptions",
        ],
        authoritative_sources: &["sales", "payments", "purchasing", "inventory"],
        availability: ReportAvailability::Preview,
        max_window_days: 1,
    },
    ReportCatalogEntry {
        key: ReportKey::CashMobileMoneyV1,
        schema_version: 1,
        title: "Cash & Mobile Money Report",
        description: "Opening, movements, fees, closing, and unreconciled cash accounts.",
        mandatory_sections: &[
            "opening",
            "accounts",
            "receipts",
            "disbursements",
            "fees",
            "closing",
            "unreconciled",
        ],
        authoritative_sources: &["journals", "payment_transactions", "allocations"],
        availability: ReportAvailability::Preview,
        max_window_days: 31,
    },
    ReportCatalogEntry {
        key: ReportKey::CustomerBalancesV1,
        schema_version: 1,
        title: "Unpaid Customer Balances",
        description: "Open customer balances and due buckets from posted accounting data.",
        mandatory_sections: &[
            "party",
            "due_buckets",
            "credit_status",
            "open_invoices",
            "payments",
        ],
        authoritative_sources: &["account_move_lines", "allocations"],
        availability: ReportAvailability::Preview,
        max_window_days: 366,
    },
    ReportCatalogEntry {
        key: ReportKey::SupplierPayablesV1,
        schema_version: 1,
        title: "Supplier Payables",
        description: "Supplier obligations, due buckets, and payment status.",
        mandatory_sections: &[
            "supplier",
            "due_buckets",
            "bills",
            "planned_amounts",
            "paid_amounts",
        ],
        authoritative_sources: &["account_move_lines", "allocations"],
        availability: ReportAvailability::Preview,
        max_window_days: 366,
    },
    ReportCatalogEntry {
        key: ReportKey::LowStockV1,
        schema_version: 1,
        title: "Low Stock Report",
        description: "On-hand, reserved, reorder, forecast, and supplier hints.",
        mandatory_sections: &[
            "product",
            "on_hand",
            "reserved",
            "reorder_point",
            "forecast",
            "supplier_hint",
        ],
        authoritative_sources: &["stock_quant", "stock_move", "replenishment"],
        availability: ReportAvailability::Planned,
        max_window_days: 1,
    },
    ReportCatalogEntry {
        key: ReportKey::StockMovementV1,
        schema_version: 1,
        title: "Stock Movement Report",
        description: "Bounded product and location movements with valuation references.",
        mandatory_sections: &[
            "product",
            "location",
            "source",
            "destination",
            "quantity",
            "valuation_reference",
        ],
        authoritative_sources: &["stock_moves", "stock_valuation"],
        availability: ReportAvailability::Planned,
        max_window_days: 31,
    },
    ReportCatalogEntry {
        key: ReportKey::SalesByProductV1,
        schema_version: 1,
        title: "Sales by Product",
        description: "Product quantities, sales, returns, and authoritative margin.",
        mandatory_sections: &["quantity", "gross_sales", "net_sales", "returns", "margin"],
        authoritative_sources: &["sales", "invoices", "returns"],
        availability: ReportAvailability::Planned,
        max_window_days: 31,
    },
    ReportCatalogEntry {
        key: ReportKey::PurchaseSpendV1,
        schema_version: 1,
        title: "Purchase Spend Report",
        description: "Supplier and product/category purchasing spend.",
        mandatory_sections: &[
            "supplier",
            "product_category",
            "quantity",
            "spend",
            "landed_cost_policy",
        ],
        authoritative_sources: &["purchases", "bills", "landed_costs"],
        availability: ReportAvailability::Planned,
        max_window_days: 31,
    },
    ReportCatalogEntry {
        key: ReportKey::PaymentFeeSummaryV1,
        schema_version: 1,
        title: "Payment Fee Summary",
        description: "Provider/account fees, bearer, rate, and accounting status.",
        mandatory_sections: &[
            "provider_account",
            "fee_type",
            "fee_bearer",
            "amount",
            "rate",
            "accounting_status",
        ],
        authoritative_sources: &["payment_fees", "account_moves"],
        availability: ReportAvailability::Planned,
        max_window_days: 31,
    },
    ReportCatalogEntry {
        key: ReportKey::MonthlyOwnerReportV1,
        schema_version: 1,
        title: "Monthly Owner Report",
        description: "Executive summary composed from approved owner report sections.",
        mandatory_sections: &["executive_summary", "selected_monthly_reports"],
        authoritative_sources: &["owner_report_catalog"],
        availability: ReportAvailability::Planned,
        max_window_days: 31,
    },
];

pub fn report_catalog() -> ReportCatalogV1 {
    ReportCatalogV1 {
        catalog_schema_version: CATALOG_SCHEMA_VERSION,
        reports: REPORT_CATALOG.to_vec(),
    }
}

pub fn catalog_entry(key: ReportKey) -> &'static ReportCatalogEntry {
    REPORT_CATALOG
        .iter()
        .find(|entry| entry.key == key)
        .expect("every ReportKey must be catalogued")
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    #[test]
    fn catalog_contains_the_ten_canonical_unique_keys() {
        let catalog = report_catalog();
        let keys: Vec<_> = catalog
            .reports
            .iter()
            .map(|entry| entry.key.as_str())
            .collect();
        let unique: HashSet<_> = keys.iter().copied().collect();

        assert_eq!(catalog.catalog_schema_version, 1);
        assert_eq!(keys.len(), 10);
        assert_eq!(unique.len(), 10);
        assert_eq!(
            keys,
            vec![
                "daily_business_summary_v1",
                "cash_mobile_money_v1",
                "customer_balances_v1",
                "supplier_payables_v1",
                "low_stock_v1",
                "stock_movement_v1",
                "sales_by_product_v1",
                "purchase_spend_v1",
                "payment_fee_summary_v1",
                "monthly_owner_report_v1",
            ]
        );
    }

    #[test]
    fn phase_one_slice_exposes_four_previewable_reports() {
        let previewable: Vec<_> = REPORT_CATALOG
            .iter()
            .filter(|entry| entry.availability == ReportAvailability::Preview)
            .collect();

        assert_eq!(previewable.len(), 4);
        let keys: Vec<_> = previewable.iter().map(|entry| entry.key).collect();
        assert!(keys.contains(&ReportKey::DailyBusinessSummaryV1));
        assert!(keys.contains(&ReportKey::CashMobileMoneyV1));
        assert!(keys.contains(&ReportKey::CustomerBalancesV1));
        assert!(keys.contains(&ReportKey::SupplierPayablesV1));
        assert_eq!(
            catalog_entry(ReportKey::DailyBusinessSummaryV1).max_window_days,
            1
        );
    }
}

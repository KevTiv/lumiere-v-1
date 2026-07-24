//! Owner-report permission intersection and response field masking.

use stdb_auth::FieldAccessContext;
use stdb_config::runtime_is_production;

use crate::error::ApiError;

use super::{
    catalog::catalog_entry,
    commercial::{
        MonthlyOwnerReportV1, PaymentFeeSummaryReportV1, PurchaseSpendReportV1,
        SalesByProductReportV1,
    },
    common::ReportKey,
    daily_business_summary::DailyBusinessSummaryReportV1,
    financial_position::CashMobileMoneyReportV1,
    low_stock::LowStockReportV1,
    open_balances::{CustomerBalancesReportV1, SupplierPayablesReportV1},
    service::ReportPreview,
    stock_movement::StockMovementReportV1,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReportAccess {
    Preview,
    Export,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PermissionResolution {
    Allow,
    NotGranted,
}

pub fn ensure_report_history_access(
    field_access: Option<&FieldAccessContext>,
) -> Result<(), ApiError> {
    if field_access.is_none() && !runtime_is_production() {
        return Ok(());
    }
    let Some(field_access) = field_access else {
        return Err(ApiError::Forbidden(
            "Owner report access requires an authenticated organization membership".into(),
        ));
    };
    if permission_allowed(field_access, "report", "read") {
        Ok(())
    } else {
        Err(ApiError::Forbidden(
            "Permission denied: read on report".into(),
        ))
    }
}

pub fn ensure_report_access(
    field_access: Option<&FieldAccessContext>,
    report_key: ReportKey,
    access: ReportAccess,
) -> Result<(), ApiError> {
    if field_access.is_none() && !runtime_is_production() {
        return Ok(());
    }
    let Some(field_access) = field_access else {
        return Err(ApiError::Forbidden(
            "Owner report access requires an authenticated organization membership".into(),
        ));
    };

    if !permission_allowed(field_access, "report", "read") {
        return Err(ApiError::Forbidden(
            "Permission denied: read on report".into(),
        ));
    }
    if access == ReportAccess::Export
        && !permission_allowed(field_access, "report", "export")
        && !permission_allowed(field_access, "report", "*")
    {
        return Err(ApiError::Forbidden(
            "Permission denied: export on report".into(),
        ));
    }

    for (resource, action) in required_source_permissions(report_key) {
        if !permission_allowed(field_access, resource, action) {
            return Err(ApiError::Forbidden(format!(
                "Permission denied: {action} on {resource} required for this report"
            )));
        }
    }

    Ok(())
}

pub fn mask_report_preview(
    preview: ReportPreview,
    field_access: Option<&FieldAccessContext>,
) -> ReportPreview {
    if field_access.is_none() && !runtime_is_production() {
        return preview;
    }
    let Some(field_access) = field_access else {
        return preview;
    };
    if field_access.is_superuser {
        return preview;
    }

    match preview {
        ReportPreview::DailyBusinessSummaryV1(mut envelope) => {
            envelope.report = mask_daily_summary(envelope.report, field_access);
            ReportPreview::DailyBusinessSummaryV1(envelope)
        }
        ReportPreview::CashMobileMoneyV1(mut envelope) => {
            envelope.report = mask_cash_report(envelope.report, field_access);
            ReportPreview::CashMobileMoneyV1(envelope)
        }
        ReportPreview::CustomerBalancesV1(mut envelope) => {
            envelope.report = mask_customer_balances(envelope.report, field_access);
            ReportPreview::CustomerBalancesV1(envelope)
        }
        ReportPreview::SupplierPayablesV1(mut envelope) => {
            envelope.report = mask_supplier_payables(envelope.report, field_access);
            ReportPreview::SupplierPayablesV1(envelope)
        }
        ReportPreview::LowStockV1(mut envelope) => {
            envelope.report = mask_low_stock(envelope.report, field_access);
            ReportPreview::LowStockV1(envelope)
        }
        ReportPreview::StockMovementV1(mut envelope) => {
            envelope.report = mask_stock_movement(envelope.report, field_access);
            ReportPreview::StockMovementV1(envelope)
        }
        ReportPreview::SalesByProductV1(envelope) => ReportPreview::SalesByProductV1(envelope),
        ReportPreview::PurchaseSpendV1(envelope) => ReportPreview::PurchaseSpendV1(envelope),
        ReportPreview::PaymentFeeSummaryV1(envelope) => {
            ReportPreview::PaymentFeeSummaryV1(envelope)
        }
        ReportPreview::MonthlyOwnerReportV1(envelope) => {
            ReportPreview::MonthlyOwnerReportV1(envelope)
        }
    }
}

fn mask_low_stock(
    report: LowStockReportV1,
    _field_access: &FieldAccessContext,
) -> LowStockReportV1 {
    report
}

fn mask_stock_movement(
    report: StockMovementReportV1,
    _field_access: &FieldAccessContext,
) -> StockMovementReportV1 {
    report
}

fn required_source_permissions(report_key: ReportKey) -> Vec<(&'static str, &'static str)> {
    let entry = catalog_entry(report_key);
    let mut required = Vec::new();
    for source in entry.authoritative_sources {
        if let Some(resource) = authoritative_source_permission(source) {
            if !required.iter().any(|(existing, _)| *existing == resource) {
                required.push((resource, "read"));
            }
        }
    }
    required
}

fn authoritative_source_permission(source: &str) -> Option<&'static str> {
    match source {
        "sales" | "sales/invoices/returns" => Some("sale_order"),
        "payments" | "payment_transactions" | "payment_fees" => Some("payment_transaction"),
        "purchasing" | "purchases" | "bills" | "landed_costs" => Some("purchase_order"),
        "inventory" | "stock_quant" | "stock_move" | "replenishment" => Some("stock_quant"),
        "stock_moves" => Some("stock_move"),
        "journals" => Some("account_journal"),
        "allocations" => Some("payment_reconciliation"),
        "account_move_lines" | "account_moves" => Some("account_move"),
        "owner_report_catalog" => None,
        _ => None,
    }
}

fn permission_allowed(ctx: &FieldAccessContext, resource: &str, action: &str) -> bool {
    matches!(
        resolve_permission(ctx, resource, action),
        PermissionResolution::Allow
    )
}

fn resolve_permission(
    ctx: &FieldAccessContext,
    resource: &str,
    action: &str,
) -> PermissionResolution {
    if ctx.is_superuser {
        return PermissionResolution::Allow;
    }

    let permission = format!("{resource}:{action}");
    let wildcard = format!("{resource}:*");
    if ctx
        .role_permissions
        .iter()
        .any(|entry| entry == "*:*" || entry == &permission || entry == &wildcard)
    {
        return PermissionResolution::Allow;
    }

    let org = ctx.organization_id.to_string();
    let _ = org;
    // Resource grants come from Role.permissions (and org_permission on the module).
    // FieldAccessContext no longer carries Casbin rows.
    PermissionResolution::NotGranted
}

fn can_read_contact_identity(field_access: &FieldAccessContext) -> bool {
    permission_allowed(field_access, "contact", "read")
}

fn can_read_payment_account_details(field_access: &FieldAccessContext) -> bool {
    permission_allowed(field_access, "payment_account", "read")
}

fn mask_partner_label(
    partner_id: Option<u64>,
    partner_display_name: Option<String>,
    field_access: &FieldAccessContext,
) -> Option<String> {
    if can_read_contact_identity(field_access) {
        return partner_display_name;
    }
    partner_id.map(|id| format!("Partner #{id}"))
}

fn mask_daily_summary(
    report: DailyBusinessSummaryReportV1,
    _field_access: &FieldAccessContext,
) -> DailyBusinessSummaryReportV1 {
    report
}

fn mask_cash_report(
    mut report: CashMobileMoneyReportV1,
    field_access: &FieldAccessContext,
) -> CashMobileMoneyReportV1 {
    let mask_accounts = !can_read_payment_account_details(field_access);
    if mask_accounts {
        for account in &mut report.accounts {
            account.name = format!("Account #{}", account.payment_account_id);
            account.reference_masked = None;
        }
    }
    report
}

fn mask_customer_balances(
    mut report: CustomerBalancesReportV1,
    field_access: &FieldAccessContext,
) -> CustomerBalancesReportV1 {
    for line in &mut report.lines {
        line.partner_display_name = mask_partner_label(
            line.partner_id,
            line.partner_display_name.clone(),
            field_access,
        );
    }
    report
}

fn mask_supplier_payables(
    mut report: SupplierPayablesReportV1,
    field_access: &FieldAccessContext,
) -> SupplierPayablesReportV1 {
    for line in &mut report.lines {
        line.partner_display_name = mask_partner_label(
            line.partner_id,
            line.partner_display_name.clone(),
            field_access,
        );
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ApiError;

    fn ctx(role_permissions: Vec<&str>) -> FieldAccessContext {
        FieldAccessContext {
            organization_id: 1,
            role_id: 9,
            role_name: "viewer".into(),
            is_superuser: false,
            role_permissions: role_permissions.into_iter().map(str::to_string).collect(),
            identity_hex: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".into(),
            field_permissions: vec![],
        }
    }

    #[test]
    fn preview_requires_report_read_and_each_source_permission() {
        let err = ensure_report_access(
            Some(&ctx(vec!["report:read", "sale_order:read"])),
            ReportKey::DailyBusinessSummaryV1,
            ReportAccess::Preview,
        )
        .expect_err("missing inventory permission");
        let ApiError::Forbidden(message) = err else {
            panic!("expected forbidden error");
        };
        assert!(message.contains("payment_transaction"));

        ensure_report_access(
            Some(&ctx(vec![
                "report:read",
                "sale_order:read",
                "payment_transaction:read",
                "purchase_order:read",
                "stock_quant:read",
            ])),
            ReportKey::DailyBusinessSummaryV1,
            ReportAccess::Preview,
        )
        .expect("daily summary permissions");
    }

    #[test]
    fn export_requires_report_export_permission() {
        let err = ensure_report_access(
            Some(&ctx(vec![
                "report:read",
                "payment_transaction:read",
                "account_journal:read",
                "payment_reconciliation:read",
            ])),
            ReportKey::CashMobileMoneyV1,
            ReportAccess::Export,
        )
        .expect_err("export permission required");
        let ApiError::Forbidden(message) = err else {
            panic!("expected forbidden error");
        };
        assert!(message.contains("export on report"));
    }

    #[test]
    fn role_permission_grants_source_access() {
        let access = ctx(vec!["report:read", "stock_quant:read"]);
        assert!(permission_allowed(&access, "stock_quant", "read"));
        assert!(!permission_allowed(&access, "sale_order", "read"));
    }

    #[test]
    fn partner_names_are_masked_without_contact_read() {
        let access = ctx(vec![
            "report:read",
            "account_move:read",
            "payment_reconciliation:read",
        ]);
        let masked = mask_customer_balances(
            CustomerBalancesReportV1 {
                total_open: super::super::daily_business_summary::MoneyAmount {
                    minor_units: 0,
                    scale: 2,
                },
                overdue: super::super::daily_business_summary::MoneyAmount {
                    minor_units: 0,
                    scale: 2,
                },
                current: super::super::daily_business_summary::MoneyAmount {
                    minor_units: 0,
                    scale: 2,
                },
                due_buckets: vec![],
                credit_status: super::super::open_balances::CreditStatusSummary {
                    within_limit: 0,
                    over_limit: 0,
                    unknown: 1,
                },
                lines: vec![super::super::open_balances::OpenBalanceLine {
                    move_id: 1,
                    partner_id: Some(42),
                    partner_display_name: Some("Acme Ltd".into()),
                    due_date: None,
                    original_amount: super::super::daily_business_summary::MoneyAmount {
                        minor_units: 100,
                        scale: 2,
                    },
                    paid_amount: super::super::daily_business_summary::MoneyAmount {
                        minor_units: 0,
                        scale: 2,
                    },
                    residual: super::super::daily_business_summary::MoneyAmount {
                        minor_units: 100,
                        scale: 2,
                    },
                    is_partial: false,
                    last_payment_date: None,
                }],
            },
            &access,
        );
        assert_eq!(
            masked.lines[0].partner_display_name.as_deref(),
            Some("Partner #42")
        );
    }
}

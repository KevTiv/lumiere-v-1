use chrono::{SecondsFormat, Utc};
use serde::Deserialize;
use stdb_client::StdbClient;

use crate::error::ApiError;

use crate::reports::{
    common::{ReportCurrency, ReportEnvelope, ReportKey, SourceRowCount},
    financial_position::{
        aggregate_cash_mobile_money, ledger_opening_by_journal, JournalDefaultAccountRow,
        LiquidityMoveLineRow, PaymentAccountSourceRow, PaymentFeeSourceRow,
        PaymentReconciliationSourceRow, PostedPaymentSourceRow, UnreconciledPaymentSourceRow,
    },
    open_balances::{
        aggregate_customer_balances, aggregate_supplier_payables, MoveAllocationSourceRow,
        MoveLineMoveIdRow, OpenMoveSourceRow,
    },
    timezone::day_window,
};

/// Financial report preview source loading.
use super::{
    query_company, query_typed, scope_for, source_watermark, ReportPreview, StdbTimestamp,
    ValidatedPreviewRequest, PREVIEW_WATERMARK, QUERY_LIMIT,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaymentAccountQueryRow {
    id: u64,
    name: String,
    provider_code: String,
    reference_masked: Option<String>,
    currency_id: u64,
    account_journal_id: u64,
    active: bool,
}

impl From<PaymentAccountQueryRow> for PaymentAccountSourceRow {
    fn from(row: PaymentAccountQueryRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            provider_code: row.provider_code,
            reference_masked: row.reference_masked,
            currency_id: row.currency_id,
            account_journal_id: row.account_journal_id,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaymentQueryRow {
    id: u64,
    payment_account_id: u64,
    direction: String,
    status: String,
    occurred_at: StdbTimestamp,
    settlement_amount: f64,
    net_account_amount: f64,
    currency_id: u64,
    external_reference: Option<String>,
}

impl PaymentQueryRow {
    fn posted(self) -> Option<Self> {
        (self.status.eq_ignore_ascii_case("posted")).then_some(self)
    }

    fn as_posted_source(&self) -> PostedPaymentSourceRow {
        PostedPaymentSourceRow {
            id: self.id,
            payment_account_id: self.payment_account_id,
            direction: self.direction.clone(),
            settlement_amount: self.settlement_amount,
            net_account_amount: self.net_account_amount,
            currency_id: self.currency_id,
        }
    }

    fn into_unreconciled_source(self) -> Result<UnreconciledPaymentSourceRow, ApiError> {
        Ok(UnreconciledPaymentSourceRow {
            id: self.id,
            payment_account_id: self.payment_account_id,
            external_reference: self.external_reference,
            occurred_at: self.occurred_at.to_rfc3339()?,
            net_account_amount: self.net_account_amount,
            currency_id: self.currency_id,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiquidityMoveLineQueryRow {
    journal_id: u64,
    account_id: u64,
    balance: f64,
    parent_state: String,
    date: StdbTimestamp,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JournalQueryRow {
    id: u64,
    default_account_id: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenMoveQueryRow {
    id: u64,
    partner_id: Option<u64>,
    invoice_partner_display_name: Option<String>,
    invoice_date_due: Option<StdbTimestamp>,
    amount_total: f64,
    amount_residual: f64,
    currency_id: u64,
    state: String,
    move_type: String,
    date: StdbTimestamp,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoveAllocationQueryRow {
    allocated_move_line_id: u64,
    allocated_amount: f64,
    is_reversal: bool,
    created_at: StdbTimestamp,
    currency_id: u64,
}

pub(super) async fn preview_cash_mobile_money(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    request: ValidatedPreviewRequest,
) -> Result<ReportPreview, ApiError> {
    let company = query_company(client, organization_id, request.company_id).await?;
    let window = day_window(request.date, &request.timezone)?;
    let accounts_sql = format!(
        "SELECT id, name, provider_code, reference_masked, currency_id, account_journal_id, active FROM payment_account WHERE organization_id = {organization_id} AND company_id = {} LIMIT {QUERY_LIMIT}",
        company.id
    );
    let accounts = query_typed::<PaymentAccountQueryRow>(client, "payment_account", accounts_sql)
        .await?
        .into_iter()
        .filter(|row| row.active)
        .map(PaymentAccountSourceRow::from)
        .collect::<Vec<_>>();
    let journal_ids = accounts
        .iter()
        .map(|account| account.account_journal_id)
        .collect::<Vec<_>>();

    let payments_sql = format!(
        "SELECT id, payment_account_id, direction, status, occurred_at, settlement_amount, net_account_amount, currency_id, external_reference FROM payment_transaction WHERE organization_id = {organization_id} AND company_id = {} LIMIT {QUERY_LIMIT}",
        company.id
    );
    let fees_sql = format!(
        "SELECT payment_transaction_id, amount, tax_amount, currency_id FROM payment_fee WHERE organization_id = {organization_id} AND company_id = {} AND created_at >= '{}' AND created_at < '{}' LIMIT {QUERY_LIMIT}",
        company.id, window.start_sql, window.end_sql
    );
    let prior_fees_sql = format!(
        "SELECT payment_transaction_id, amount, tax_amount, currency_id FROM payment_fee WHERE organization_id = {organization_id} AND company_id = {} AND created_at < '{}' LIMIT {QUERY_LIMIT}",
        company.id, window.start_sql
    );
    let reconciliations_sql = format!(
        "SELECT payment_transaction_id, is_reversal FROM payment_reconciliation WHERE organization_id = {organization_id} AND company_id = {company_id} LIMIT {QUERY_LIMIT}",
        company_id = company.id
    );
    let journals_sql = if journal_ids.is_empty() {
        None
    } else {
        Some(format!(
            "SELECT id, default_account_id FROM account_journal WHERE organization_id = {organization_id} AND company_id = {} LIMIT {QUERY_LIMIT}",
            company.id
        ))
    };
    let liquidity_lines_sql = if journal_ids.is_empty() {
        None
    } else {
        Some(format!(
            "SELECT journal_id, account_id, balance, parent_state, date FROM account_move_line WHERE organization_id = {organization_id} AND company_id = {} AND currency_id = {} LIMIT {QUERY_LIMIT}",
            company.id, company.currency_id
        ))
    };

    let (payment_rows, fees, prior_fees) = tokio::try_join!(
        query_typed::<PaymentQueryRow>(client, "payment_transaction", payments_sql),
        query_typed::<PaymentFeeSourceRow>(client, "payment_fee", fees_sql),
        query_typed::<PaymentFeeSourceRow>(client, "payment_fee", prior_fees_sql),
    )?;
    let payment_rows = payment_rows
        .into_iter()
        .filter_map(PaymentQueryRow::posted)
        .collect::<Vec<_>>();
    let payments = payment_rows
        .iter()
        .filter(|row| {
            row.occurred_at
                .is_between(window.window_start_utc, window.window_end_utc)
        })
        .map(PaymentQueryRow::as_posted_source)
        .collect::<Vec<_>>();
    let prior_payments = payment_rows
        .iter()
        .filter(|row| row.occurred_at.is_before(window.window_start_utc))
        .map(PaymentQueryRow::as_posted_source)
        .collect::<Vec<_>>();

    let reconciliations = query_typed::<PaymentReconciliationSourceRow>(
        client,
        "payment_reconciliation",
        reconciliations_sql,
    )
    .await?;
    let reconciliation_count = reconciliations.len();
    let unreconciled_candidates = payment_rows
        .into_iter()
        .filter(|row| row.occurred_at.is_before(window.window_end_utc))
        .map(PaymentQueryRow::into_unreconciled_source)
        .collect::<Result<Vec<_>, _>>()?;

    let journals = if let Some(sql) = journals_sql {
        query_typed::<JournalQueryRow>(client, "account_journal", sql)
            .await?
            .into_iter()
            .filter(|row| journal_ids.contains(&row.id))
            .map(|row| JournalDefaultAccountRow {
                id: row.id,
                default_account_id: row.default_account_id,
            })
            .collect()
    } else {
        vec![]
    };
    let liquidity_lines = if let Some(sql) = liquidity_lines_sql {
        query_typed::<LiquidityMoveLineQueryRow>(client, "account_move_line", sql)
            .await?
            .into_iter()
            .filter(|row| {
                journal_ids.contains(&row.journal_id)
                    && row.parent_state.eq_ignore_ascii_case("posted")
                    && row.date.is_before(window.window_start_utc)
            })
            .map(|row| LiquidityMoveLineRow {
                journal_id: row.journal_id,
                account_id: row.account_id,
                balance: row.balance,
            })
            .collect()
    } else {
        vec![]
    };
    let opening_by_journal =
        ledger_opening_by_journal(&journals, &liquidity_lines, company.currency_id);
    let reconciled_ids = reconciliations
        .into_iter()
        .filter(|row| !row.is_reversal)
        .map(|row| row.payment_transaction_id)
        .collect::<std::collections::HashSet<_>>();
    let unreconciled = unreconciled_candidates
        .into_iter()
        .filter(|payment| !reconciled_ids.contains(&payment.id))
        .collect::<Vec<_>>();

    let generated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let source_rows = vec![
        SourceRowCount {
            source: "payment_account",
            rows: accounts.len(),
        },
        SourceRowCount {
            source: "account_move_line",
            rows: liquidity_lines.len(),
        },
        SourceRowCount {
            source: "payment_transaction",
            rows: payments.len(),
        },
        SourceRowCount {
            source: "payment_fee",
            rows: fees.len(),
        },
        SourceRowCount {
            source: "payment_reconciliation",
            rows: reconciliation_count,
        },
    ];
    Ok(ReportPreview::CashMobileMoneyV1(ReportEnvelope {
        report_key: ReportKey::CashMobileMoneyV1,
        schema_version: 1,
        scope: scope_for(&company, &window),
        generated_at: generated_at.clone(),
        generated_by: identity_hex.to_string(),
        currency: ReportCurrency {
            currency_id: company.currency_id,
            minor_unit_scale: 2,
        },
        source_watermark: source_watermark(&window, generated_at, source_rows),
        caveats: vec![
            format!("Operational window: {}.", window.cutoff_label),
            "Opening balances use posted liquidity journal lines before the window; when absent, opening is reconstructed from prior posted payment transactions.".into(),
            "Closing balances equal opening plus receipts minus disbursements and fees for the window.".into(),
            "Unreconciled items are posted payment transactions without a non-reversal allocation as of the report cutoff.".into(),
            "Payment references in unreconciled details are masked; account references remain masked in account rows.".into(),
        ],
        watermark: PREVIEW_WATERMARK.into(),
        report: aggregate_cash_mobile_money(
            accounts,
            opening_by_journal,
            prior_payments,
            prior_fees,
            payments,
            fees,
            unreconciled,
            company.currency_id,
        ),
    }))
}

pub(super) async fn preview_open_balances(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    request: ValidatedPreviewRequest,
    move_type: &str,
    report_key: ReportKey,
) -> Result<ReportPreview, ApiError> {
    let company = query_company(client, organization_id, request.company_id).await?;
    let window = day_window(request.date, &request.timezone)?;
    let moves_sql = format!(
        "SELECT id, partner_id, invoice_partner_display_name, invoice_date_due, amount_total, amount_residual, currency_id, state, move_type, date FROM account_move WHERE organization_id = {organization_id} AND company_id = {} LIMIT {QUERY_LIMIT}",
        company.id
    );
    let moves = query_typed::<OpenMoveQueryRow>(client, "account_move", moves_sql)
        .await?
        .into_iter()
        .filter(|row| {
            row.state.eq_ignore_ascii_case("posted")
                && row.move_type.eq_ignore_ascii_case(move_type)
                && row.date.is_before(window.window_end_utc)
        })
        .map(|row| {
            Ok(OpenMoveSourceRow {
                id: row.id,
                partner_id: row.partner_id,
                invoice_partner_display_name: row.invoice_partner_display_name,
                invoice_date_due: row
                    .invoice_date_due
                    .map(StdbTimestamp::to_rfc3339)
                    .transpose()?,
                amount_total: row.amount_total,
                amount_residual: row.amount_residual,
                currency_id: row.currency_id,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    let move_ids = moves.iter().map(|move_| move_.id).collect::<Vec<_>>();
    let lines = if move_ids.is_empty() {
        vec![]
    } else {
        let lines_sql = format!(
            "SELECT id, move_id FROM account_move_line WHERE organization_id = {organization_id} AND company_id = {} LIMIT {QUERY_LIMIT}",
            company.id
        );
        query_typed::<MoveLineMoveIdRow>(client, "account_move_line", lines_sql)
            .await?
            .into_iter()
            .filter(|row| move_ids.contains(&row.move_id))
            .collect()
    };
    let line_ids = lines.iter().map(|line| line.id).collect::<Vec<_>>();
    let allocations = if line_ids.is_empty() {
        vec![]
    } else {
        let allocations_sql = format!(
            "SELECT allocated_move_line_id, allocated_amount, is_reversal, created_at, currency_id FROM payment_reconciliation WHERE organization_id = {organization_id} AND company_id = {} LIMIT {QUERY_LIMIT}",
            company.id
        );
        query_typed::<MoveAllocationQueryRow>(client, "payment_reconciliation", allocations_sql)
            .await?
            .into_iter()
            .filter(|row| line_ids.contains(&row.allocated_move_line_id))
            .map(|row| {
                Ok(MoveAllocationSourceRow {
                    allocated_move_line_id: row.allocated_move_line_id,
                    allocated_amount: row.allocated_amount,
                    is_reversal: row.is_reversal,
                    created_at: row.created_at.to_rfc3339()?,
                    currency_id: row.currency_id,
                })
            })
            .collect::<Result<Vec<_>, ApiError>>()?
    };

    let source_rows = vec![
        SourceRowCount {
            source: "account_move",
            rows: moves.len(),
        },
        SourceRowCount {
            source: "account_move_line",
            rows: lines.len(),
        },
        SourceRowCount {
            source: "payment_reconciliation",
            rows: allocations.len(),
        },
    ];
    let generated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let scope = scope_for(&company, &window);
    let currency = ReportCurrency {
        currency_id: company.currency_id,
        minor_unit_scale: 2,
    };
    let source_watermark = source_watermark(&window, generated_at.clone(), source_rows);
    let caveats = vec![
        format!("Posted-ledger as-of cutoff: {}.", window.cutoff_label),
        "Open balances use posted move residuals as the authority for amounts due.".into(),
        "Paid amounts are derived from payment_reconciliation allocations linked via move lines; reversals reduce paid totals.".into(),
        "Due-date aging uses the requested local report date in the selected timezone.".into(),
        "Partner display names are included only when present on the posted move; no unmasked contact data is joined.".into(),
        "Customer credit status is unknown until credit limits are modelled in the ledger.".into(),
    ];
    let watermark = PREVIEW_WATERMARK.to_string();

    Ok(match report_key {
        ReportKey::CustomerBalancesV1 => ReportPreview::CustomerBalancesV1(ReportEnvelope {
            report_key,
            schema_version: 1,
            scope,
            generated_at,
            generated_by: identity_hex.to_string(),
            currency,
            source_watermark,
            caveats,
            watermark,
            report: aggregate_customer_balances(
                moves,
                &lines,
                &allocations,
                company.currency_id,
                request.date,
            ),
        }),
        ReportKey::SupplierPayablesV1 => ReportPreview::SupplierPayablesV1(ReportEnvelope {
            report_key,
            schema_version: 1,
            scope,
            generated_at,
            generated_by: identity_hex.to_string(),
            currency,
            source_watermark,
            caveats: caveats
                .into_iter()
                .filter(|caveat| !caveat.starts_with("Customer credit"))
                .collect(),
            watermark,
            report: aggregate_supplier_payables(
                moves,
                &lines,
                &allocations,
                company.currency_id,
                request.date,
            ),
        }),
        _ => unreachable!("only customer and supplier balance reports use this projection"),
    })
}

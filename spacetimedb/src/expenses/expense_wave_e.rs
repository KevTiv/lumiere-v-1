//! Wave E — card statement match, pending-intent batch apply, FX fee helpers.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::company_id_from_scope;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::ExpensePaymentMode;

use super::expense_wave_d::{apply_expense_integration_intent, expense_integration_intent};
use super::expenses::hr_expense;

// ── Tables ───────────────────────────────────────────────────────────────────

/// Corporate-card statement line awaiting match to an expense.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = expense_card_statement_line,
    public,
    index(accessor = card_stmt_by_org, btree(columns = [organization_id])),
    index(accessor = card_stmt_by_company, btree(columns = [company_id])),
    index(accessor = card_stmt_by_status, btree(columns = [status])),
    index(accessor = card_stmt_by_external, btree(columns = [external_ref]))
)]
pub struct ExpenseCardStatementLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub external_ref: String,
    pub merchant_key: Option<String>,
    pub amount: f64,
    pub currency_id: u64,
    pub transaction_date: Timestamp,
    /// Cross-border FX / foreign-transaction fee in company currency (optional).
    pub fx_fee_amount: f64,
    pub matched_expense_id: Option<u64>,
    /// unmatched | matched | ignored
    pub status: String,
    pub metadata: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateExpenseCardStatementLineParams {
    pub company_id: Option<u64>,
    pub external_ref: String,
    pub merchant_key: Option<String>,
    pub amount: f64,
    pub currency_id: u64,
    pub transaction_date: Timestamp,
    pub fx_fee_amount: f64,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct MatchExpenseCardStatementLineParams {
    pub expense_id: u64,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UnmatchExpenseCardStatementLineParams {
    pub metadata: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Sum FX fees from matched statement lines linked to expenses on a sheet.
pub(crate) fn sheet_matched_fx_fee_total(ctx: &ReducerContext, sheet_id: u64) -> f64 {
    let expense_ids: Vec<u64> = ctx
        .db
        .hr_expense()
        .iter()
        .filter(|e| e.sheet_id == Some(sheet_id))
        .map(|e| e.id)
        .collect();
    ctx.db
        .expense_card_statement_line()
        .iter()
        .filter(|l| {
            l.status == "matched"
                && l.matched_expense_id
                    .map(|id| expense_ids.contains(&id))
                    .unwrap_or(false)
        })
        .map(|l| l.fx_fee_amount)
        .sum()
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_expense_card_statement_line(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateExpenseCardStatementLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense", "create")?;
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    if params.external_ref.trim().is_empty() {
        return Err("external_ref is required".to_string());
    }
    if params.amount <= 0.0 {
        return Err("amount must be positive".to_string());
    }
    if params.fx_fee_amount < 0.0 {
        return Err("fx_fee_amount cannot be negative".to_string());
    }
    let dup = ctx
        .db
        .expense_card_statement_line()
        .card_stmt_by_external()
        .filter(&params.external_ref)
        .any(|r| r.organization_id == organization_id && r.company_id == company_id);
    if dup {
        return Ok(());
    }
    let row = ctx
        .db
        .expense_card_statement_line()
        .insert(ExpenseCardStatementLine {
            id: 0,
            organization_id,
            company_id,
            external_ref: params.external_ref.clone(),
            merchant_key: params.merchant_key.clone(),
            amount: params.amount,
            currency_id: params.currency_id,
            transaction_date: params.transaction_date,
            fx_fee_amount: params.fx_fee_amount,
            matched_expense_id: None,
            status: "unmatched".into(),
            metadata: params.metadata.clone(),
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
        });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "expense_card_statement_line",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "external_ref": params.external_ref,
                    "amount": params.amount,
                    "fx_fee_amount": params.fx_fee_amount,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "external_ref".into(),
                "amount".into(),
                "fx_fee_amount".into(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn match_expense_card_statement_line(
    ctx: &ReducerContext,
    organization_id: u64,
    statement_line_id: u64,
    params: MatchExpenseCardStatementLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense", "update")?;
    let line = ctx
        .db
        .expense_card_statement_line()
        .id()
        .find(&statement_line_id)
        .ok_or("Card statement line not found")?;
    if line.organization_id != organization_id {
        return Err("Statement line belongs to a different organization".to_string());
    }
    if line.status == "matched" && line.matched_expense_id == Some(params.expense_id) {
        return Ok(());
    }
    if line.status == "matched" {
        return Err("Statement line already matched".to_string());
    }
    let expense = ctx
        .db
        .hr_expense()
        .id()
        .find(&params.expense_id)
        .ok_or("Expense not found")?;
    if expense.organization_id != organization_id {
        return Err("Expense belongs to a different organization".to_string());
    }
    if expense.company_id != line.company_id {
        return Err("Expense and statement line company mismatch".to_string());
    }
    if expense.payment_mode != ExpensePaymentMode::CorporateCard {
        return Err("Only corporate-card expenses can be matched to statement lines".to_string());
    }
    if (expense.total_amount - line.amount).abs() > 0.05 {
        return Err(format!(
            "Amount mismatch: expense {:.2} vs statement {:.2}",
            expense.total_amount, line.amount
        ));
    }
    if let Some(mk) = line.merchant_key.as_deref() {
        if !mk.is_empty() {
            let other = expense.merchant_key.as_deref().unwrap_or("");
            if !other.is_empty() && other != mk {
                return Err(format!(
                    "Merchant mismatch: expense '{other}' vs statement '{mk}'"
                ));
            }
        }
    }
    ctx.db
        .expense_card_statement_line()
        .id()
        .update(ExpenseCardStatementLine {
            status: "matched".into(),
            matched_expense_id: Some(params.expense_id),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: params.metadata.or(line.metadata.clone()),
            ..line
        });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(line.company_id),
            table_name: "expense_card_statement_line",
            record_id: statement_line_id,
            action: "UPDATE",
            old_values: Some(r#"{"status":"unmatched"}"#.into()),
            new_values: Some(
                serde_json::json!({
                    "status": "matched",
                    "matched_expense_id": params.expense_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["status".into(), "matched_expense_id".into()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn unmatch_expense_card_statement_line(
    ctx: &ReducerContext,
    organization_id: u64,
    statement_line_id: u64,
    params: UnmatchExpenseCardStatementLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense", "update")?;
    let line = ctx
        .db
        .expense_card_statement_line()
        .id()
        .find(&statement_line_id)
        .ok_or("Card statement line not found")?;
    if line.organization_id != organization_id {
        return Err("Statement line belongs to a different organization".to_string());
    }
    if line.status != "matched" {
        return Ok(());
    }
    ctx.db
        .expense_card_statement_line()
        .id()
        .update(ExpenseCardStatementLine {
            status: "unmatched".into(),
            matched_expense_id: None,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: params.metadata.or(line.metadata.clone()),
            ..line
        });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(line.company_id),
            table_name: "expense_card_statement_line",
            record_id: statement_line_id,
            action: "UPDATE",
            old_values: Some(r#"{"status":"matched"}"#.into()),
            new_values: Some(r#"{"status":"unmatched"}"#.into()),
            changed_fields: vec!["status".into(), "matched_expense_id".into()],
            metadata: None,
        },
    );
    Ok(())
}

/// Worker entry: apply up to `limit` pending OCR / email / card_feed intents for an org.
#[reducer]
pub fn apply_pending_expense_integration_intents(
    ctx: &ReducerContext,
    organization_id: u64,
    limit: u32,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense", "create")?;
    let cap = limit.clamp(1, 50) as usize;
    let pending: Vec<u64> = ctx
        .db
        .expense_integration_intent()
        .expense_intent_by_org()
        .filter(&organization_id)
        .filter(|i| {
            i.status == "pending"
                && matches!(
                    i.intent_type.as_str(),
                    "ocr_receipt" | "email_inbox" | "card_feed" | "delayed_sync" | "fx_rate"
                )
        })
        .take(cap)
        .map(|i| i.id)
        .collect();
    for intent_id in pending {
        // Best-effort: continue on individual failures so the batch progresses.
        let _ = apply_expense_integration_intent(ctx, organization_id, intent_id);
    }
    Ok(())
}

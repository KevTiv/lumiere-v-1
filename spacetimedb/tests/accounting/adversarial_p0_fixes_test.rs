//! Persisted coverage for the 2026-07-30 adversarial-audit P0 findings:
//! ACC-RI-020 (tax jurisdiction), ACC-RI-021 (analytic-account parent),
//! ACC-RI-022 (bank statement / statement line / match-candidate reducers).

use spacetimedb::{ReducerContext, Table};

use crate::accounting::analytic_accounting::{
    account_analytic_account, create_analytic_account, CreateAnalyticAccountParams,
};
use crate::accounting::bank_reconciliation::{
    account_bank_statement, account_bank_statement_line, create_account_bank_statement,
    create_account_bank_statement_line, delete_account_bank_statement, match_bank_line,
    post_account_bank_statement, update_account_bank_statement,
    CreateAccountBankStatementLineParams, CreateAccountBankStatementParams,
    UpdateAccountBankStatementParams,
};
use crate::accounting::chart_of_accounts::{
    account_journal, create_account_journal, CreateAccountJournalParams,
};
use crate::accounting::tax_management::{
    create_tax_jurisdiction, tax_jurisdiction, update_tax_jurisdiction,
    CreateTaxJurisdictionParams, UpdateTaxJurisdictionParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::JournalType;

fn journal_params(company_id: u64, code: &str) -> CreateAccountJournalParams {
    CreateAccountJournalParams {
        company_id: Some(company_id),
        name: format!("ACC-RI-P0 journal {code}"),
        code: code.to_string(),
        type_: JournalType::Bank,
        currency_id: Some(1),
        default_account_id: None,
        suspense_account_id: None,
        loss_account_id: None,
        profit_account_id: None,
        bank_account_id: None,
        payment_credit_account_id: None,
        payment_debit_account_id: None,
        invoice_reference_type: None,
        invoice_reference_model: None,
        sequence_id: None,
        refund_sequence_id: None,
        sequence_override_regex: None,
        secure_sequence_id: None,
        alias_name: None,
        alias_domain: None,
        sale_activity_type_id: None,
        sale_activity_user_id: None,
        sale_activity_note: None,
        sale_activity_date_deadline: None,
        restrict_mode_hash_table: false,
        active: true,
        at_least_one_inbound: false,
        at_least_one_outbound: false,
        dedicated_payment_method_ids: vec![],
        sale_activity_done: false,
        metadata: Some(r#"{"test":"acc_ri_p0"}"#.to_string()),
    }
}

fn seed_journal(ctx: &ReducerContext, fixture: &OrgFixture, code: &str) -> Result<u64, String> {
    create_account_journal(ctx, fixture.organization_id, journal_params(fixture.company_id, code))?;
    ctx.db
        .account_journal()
        .iter()
        .find(|j| {
            j.organization_id == fixture.organization_id
                && j.company_id == fixture.company_id
                && j.code == code
        })
        .map(|j| j.id)
        .ok_or_else(|| "journal not found after create".to_string())
}

/// ACC-RI-020: `update_tax_jurisdiction` must reject a caller from a different
/// organization than the jurisdiction it targets, and leave the row unchanged.
pub fn test_update_tax_jurisdiction_rejects_cross_tenant(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;

    create_tax_jurisdiction(
        ctx,
        fixture_a.organization_id,
        CreateTaxJurisdictionParams {
            name: "ACC-RI-020 jurisdiction A".to_string(),
            code: "ACC-RI-020-A".to_string(),
            country_code: "US".to_string(),
            state_code: None,
            county_code: None,
            city: None,
            zip_from: None,
            zip_to: None,
            is_active: true,
            metadata: None,
        },
    )?;
    let jurisdiction = ctx
        .db
        .tax_jurisdiction()
        .iter()
        .find(|j| j.organization_id == fixture_a.organization_id && j.code == "ACC-RI-020-A")
        .ok_or("jurisdiction not found after create")?;

    let cross_tenant_result = update_tax_jurisdiction(
        ctx,
        fixture_b.organization_id,
        jurisdiction.id,
        UpdateTaxJurisdictionParams {
            name: Some("Hijacked".to_string()),
            code: None,
            state_code: None,
            county_code: None,
            city: None,
            zip_from: None,
            zip_to: None,
            is_active: Some(false),
            metadata: None,
        },
    );
    if cross_tenant_result.is_ok() {
        return Err("update_tax_jurisdiction accepted a cross-organization caller".to_string());
    }

    let reloaded = ctx
        .db
        .tax_jurisdiction()
        .id()
        .find(&jurisdiction.id)
        .ok_or("jurisdiction disappeared after rejected cross-tenant update")?;
    if reloaded.name != "ACC-RI-020 jurisdiction A" || !reloaded.is_active {
        return Err("cross-tenant update mutated the jurisdiction despite rejection".to_string());
    }

    // Positive: same-tenant update still succeeds.
    update_tax_jurisdiction(
        ctx,
        fixture_a.organization_id,
        jurisdiction.id,
        UpdateTaxJurisdictionParams {
            name: Some("ACC-RI-020 jurisdiction A renamed".to_string()),
            code: None,
            state_code: None,
            county_code: None,
            city: None,
            zip_from: None,
            zip_to: None,
            is_active: None,
            metadata: None,
        },
    )?;
    let reloaded = ctx
        .db
        .tax_jurisdiction()
        .id()
        .find(&jurisdiction.id)
        .ok_or("jurisdiction disappeared after same-tenant update")?;
    if reloaded.name != "ACC-RI-020 jurisdiction A renamed" {
        return Err("same-tenant update did not persist".to_string());
    }
    Ok(())
}

/// ACC-RI-021: `create_analytic_account` must reject a `parent_id` that
/// belongs to a different organization/company, without creating an orphan
/// child or mutating the foreign parent's `child_ids`.
pub fn test_create_analytic_account_rejects_cross_tenant_parent(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;

    create_analytic_account(
        ctx,
        fixture_b.organization_id,
        CreateAnalyticAccountParams {
            company_id: Some(fixture_b.company_id),
            name: "ACC-RI-021 parent B".to_string(),
            code: None,
            active: true,
            currency_id: 1,
            partner_id: None,
            plan_id: None,
            root_id: None,
            group_id: None,
            parent_id: None,
            color: None,
            is_required_in_move_lines: false,
            is_required_in_distribution: false,
            is_root_plan: true,
            metadata: None,
        },
    )?;
    let parent_b = ctx
        .db
        .account_analytic_account()
        .iter()
        .find(|a| a.organization_id == fixture_b.organization_id && a.name == "ACC-RI-021 parent B")
        .ok_or("parent B not found after create")?;

    let cross_tenant_result = create_analytic_account(
        ctx,
        fixture_a.organization_id,
        CreateAnalyticAccountParams {
            company_id: Some(fixture_a.company_id),
            name: "ACC-RI-021 child A".to_string(),
            code: None,
            active: true,
            currency_id: 1,
            partner_id: None,
            plan_id: None,
            root_id: None,
            group_id: None,
            parent_id: Some(parent_b.id),
            color: None,
            is_required_in_move_lines: false,
            is_required_in_distribution: false,
            is_root_plan: false,
            metadata: None,
        },
    );
    if cross_tenant_result.is_ok() {
        return Err("create_analytic_account accepted a cross-organization parent_id".to_string());
    }

    let child_exists = ctx
        .db
        .account_analytic_account()
        .iter()
        .any(|a| a.organization_id == fixture_a.organization_id && a.name == "ACC-RI-021 child A");
    if child_exists {
        return Err("rejected cross-tenant create still persisted an orphaned child".to_string());
    }

    let parent_b_reloaded = ctx
        .db
        .account_analytic_account()
        .id()
        .find(&parent_b.id)
        .ok_or("parent B disappeared")?;
    if !parent_b_reloaded.child_ids.is_empty() {
        return Err("rejected cross-tenant create still mutated the foreign parent's child_ids".to_string());
    }

    // Positive: same-tenant parent linkage still succeeds and updates child_ids.
    create_analytic_account(
        ctx,
        fixture_b.organization_id,
        CreateAnalyticAccountParams {
            company_id: Some(fixture_b.company_id),
            name: "ACC-RI-021 child B".to_string(),
            code: None,
            active: true,
            currency_id: 1,
            partner_id: None,
            plan_id: None,
            root_id: None,
            group_id: None,
            parent_id: Some(parent_b.id),
            color: None,
            is_required_in_move_lines: false,
            is_required_in_distribution: false,
            is_root_plan: false,
            metadata: None,
        },
    )?;
    let parent_b_reloaded = ctx
        .db
        .account_analytic_account()
        .id()
        .find(&parent_b.id)
        .ok_or("parent B disappeared after same-tenant create")?;
    if parent_b_reloaded.child_ids.len() != 1 {
        return Err("same-tenant parent linkage did not update child_ids".to_string());
    }
    Ok(())
}

/// ACC-RI-022: bank-statement mutation/read reducers must reject a caller
/// from a different organization than the statement, even when the caller
/// supplies the statement's real `company_id`.
pub fn test_bank_statement_reducers_reject_cross_tenant(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;

    let journal_a = seed_journal(ctx, &fixture_a, "ARI22A")?;

    create_account_bank_statement(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        journal_a,
        CreateAccountBankStatementParams {
            name: Some("ACC-RI-022 statement A".to_string()),
            reference: None,
            date: None,
            balance_start: 0.0,
            currency_id: 1,
            metadata: None,
        },
    )?;
    let statement_a = ctx
        .db
        .account_bank_statement()
        .iter()
        .find(|s| {
            s.organization_id == fixture_a.organization_id
                && s.name.as_deref() == Some("ACC-RI-022 statement A")
        })
        .ok_or("statement A not found after create")?;

    // Cross-tenant update: org B caller, supplying A's real company_id.
    let cross_update = update_account_bank_statement(
        ctx,
        fixture_b.organization_id,
        fixture_a.company_id,
        statement_a.id,
        UpdateAccountBankStatementParams {
            name: Some(Some("Hijacked".to_string())),
            reference: None,
            date: None,
            balance_start: None,
            balance_end_real: None,
            balance_end: None,
            currency_id: None,
            state: None,
            line_ids: None,
            move_line_ids: None,
            total_entry_encoding: None,
            total_amount: None,
            total_amount_currency: None,
            date_done: None,
            is_valid_balance_start: None,
            is_valid_balance_end: None,
            metadata: None,
        },
    );
    if cross_update.is_ok() {
        return Err("update_account_bank_statement accepted a cross-organization caller".to_string());
    }

    // Cross-tenant line create against A's statement.
    let cross_line = create_account_bank_statement_line(
        ctx,
        fixture_b.organization_id,
        fixture_a.company_id,
        statement_a.id,
        CreateAccountBankStatementLineParams {
            date: ctx.timestamp,
            amount: 42.0,
            amount_currency: 42.0,
            currency_id: Some(1),
            foreign_currency_id: None,
            partner_id: None,
            bank_account_id: None,
            account_number: None,
            move_id: None,
            is_reconciled: false,
            transaction_type: None,
            move_ids: vec![],
            payment_ids: vec![],
            amount_residual: 0.0,
            auto_reconcile_ids: vec![],
            metadata: None,
        },
    );
    if cross_line.is_ok() {
        return Err(
            "create_account_bank_statement_line accepted a cross-organization caller".to_string(),
        );
    }

    // Cross-tenant post.
    let cross_post =
        post_account_bank_statement(ctx, fixture_b.organization_id, fixture_a.company_id, statement_a.id);
    if cross_post.is_ok() {
        return Err("post_account_bank_statement accepted a cross-organization caller".to_string());
    }

    // Cross-tenant delete.
    let cross_delete =
        delete_account_bank_statement(ctx, fixture_b.organization_id, fixture_a.company_id, statement_a.id);
    if cross_delete.is_ok() {
        return Err("delete_account_bank_statement accepted a cross-organization caller".to_string());
    }

    let reloaded = ctx
        .db
        .account_bank_statement()
        .id()
        .find(&statement_a.id)
        .ok_or("statement A disappeared despite every cross-tenant call being rejected")?;
    if reloaded.name.as_deref() != Some("ACC-RI-022 statement A") {
        return Err("cross-tenant calls mutated statement A despite rejection".to_string());
    }
    if !ctx
        .db
        .account_bank_statement_line()
        .iter()
        .filter(|l| l.statement_id == statement_a.id)
        .next()
        .is_none()
    {
        return Err("cross-tenant call persisted a line against statement A".to_string());
    }

    // Cross-tenant match_bank_line: org B caller against a line seeded on A's statement.
    create_account_bank_statement_line(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        statement_a.id,
        CreateAccountBankStatementLineParams {
            date: ctx.timestamp,
            amount: 42.0,
            amount_currency: 42.0,
            currency_id: Some(1),
            foreign_currency_id: None,
            partner_id: None,
            bank_account_id: None,
            account_number: None,
            move_id: None,
            is_reconciled: false,
            transaction_type: None,
            move_ids: vec![],
            payment_ids: vec![],
            amount_residual: 0.0,
            auto_reconcile_ids: vec![],
            metadata: None,
        },
    )?;
    let line_a = ctx
        .db
        .account_bank_statement_line()
        .iter()
        .find(|l| l.statement_id == statement_a.id)
        .ok_or("line A not found after create")?;

    let cross_match = match_bank_line(ctx, fixture_b.organization_id, line_a.id, None);
    if cross_match.is_ok() {
        return Err("match_bank_line accepted a cross-organization caller".to_string());
    }

    // Positive: same-tenant post still succeeds.
    post_account_bank_statement(ctx, fixture_a.organization_id, fixture_a.company_id, statement_a.id)?;
    let reloaded = ctx
        .db
        .account_bank_statement()
        .id()
        .find(&statement_a.id)
        .ok_or("statement A disappeared after same-tenant post")?;
    if format!("{:?}", reloaded.state) != "Posted" {
        return Err("same-tenant post did not transition statement state".to_string());
    }

    Ok(())
}

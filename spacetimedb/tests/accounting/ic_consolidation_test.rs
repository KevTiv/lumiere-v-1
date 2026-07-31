//! Intercompany + consolidation smoke tests (A4 elimination path).
use std::time::Duration;

use spacetimedb::{ReducerContext, Table};

use crate::accounting::consolidation::{
    backfill_consolidation_organization_ownership, consolidation_account,
    consolidation_company_rate, consolidation_elimination_entry, consolidation_journal,
    create_consolidation_account, create_consolidation_journal, create_elimination_entry,
    process_consolidation, set_consolidation_company_rate, update_consolidation_account,
    ConsolidationAccount, ConsolidationCompanyRate, ConsolidationEliminationEntry,
    ConsolidationJournal, CreateConsolidationAccountParams, CreateConsolidationJournalParams,
    CreateEliminationEntryParams, SetConsolidationCompanyRateParams,
    UpdateConsolidationAccountParams,
};
use crate::accounting::fiscal_periods::accounting_ownership_backfill_issue;
use crate::accounting::idempotency::accounting_operation_receipt;
use crate::accounting::intercompany::{
    backfill_intercompany_organization_ownership, create_intercompany_rule,
    create_intercompany_transaction, intercompany_rule, intercompany_transaction,
    set_intercompany_rule_active, CreateIntercompanyRuleParams,
    CreateIntercompanyTransactionParams, IntercompanyRule, IntercompanyTransaction,
};
use crate::core::audit::audit_log;
use crate::core::organization::{company, create_company, CreateCompanyParams};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{ConsolidationState, IntercompanyDocumentModel, RuleType};

pub fn test_intercompany_rule_requires_same_org(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;

    let result = create_intercompany_rule(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        fixture_b.company_id,
        CreateIntercompanyRuleParams {
            name: "Cross-org IC".to_string(),
            rule_type: RuleType::Invoice,
            auto_validation: false,
            auto_generate_invoice: false,
            auto_generate_bill: false,
            is_active: true,
            journal_id: None,
            account_id: None,
            pricelist_id: None,
            sequence: 1,
            notes: None,
            metadata: None,
        },
    );

    match result {
        Ok(()) => return Err("Expected intercompany rule cross-org to fail".to_string()),
        Err(msg) if msg.contains("does not belong") => Ok(()),
        Err(msg) => Err(format!("Unexpected error: {msg}")),
    }
}

pub fn test_intercompany_elimination_nets_to_zero(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    create_company(
        ctx,
        fixture.organization_id,
        CreateCompanyParams {
            name: "Subsidiary IC".to_string(),
            code: format!("SUB-{}", fixture.company_id),
            currency_id: 1,
            fiscal_year_end_month: 12,
            fiscal_year_end_day: 31,
            is_parent: false,
            parent_id: Some(fixture.company_id),
            tax_id: None,
            company_registry: None,
            address_street: None,
            address_city: None,
            address_zip: None,
            address_country_code: None,
            metadata: None,
        },
    )?;

    let sub_company_id = ctx
        .db
        .company()
        .company_by_org()
        .filter(&fixture.organization_id)
        .filter(|c| c.parent_id == Some(fixture.company_id))
        .map(|c| c.id)
        .max()
        .ok_or("Subsidiary company not found")?;

    create_intercompany_rule(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        sub_company_id,
        CreateIntercompanyRuleParams {
            name: "HQ to sub".to_string(),
            rule_type: RuleType::Invoice,
            auto_validation: false,
            auto_generate_invoice: true,
            auto_generate_bill: false,
            is_active: true,
            journal_id: None,
            account_id: None,
            pricelist_id: None,
            sequence: 1,
            notes: None,
            metadata: None,
        },
    )?;

    let rule = ctx
        .db
        .intercompany_rule()
        .intercompany_rule_by_source()
        .filter(&fixture.company_id)
        .find(|rule| rule.destination_company_id == sub_company_id)
        .ok_or("Intercompany rule not created")?;

    create_intercompany_transaction(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateIntercompanyTransactionParams {
            origin_document_id: {
                // Use a real account.move created under A1 for typed provenance.
                use crate::accounting::chart_of_accounts::{
                    account_journal, create_account_journal, CreateAccountJournalParams,
                };
                use crate::accounting::journal_entries::{
                    account_move, create_account_move, CreateAccountMoveParams,
                };
                use crate::types::{JournalType, MoveType};
                let journal_code = format!("ICJ{}", fixture.company_id);
                if ctx
                    .db
                    .account_journal()
                    .iter()
                    .find(|j| {
                        j.organization_id == fixture.organization_id && j.code == journal_code
                    })
                    .is_none()
                {
                    create_account_journal(
                        ctx,
                        fixture.organization_id,
                        CreateAccountJournalParams {
                            company_id: Some(fixture.company_id),
                            name: "IC origin journal".to_string(),
                            code: journal_code.clone(),
                            type_: JournalType::General,
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
                            metadata: None,
                        },
                    )?;
                }
                let journal_id = ctx
                    .db
                    .account_journal()
                    .iter()
                    .find(|j| {
                        j.organization_id == fixture.organization_id && j.code == journal_code
                    })
                    .map(|j| j.id)
                    .ok_or("IC journal missing")?;
                let move_ref = format!("IC-ORIG-{}", fixture.company_id);
                create_account_move(
                    ctx,
                    fixture.organization_id,
                    CreateAccountMoveParams {
                        idempotency_key: format!("ic-origin-{}", fixture.company_id),
                        company_id: Some(fixture.company_id),
                        journal_id,
                        move_type: MoveType::Entry,
                        date: ctx.timestamp,
                        name: move_ref.clone(),
                        ref_: Some(move_ref.clone()),
                        auto_post: false,
                        to_check: false,
                        is_storno: false,
                        partner_id: None,
                        partner_bank_id: None,
                        fiscal_position_id: None,
                        invoice_date: None,
                        invoice_date_due: None,
                        invoice_payment_term_id: None,
                        payment_reference: None,
                        invoice_origin: None,
                        invoice_partner_display_name: None,
                        invoice_cash_rounding_id: None,
                        partner_shipping_id: None,
                        sale_order_id: None,
                        invoice_incoterm_id: None,
                        incoterm_location: None,
                        campaign_id: None,
                        source_id: None,
                        medium_id: None,
                        secure_sequence_number: None,
                        metadata: None,
                    },
                )?;
                ctx.db
                    .account_move()
                    .iter()
                    .find(|m| {
                        m.organization_id == fixture.organization_id
                            && m.ref_.as_deref() == Some(move_ref.as_str())
                    })
                    .map(|m| m.id)
                    .ok_or("IC origin move missing")?
            },
            origin_document_model: IntercompanyDocumentModel::AccountMove,
            destination_company_id: sub_company_id,
            amount: 250.0,
            currency_id: 1,
            transaction_type: RuleType::Invoice,
            auto_process: false,
            requires_approval: false,
            notes: None,
            metadata: Some(r#"{"test":"ownership"}"#.to_string()),
        },
    )?;
    let transaction = ctx
        .db
        .intercompany_transaction()
        .intercompany_by_origin()
        .filter(&fixture.company_id)
        .find(|transaction| transaction.destination_company_id == sub_company_id)
        .ok_or("Intercompany transaction not created")?;

    let account_code = format!("CONS-{}", fixture.company_id);
    create_consolidation_account(
        ctx,
        fixture.organization_id,
        CreateConsolidationAccountParams {
            name: "Ownership consolidation account".to_string(),
            code: account_code.clone(),
            account_type: "asset".to_string(),
            company_ids: vec![fixture.company_id, sub_company_id],
            consolidation_rate: 1.0,
            currency_id: 1,
            elimination_account_id: None,
            is_intercompany: true,
            elimination_method: Some("full".to_string()),
            notes: None,
            is_active: true,
            metadata: Some(r#"{"test":"ownership"}"#.to_string()),
        },
    )?;
    let consolidation_account = ctx
        .db
        .consolidation_account()
        .iter()
        .find(|account| account.code == account_code)
        .ok_or("Consolidation account not created")?;

    set_consolidation_company_rate(
        ctx,
        fixture.organization_id,
        SetConsolidationCompanyRateParams {
            company_id: fixture.company_id,
            period_id: fixture.fiscal_year_id,
            currency_id: 1,
            exchange_rate: 1.0,
            rate_type: "average".to_string(),
            effective_date: ctx.timestamp,
            metadata: Some(r#"{"test":"ownership"}"#.to_string()),
        },
    )?;
    let company_rate = ctx
        .db
        .consolidation_company_rate()
        .company_rate_by_company()
        .filter(&fixture.company_id)
        .find(|rate| rate.period_id == fixture.fiscal_year_id)
        .ok_or("Consolidation company rate not created")?;

    let journal_name = format!(
        "IC elimination smoke {}",
        ctx.timestamp.to_micros_since_unix_epoch()
    );

    create_consolidation_journal(
        ctx,
        fixture.organization_id,
        CreateConsolidationJournalParams {
            name: journal_name.clone(),
            period_id: {
                use crate::accounting::fiscal_periods::account_period;
                ctx.db
                    .account_period()
                    .period_by_fiscal_year()
                    .filter(&fixture.fiscal_year_id)
                    .map(|p| p.id)
                    .max()
                    .ok_or("open account period missing")?
            },
            date_from: ctx.timestamp,
            date_to: ctx.timestamp + Duration::from_secs(86_400),
            company_ids: vec![fixture.company_id, sub_company_id],
            currency_id: 1,
            exchange_rate: 1.0,
            exchange_rate_date: Some(ctx.timestamp),
            notes: None,
            metadata: None,
        },
    )?;

    let journal = ctx
        .db
        .consolidation_journal()
        .iter()
        .find(|j| j.name == journal_name)
        .ok_or("Consolidation journal not found")?;

    let amount = 1_000.0;
    let ar_id = *fixture
        .chart_account_ids
        .get(crate::test_harness::chart_keys::AR)
        .ok_or("harness missing AR")?;
    let ap_id = *fixture
        .chart_account_ids
        .get(crate::test_harness::chart_keys::AP)
        .ok_or("harness missing AP")?;
    create_elimination_entry(
        ctx,
        fixture.organization_id,
        CreateEliminationEntryParams {
            journal_id: journal.id,
            name: "IC AR elimination".to_string(),
            account_id: ar_id,
            company_id: fixture.company_id,
            counterparty_company_id: Some(sub_company_id),
            debit: amount,
            credit: 0.0,
            currency_id: 1,
            amount_currency: amount,
            elimination_type: "intercompany_receivable".to_string(),
            reference: Some("A4-smoke".to_string()),
            notes: None,
            metadata: None,
        },
    )?;

    create_elimination_entry(
        ctx,
        fixture.organization_id,
        CreateEliminationEntryParams {
            journal_id: journal.id,
            name: "IC AP elimination".to_string(),
            account_id: ap_id,
            company_id: fixture.company_id,
            counterparty_company_id: Some(fixture.company_id),
            debit: 0.0,
            credit: amount,
            currency_id: 1,
            amount_currency: amount,
            elimination_type: "intercompany_payable".to_string(),
            reference: Some("A4-smoke".to_string()),
            notes: None,
            metadata: None,
        },
    )?;

    let updated = ctx
        .db
        .consolidation_journal()
        .id()
        .find(&journal.id)
        .ok_or("Journal missing after eliminations")?;

    if updated.state != ConsolidationState::Draft {
        return Err("Expected draft consolidation journal".to_string());
    }

    let entries: Vec<_> = ctx
        .db
        .consolidation_elimination_entry()
        .elimination_by_journal()
        .filter(&journal.id)
        .collect();

    if entries.len() != 2 {
        return Err(format!(
            "Expected 2 elimination entries, got {}",
            entries.len()
        ));
    }

    let net_debit: f64 = entries.iter().map(|e| e.debit).sum();
    let net_credit: f64 = entries.iter().map(|e| e.credit).sum();
    if (net_debit - net_credit).abs() > 0.001 {
        return Err(format!(
            "Elimination entries not balanced: debit={net_debit} credit={net_credit}"
        ));
    }

    if (updated.total_debit - updated.total_credit).abs() > 0.001 {
        return Err("Consolidation journal totals not balanced".to_string());
    }

    if rule.organization_id != Some(fixture.organization_id)
        || transaction.organization_id != Some(fixture.organization_id)
        || consolidation_account.organization_id != Some(fixture.organization_id)
        || updated.organization_id != Some(fixture.organization_id)
        || company_rate.organization_id != Some(fixture.organization_id)
        || entries
            .iter()
            .any(|entry| entry.organization_id != Some(fixture.organization_id))
    {
        return Err("new accounting ownership was not persisted".to_string());
    }

    process_consolidation(ctx, fixture.organization_id, updated.id)?;
    let processed_once = ctx
        .db
        .consolidation_journal()
        .id()
        .find(&updated.id)
        .ok_or("processed consolidation journal not found")?;
    process_consolidation(ctx, fixture.organization_id, updated.id)?;
    let processed_twice = ctx
        .db
        .consolidation_journal()
        .id()
        .find(&updated.id)
        .ok_or("retried consolidation journal not found")?;
    if processed_twice.state != ConsolidationState::InProgress
        || processed_twice.processed_at != processed_once.processed_at
        || processed_twice.processed_by != processed_once.processed_by
        || processed_twice.elimination_entries != processed_once.elimination_entries
    {
        return Err("consolidation processing retry changed persisted effects".to_string());
    }
    let process_audits = ctx
        .db
        .audit_log()
        .iter()
        .filter(|audit| {
            audit.organization_id == fixture.organization_id
                && audit.table_name == "consolidation_journal"
                && audit.record_id == updated.id
                && audit.action == "UPDATE"
                && audit
                    .new_values
                    .as_deref()
                    .is_some_and(|values| values.contains("\"InProgress\""))
        })
        .count();
    if process_audits != 1 {
        return Err(format!(
            "consolidation retry persisted {process_audits} processing audits"
        ));
    }
    let process_receipts: Vec<_> = ctx
        .db
        .accounting_operation_receipt()
        .iter()
        .filter(|receipt| {
            receipt.organization_id == fixture.organization_id
                && receipt.company_id == fixture.company_id
                && receipt.action_kind == "process_consolidation"
                && receipt.result_id == updated.id
        })
        .collect();
    if process_receipts.len() != 1 {
        return Err(format!(
            "consolidation retry persisted {} operation receipts",
            process_receipts.len()
        ));
    }

    let foreign_fixture = OrgFixture::seed_minimal(ctx)?;
    match process_consolidation(ctx, foreign_fixture.organization_id, updated.id) {
        Err(error) if error.contains("organization") => {}
        Err(error) => {
            return Err(format!(
                "unexpected cross-tenant consolidation processing error: {error}"
            ))
        }
        Ok(()) => return Err("cross-tenant consolidation processing succeeded".to_string()),
    }
    let cross_tenant_update = set_intercompany_rule_active(
        ctx,
        foreign_fixture.organization_id,
        foreign_fixture.company_id,
        rule.id,
        false,
    );
    match cross_tenant_update {
        Err(error) if error.contains("organization") => {}
        Err(error) => return Err(format!("unexpected cross-tenant rule error: {error}")),
        Ok(()) => return Err("cross-tenant intercompany rule update succeeded".to_string()),
    }

    let rule_id = rule.id;
    let transaction_id = transaction.id;
    let consolidation_account_id = consolidation_account.id;
    let journal_id = updated.id;
    let entry_id = entries[0].id;
    let company_rate_id = company_rate.id;
    ctx.db.intercompany_rule().id().update(IntercompanyRule {
        organization_id: Some(foreign_fixture.organization_id),
        ..rule
    });
    ctx.db
        .intercompany_transaction()
        .id()
        .update(IntercompanyTransaction {
            organization_id: None,
            ..transaction
        });
    ctx.db
        .consolidation_account()
        .id()
        .update(ConsolidationAccount {
            organization_id: Some(foreign_fixture.organization_id),
            ..consolidation_account
        });
    ctx.db
        .consolidation_journal()
        .id()
        .update(ConsolidationJournal {
            organization_id: None,
            ..processed_twice
        });
    ctx.db
        .consolidation_elimination_entry()
        .id()
        .update(ConsolidationEliminationEntry {
            organization_id: None,
            ..entries[0].clone()
        });
    ctx.db
        .consolidation_company_rate()
        .id()
        .update(ConsolidationCompanyRate {
            organization_id: None,
            ..company_rate
        });

    backfill_intercompany_organization_ownership(ctx)?;
    backfill_consolidation_organization_ownership(ctx)?;

    let quarantined_rule = ctx
        .db
        .intercompany_rule()
        .id()
        .find(&rule_id)
        .ok_or("Quarantined intercompany rule missing")?;
    let backfilled_transaction = ctx
        .db
        .intercompany_transaction()
        .id()
        .find(&transaction_id)
        .ok_or("Backfilled intercompany transaction missing")?;
    let quarantined_account = ctx
        .db
        .consolidation_account()
        .id()
        .find(&consolidation_account_id)
        .ok_or("Quarantined consolidation account missing")?;
    let backfilled_journal = ctx
        .db
        .consolidation_journal()
        .id()
        .find(&journal_id)
        .ok_or("Backfilled consolidation journal missing")?;
    let backfilled_entry = ctx
        .db
        .consolidation_elimination_entry()
        .id()
        .find(&entry_id)
        .ok_or("Backfilled elimination entry missing")?;
    let backfilled_rate = ctx
        .db
        .consolidation_company_rate()
        .id()
        .find(&company_rate_id)
        .ok_or("Backfilled consolidation company rate missing")?;

    if quarantined_rule.organization_id.is_some() || quarantined_account.organization_id.is_some() {
        return Err("conflicting accounting ownership was not quarantined".to_string());
    }
    if backfilled_transaction.organization_id != Some(fixture.organization_id)
        || backfilled_journal.organization_id != Some(fixture.organization_id)
        || backfilled_entry.organization_id != Some(fixture.organization_id)
        || backfilled_rate.organization_id != Some(fixture.organization_id)
    {
        return Err(
            "missing accounting ownership was not deterministically backfilled".to_string(),
        );
    }
    if !ctx
        .db
        .accounting_ownership_backfill_issue()
        .iter()
        .any(|issue| issue.table_name == "intercompany_rule" && issue.record_id == rule_id)
        || !ctx
            .db
            .accounting_ownership_backfill_issue()
            .iter()
            .any(|issue| {
                issue.table_name == "consolidation_account"
                    && issue.record_id == consolidation_account_id
            })
    {
        return Err("conflicting accounting ownership was not reported".to_string());
    }

    if set_intercompany_rule_active(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        rule_id,
        false,
    )
    .is_ok()
    {
        return Err("quarantined intercompany rule remained mutable".to_string());
    }
    if update_consolidation_account(
        ctx,
        fixture.organization_id,
        consolidation_account_id,
        UpdateConsolidationAccountParams {
            name: Some("must remain quarantined".to_string()),
            code: None,
            account_type: None,
            company_ids: None,
            consolidation_rate: None,
            elimination_account_id: None,
            is_intercompany: None,
            elimination_method: None,
            is_active: None,
            notes: None,
            metadata: None,
        },
    )
    .is_ok()
    {
        return Err("quarantined consolidation account remained mutable".to_string());
    }

    Ok(())
}

/// ACC-RI-024: `create_intercompany_rule` and `update_intercompany_rule` must
/// validate `journal_id`/`account_id`/`pricelist_id` under the destination
/// company's organization instead of storing them unchecked (representative
/// coverage via `account_id`; `journal_id` and `pricelist_id` are validated
/// by the identical pattern in the same function).
pub fn test_intercompany_rule_rejects_cross_tenant_account(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;
    let sibling_a2 = super::helpers::seed_sibling_company(ctx, &fixture_a)?;

    let foreign_account_id = *fixture_b
        .chart_account_ids
        .get(crate::test_harness::chart_keys::AR)
        .ok_or("harness B missing AR account")?;

    let cross_tenant_result = create_intercompany_rule(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        sibling_a2,
        CreateIntercompanyRuleParams {
            name: "ACC-RI-024 cross-tenant account".to_string(),
            rule_type: RuleType::Invoice,
            auto_validation: false,
            auto_generate_invoice: false,
            auto_generate_bill: false,
            is_active: true,
            journal_id: None,
            account_id: Some(foreign_account_id),
            pricelist_id: None,
            sequence: 1,
            notes: None,
            metadata: None,
        },
    );
    if cross_tenant_result.is_ok() {
        return Err(
            "create_intercompany_rule accepted a cross-organization account_id".to_string(),
        );
    }

    let rule_exists = ctx
        .db
        .intercompany_rule()
        .iter()
        .any(|r| r.name == "ACC-RI-024 cross-tenant account");
    if rule_exists {
        return Err(
            "rejected cross-tenant intercompany rule create still persisted a row".to_string(),
        );
    }

    // Positive: an account owned by the destination company is accepted.
    let destination_fixture = OrgFixture {
        company_id: sibling_a2,
        ..fixture_a.clone()
    };
    let (_, own_account_id) = super::helpers::seed_bank_journal(ctx, &destination_fixture)?;
    create_intercompany_rule(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        sibling_a2,
        CreateIntercompanyRuleParams {
            name: "ACC-RI-024 same-tenant account".to_string(),
            rule_type: RuleType::Invoice,
            auto_validation: false,
            auto_generate_invoice: false,
            auto_generate_bill: false,
            is_active: true,
            journal_id: None,
            account_id: Some(own_account_id),
            pricelist_id: None,
            sequence: 1,
            notes: None,
            metadata: None,
        },
    )?;

    Ok(())
}

/// ACC-RI-015: `process_intercompany_transaction` must reject a destination
/// document belonging to a different organization/company than the
/// transaction's destination company, instead of storing it unchecked.
pub fn test_process_intercompany_transaction_rejects_cross_tenant_destination(
    ctx: &ReducerContext,
) -> Result<(), String> {
    use crate::accounting::intercompany::{
        process_intercompany_transaction, ProcessIntercompanyTransactionParams,
    };

    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;
    let sibling_a2 = super::helpers::seed_sibling_company(ctx, &fixture_a)?;

    let origin_move =
        super::helpers::create_balanced_customer_invoice(ctx, &fixture_a, 731.29, true)?;

    create_intercompany_transaction(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        CreateIntercompanyTransactionParams {
            origin_document_id: origin_move,
            origin_document_model: IntercompanyDocumentModel::AccountMove,
            destination_company_id: sibling_a2,
            amount: 731.29,
            currency_id: 1,
            transaction_type: RuleType::Invoice,
            notes: None,
            auto_process: false,
            requires_approval: false,
            metadata: None,
        },
    )?;
    let transaction = ctx
        .db
        .intercompany_transaction()
        .iter()
        .find(|t| {
            t.organization_id == Some(fixture_a.organization_id)
                && t.origin_document_id == origin_move
        })
        .ok_or("intercompany transaction not found after create")?;

    // A foreign org's posted invoice used as the destination document.
    let foreign_move =
        super::helpers::create_balanced_customer_invoice(ctx, &fixture_b, 40.0, true)?;

    let cross_tenant_result = process_intercompany_transaction(
        ctx,
        fixture_a.organization_id,
        sibling_a2,
        transaction.id,
        ProcessIntercompanyTransactionParams {
            destination_document_id: foreign_move,
            destination_document_model: IntercompanyDocumentModel::AccountMove,
        },
    );
    if cross_tenant_result.is_ok() {
        return Err(
            "process_intercompany_transaction accepted a cross-organization destination document"
                .to_string(),
        );
    }

    let unchanged = ctx
        .db
        .intercompany_transaction()
        .id()
        .find(&transaction.id)
        .ok_or("intercompany transaction disappeared after rejected process")?;
    if unchanged.destination_document_id.is_some() {
        return Err("rejected cross-tenant destination document was still persisted".to_string());
    }

    Ok(())
}

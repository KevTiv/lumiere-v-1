//! Intercompany + consolidation smoke tests (A4 elimination path).
use std::time::Duration;

use spacetimedb::{ReducerContext, Table};

use crate::accounting::consolidation::{
    backfill_consolidation_organization_ownership, consolidation_account,
    consolidation_company_rate, consolidation_elimination_entry, consolidation_journal,
    create_consolidation_account, create_consolidation_journal, create_elimination_entry,
    set_consolidation_company_rate, update_consolidation_account, ConsolidationAccount,
    ConsolidationCompanyRate, ConsolidationEliminationEntry, ConsolidationJournal,
    CreateConsolidationAccountParams, CreateConsolidationJournalParams,
    CreateEliminationEntryParams, SetConsolidationCompanyRateParams,
    UpdateConsolidationAccountParams,
};
use crate::accounting::fiscal_periods::accounting_ownership_backfill_issue;
use crate::accounting::intercompany::{
    backfill_intercompany_organization_ownership, create_intercompany_rule,
    create_intercompany_transaction, intercompany_rule, intercompany_transaction,
    set_intercompany_rule_active, CreateIntercompanyRuleParams,
    CreateIntercompanyTransactionParams, IntercompanyRule, IntercompanyTransaction,
};
use crate::core::organization::{company, create_company, CreateCompanyParams};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{ConsolidationState, RuleType};

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
            origin_document_id: fixture.fiscal_year_id,
            origin_document_model: "account.fiscal.year".to_string(),
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
            period_id: fixture.fiscal_year_id,
            period_name: "FY smoke".to_string(),
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
    create_elimination_entry(
        ctx,
        fixture.organization_id,
        CreateEliminationEntryParams {
            journal_id: journal.id,
            name: "IC AR elimination".to_string(),
            account_id: 1,
            account_code: "1200".to_string(),
            account_name: "Intercompany AR".to_string(),
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
            account_id: 2,
            account_code: "2100".to_string(),
            account_name: "Intercompany AP".to_string(),
            company_id: sub_company_id,
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

    let foreign_fixture = OrgFixture::seed_minimal(ctx)?;
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
            ..updated
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

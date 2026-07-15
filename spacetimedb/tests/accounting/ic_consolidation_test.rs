//! Intercompany + consolidation smoke tests (A4 elimination path).
use std::time::Duration;

use spacetimedb::{ReducerContext, Table};

use crate::accounting::consolidation::{
    create_consolidation_journal, create_elimination_entry, consolidation_elimination_entry,
    consolidation_journal, CreateConsolidationJournalParams, CreateEliminationEntryParams,
};
use crate::accounting::intercompany::{
    create_intercompany_rule, intercompany_rule, CreateIntercompanyRuleParams,
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

    let rule_count = ctx
        .db
        .intercompany_rule()
        .intercompany_rule_by_source()
        .filter(&fixture.company_id)
        .count();
    if rule_count == 0 {
        return Err("Intercompany rule not created".to_string());
    }

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
        return Err(format!("Expected 2 elimination entries, got {}", entries.len()));
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

    Ok(())
}

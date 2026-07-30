//! ACC-RI-017 — `Option<Vec>` many-to-many update semantics.
//!
//! `None` preserves, `Some([])` clears, `Some(ids)` replaces; duplicates fail.

use spacetimedb::{ReducerContext, Table};

use crate::accounting::budgeting::{
    budget_post, create_budget_post, update_budget_post, CreateBudgetPostParams,
    UpdateBudgetPostParams,
};
use crate::accounting::chart_of_accounts::{
    account_account, update_account_account, UpdateAccountAccountParams,
};
use crate::accounting::tax_management::{
    account_tax, account_tax_group, create_account_tax, create_account_tax_group,
    CreateAccountTaxGroupParams, CreateAccountTaxParams,
};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{TaxAmountType, TaxTypeUse};

fn seed_two_taxes(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<(u64, u64), String> {
    let payable_id = *fixture
        .chart_account_ids
        .get(chart_keys::AP)
        .ok_or("harness missing AP")?;
    let receivable_id = *fixture
        .chart_account_ids
        .get(chart_keys::AR)
        .ok_or("harness missing AR")?;
    let group_name = format!("ACC-RI-017 group {}", fixture.company_id);
    create_account_tax_group(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateAccountTaxGroupParams {
            name: group_name.clone(),
            sequence: 10,
            preceding_subtotal: None,
            tax_payable_account_id: Some(payable_id),
            tax_receivable_account_id: Some(receivable_id),
            advance_tax_payment_account_id: Some(receivable_id),
            metadata: Some(r#"{"test":"acc_ri_017"}"#.to_string()),
        },
    )?;
    let group_id = ctx
        .db
        .account_tax_group()
        .iter()
        .find(|g| {
            g.organization_id == fixture.organization_id
                && g.company_id == fixture.company_id
                && g.name == group_name
        })
        .map(|g| g.id)
        .ok_or("ACC-RI-017 tax group missing")?;

    let mut tax_ids = Vec::with_capacity(2);
    for label in ["A", "B"] {
        let name = format!("ACC-RI-017 tax {label} {}", fixture.company_id);
        create_account_tax(
            ctx,
            fixture.organization_id,
            fixture.company_id,
            CreateAccountTaxParams {
                name: name.clone(),
                description: None,
                type_tax_use: TaxTypeUse::Sale,
                amount_type: TaxAmountType::Percent,
                amount: 10.0,
                active: true,
                price_include: false,
                include_base_amount: false,
                is_base_affected: true,
                sequence: 10,
                tax_group_id: Some(group_id),
                country_id: None,
                country_code: None,
                tags: vec![],
                has_negative_factor: false,
                invoice_repartition_line_ids: vec![],
                refund_repartition_line_ids: vec![],
                metadata: Some(r#"{"test":"acc_ri_017"}"#.to_string()),
            },
        )?;
        let id = ctx
            .db
            .account_tax()
            .iter()
            .find(|t| {
                t.organization_id == fixture.organization_id
                    && t.company_id == fixture.company_id
                    && t.name == name
            })
            .map(|t| t.id)
            .ok_or_else(|| format!("ACC-RI-017 tax {label} missing"))?;
        tax_ids.push(id);
    }
    Ok((tax_ids[0], tax_ids[1]))
}

fn empty_account_update(company_id: u64) -> UpdateAccountAccountParams {
    UpdateAccountAccountParams {
        company_id: Some(company_id),
        name: None,
        code: None,
        deprecated: None,
        currency_id: None,
        internal_type: None,
        internal_group: None,
        group_id: None,
        reconcile: None,
        tax_ids: None,
        note: None,
        allowed_journal_ids: None,
        non_trade: None,
        metadata: None,
    }
}

/// Chart-of-accounts `tax_ids`: omit / clear / replace / duplicate-reject.
pub fn test_account_tax_ids_option_vec_semantics(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let (tax_a, tax_b) = seed_two_taxes(ctx, &fixture)?;
    let account_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("harness missing REVENUE")?;

    update_account_account(
        ctx,
        fixture.organization_id,
        account_id,
        UpdateAccountAccountParams {
            tax_ids: Some(vec![tax_a, tax_b]),
            ..empty_account_update(fixture.company_id)
        },
    )?;
    let replaced = ctx
        .db
        .account_account()
        .id()
        .find(&account_id)
        .ok_or("account missing after replace")?;
    if replaced.tax_ids != vec![tax_a, tax_b] {
        return Err(format!(
            "Some([a,b]) did not replace tax_ids: got {:?}",
            replaced.tax_ids
        ));
    }

    update_account_account(
        ctx,
        fixture.organization_id,
        account_id,
        UpdateAccountAccountParams {
            name: Some("ACC-RI-017 name-only".to_string()),
            tax_ids: None,
            ..empty_account_update(fixture.company_id)
        },
    )?;
    let preserved = ctx
        .db
        .account_account()
        .id()
        .find(&account_id)
        .ok_or("account missing after omit")?;
    if preserved.tax_ids != vec![tax_a, tax_b] {
        return Err("None tax_ids cleared stored links".to_string());
    }
    if preserved.name != "ACC-RI-017 name-only" {
        return Err("name-only update did not apply".to_string());
    }

    update_account_account(
        ctx,
        fixture.organization_id,
        account_id,
        UpdateAccountAccountParams {
            tax_ids: Some(vec![]),
            ..empty_account_update(fixture.company_id)
        },
    )?;
    let cleared = ctx
        .db
        .account_account()
        .id()
        .find(&account_id)
        .ok_or("account missing after clear")?;
    if !cleared.tax_ids.is_empty() {
        return Err("Some([]) did not clear tax_ids".to_string());
    }

    let dup = update_account_account(
        ctx,
        fixture.organization_id,
        account_id,
        UpdateAccountAccountParams {
            tax_ids: Some(vec![tax_a, tax_a]),
            ..empty_account_update(fixture.company_id)
        },
    );
    if dup.is_ok() {
        return Err("duplicate tax_ids were accepted".to_string());
    }

    Ok(())
}

/// Budget-post `account_ids`: omit / clear / replace / duplicate-reject.
pub fn test_budget_post_account_ids_option_vec_semantics(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let account_a = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("harness missing REVENUE")?;
    let account_b = *fixture
        .chart_account_ids
        .get(chart_keys::AR)
        .ok_or("harness missing AR")?;

    let post_name = format!("ACC-RI-017 post {}", fixture.company_id);
    create_budget_post(
        ctx,
        fixture.organization_id,
        CreateBudgetPostParams {
            company_id: Some(fixture.company_id),
            name: post_name.clone(),
            code: Some("RI017".to_string()),
            description: None,
            account_ids: vec![account_a],
            is_active: true,
            metadata: Some(r#"{"test":"acc_ri_017"}"#.to_string()),
        },
    )?;
    let post_id = ctx
        .db
        .budget_post()
        .iter()
        .find(|p| p.organization_id == fixture.organization_id && p.name == post_name)
        .map(|p| p.id)
        .ok_or("budget post missing after create")?;

    update_budget_post(
        ctx,
        fixture.organization_id,
        post_id,
        UpdateBudgetPostParams {
            company_id: Some(fixture.company_id),
            name: None,
            code: None,
            description: None,
            account_ids: Some(vec![account_a, account_b]),
            is_active: None,
            metadata: None,
        },
    )?;
    let replaced = ctx
        .db
        .budget_post()
        .id()
        .find(&post_id)
        .ok_or("budget post missing after replace")?;
    if replaced.account_ids != vec![account_a, account_b] {
        return Err(format!(
            "Some([a,b]) did not replace account_ids: got {:?}",
            replaced.account_ids
        ));
    }

    update_budget_post(
        ctx,
        fixture.organization_id,
        post_id,
        UpdateBudgetPostParams {
            company_id: Some(fixture.company_id),
            name: Some("ACC-RI-017 post renamed".to_string()),
            code: None,
            description: None,
            account_ids: None,
            is_active: None,
            metadata: None,
        },
    )?;
    let preserved = ctx
        .db
        .budget_post()
        .id()
        .find(&post_id)
        .ok_or("budget post missing after omit")?;
    if preserved.account_ids != vec![account_a, account_b] {
        return Err("None account_ids cleared stored links".to_string());
    }

    update_budget_post(
        ctx,
        fixture.organization_id,
        post_id,
        UpdateBudgetPostParams {
            company_id: Some(fixture.company_id),
            name: None,
            code: None,
            description: None,
            account_ids: Some(vec![]),
            is_active: None,
            metadata: None,
        },
    )?;
    let cleared = ctx
        .db
        .budget_post()
        .id()
        .find(&post_id)
        .ok_or("budget post missing after clear")?;
    if !cleared.account_ids.is_empty() {
        return Err("Some([]) did not clear account_ids".to_string());
    }

    let dup = update_budget_post(
        ctx,
        fixture.organization_id,
        post_id,
        UpdateBudgetPostParams {
            company_id: Some(fixture.company_id),
            name: None,
            code: None,
            description: None,
            account_ids: Some(vec![account_a, account_a]),
            is_active: None,
            metadata: None,
        },
    );
    if dup.is_ok() {
        return Err("duplicate account_ids were accepted".to_string());
    }

    let create_dup = create_budget_post(
        ctx,
        fixture.organization_id,
        CreateBudgetPostParams {
            company_id: Some(fixture.company_id),
            name: format!("ACC-RI-017 dup create {}", fixture.company_id),
            code: None,
            description: None,
            account_ids: vec![account_a, account_a],
            is_active: true,
            metadata: None,
        },
    );
    if create_dup.is_ok() {
        return Err("create_budget_post accepted duplicate account_ids".to_string());
    }

    Ok(())
}

use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_account_type, account_group, account_journal, create_account_account,
    create_account_group, create_account_journal, update_account_group, CreateAccountAccountParams,
    CreateAccountGroupParams, CreateAccountJournalParams, UpdateAccountGroupParams,
};
use crate::accounting::credit_control::{
    create_bad_debt_write_off, partner_credit_control, upsert_partner_credit_control,
    CreateBadDebtWriteOffParams, UpsertPartnerCreditControlParams,
};
use crate::accounting::journal_entries::account_move;
use crate::accounting::tax_management::{
    account_tax, account_tax_group, create_account_tax, create_account_tax_group,
    create_tax_deadline, create_tax_schedule, tax_schedule, AccountTax,
    CreateAccountTaxGroupParams, CreateAccountTaxParams, CreateTaxDeadlineParams,
    CreateTaxScheduleParams,
};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{AccountInternalGroup, JournalType, TaxAmountType, TaxDeadlineType, TaxTypeUse};

use super::fixed_assets_test::asset_params;
use super::helpers::create_balanced_customer_invoice;
use crate::crm::contacts::contact;

fn journal_params(company_id: u64, code: &str) -> CreateAccountJournalParams {
    CreateAccountJournalParams {
        company_id: Some(company_id),
        name: format!("ACC-RI-006 journal {code}"),
        code: code.to_string(),
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
        metadata: Some(r#"{"test":"acc_ri_006"}"#.to_string()),
    }
}

fn account_params(company_id: u64, user_type_id: u64, code: &str) -> CreateAccountAccountParams {
    CreateAccountAccountParams {
        company_id: Some(company_id),
        code: code.to_string(),
        name: format!("ACC-RI-006 account {code}"),
        user_type_id,
        currency_id: None,
        internal_type: None,
        internal_group: Some(AccountInternalGroup::Asset),
        group_id: None,
        reconcile: false,
        tax_ids: vec![],
        note: None,
        opening_debit: 0.0,
        opening_credit: 0.0,
        allowed_journal_ids: vec![],
        non_trade: false,
        is_off_balance: false,
        metadata: Some(r#"{"test":"acc_ri_006"}"#.to_string()),
    }
}

fn tax_params(name: &str, group_id: Option<u64>) -> CreateAccountTaxParams {
    CreateAccountTaxParams {
        name: name.to_string(),
        description: None,
        type_tax_use: TaxTypeUse::Sale,
        amount_type: TaxAmountType::Percent,
        amount: 17.25,
        active: true,
        price_include: false,
        include_base_amount: false,
        is_base_affected: true,
        sequence: 10,
        tax_group_id: group_id,
        country_id: None,
        country_code: None,
        tags: vec![],
        has_negative_factor: false,
        invoice_repartition_line_ids: vec![],
        refund_repartition_line_ids: vec![],
        metadata: Some(r#"{"test":"acc_ri_006"}"#.to_string()),
    }
}

fn seed_tax_group(ctx: &ReducerContext, fixture: &OrgFixture, name: &str) -> Result<u64, String> {
    let payable_id = *fixture
        .chart_account_ids
        .get(chart_keys::AP)
        .ok_or("harness missing payable account")?;
    let receivable_id = *fixture
        .chart_account_ids
        .get(chart_keys::AR)
        .ok_or("harness missing receivable account")?;
    create_account_tax_group(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateAccountTaxGroupParams {
            name: name.to_string(),
            sequence: 10,
            preceding_subtotal: None,
            tax_payable_account_id: Some(payable_id),
            tax_receivable_account_id: Some(receivable_id),
            advance_tax_payment_account_id: Some(receivable_id),
            metadata: Some(r#"{"test":"acc_ri_006"}"#.to_string()),
        },
    )?;
    ctx.db
        .account_tax_group()
        .iter()
        .find(|group| {
            group.organization_id == fixture.organization_id
                && group.company_id == fixture.company_id
                && group.name == name
        })
        .map(|group| group.id)
        .ok_or_else(|| "tax group not found after create".to_string())
}

fn seed_tax(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    name: &str,
    group_id: u64,
) -> Result<AccountTax, String> {
    create_account_tax(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        tax_params(name, Some(group_id)),
    )?;
    ctx.db
        .account_tax()
        .iter()
        .find(|tax| {
            tax.organization_id == fixture.organization_id
                && tax.company_id == fixture.company_id
                && tax.name == name
        })
        .ok_or_else(|| "tax not found after create".to_string())
}

fn expect_err(label: &str, result: Result<(), String>) -> Result<(), String> {
    if result.is_ok() {
        Err(format!("{label} accepted an invalid relation"))
    } else {
        Ok(())
    }
}

pub fn test_core_relation_negative_matrix(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;

    create_account_journal(
        ctx,
        fixture.organization_id,
        journal_params(fixture.company_id, &format!("R6J{}", fixture.company_id)),
    )?;
    create_account_journal(
        ctx,
        foreign.organization_id,
        journal_params(foreign.company_id, &format!("R6J{}", foreign.company_id)),
    )?;
    let local_journal = ctx
        .db
        .account_journal()
        .iter()
        .find(|journal| {
            journal.organization_id == fixture.organization_id
                && journal.code == format!("R6J{}", fixture.company_id)
        })
        .ok_or("local journal not found")?;
    let foreign_journal = ctx
        .db
        .account_journal()
        .iter()
        .find(|journal| {
            journal.organization_id == foreign.organization_id
                && journal.code == format!("R6J{}", foreign.company_id)
        })
        .ok_or("foreign journal not found")?;

    let local_type_id = ctx
        .db
        .account_account_type()
        .iter()
        .find(|account_type| {
            account_type.organization_id == fixture.organization_id
                && account_type.company_id == Some(fixture.company_id)
        })
        .map(|account_type| account_type.id)
        .ok_or("local account type not found")?;
    let foreign_type_id = ctx
        .db
        .account_account_type()
        .iter()
        .find(|account_type| {
            account_type.organization_id == foreign.organization_id
                && account_type.company_id == Some(foreign.company_id)
        })
        .map(|account_type| account_type.id)
        .ok_or("foreign account type not found")?;

    for (label, params) in [
        (
            "missing account type",
            account_params(fixture.company_id, u64::MAX, "R6-A-MISSING"),
        ),
        (
            "cross-organization account type",
            account_params(fixture.company_id, foreign_type_id, "R6-A-FOREIGN"),
        ),
        (
            "missing allowed journal",
            CreateAccountAccountParams {
                allowed_journal_ids: vec![u64::MAX],
                ..account_params(fixture.company_id, local_type_id, "R6-A-MISSING-J")
            },
        ),
        (
            "cross-organization allowed journal",
            CreateAccountAccountParams {
                allowed_journal_ids: vec![foreign_journal.id],
                ..account_params(fixture.company_id, local_type_id, "R6-A-FOREIGN-J")
            },
        ),
        (
            "duplicate allowed journals",
            CreateAccountAccountParams {
                allowed_journal_ids: vec![local_journal.id, local_journal.id],
                ..account_params(fixture.company_id, local_type_id, "R6-A-DUP-J")
            },
        ),
    ] {
        expect_err(
            label,
            create_account_account(ctx, fixture.organization_id, params),
        )?;
    }

    let journal_before = ctx
        .db
        .account_journal()
        .iter()
        .filter(|journal| journal.organization_id == fixture.organization_id)
        .count();
    for (label, params) in [
        (
            "missing journal account",
            CreateAccountJournalParams {
                default_account_id: Some(u64::MAX),
                ..journal_params(fixture.company_id, "R6-BAD-ACCOUNT")
            },
        ),
        (
            "cross-organization journal account",
            CreateAccountJournalParams {
                default_account_id: foreign.chart_account_ids.get(chart_keys::AR).copied(),
                ..journal_params(fixture.company_id, "R6-FOREIGN-ACCOUNT")
            },
        ),
        (
            "unmodeled journal sequence",
            CreateAccountJournalParams {
                sequence_id: Some(41),
                ..journal_params(fixture.company_id, "R6-SEQUENCE")
            },
        ),
        (
            "unmodeled journal payment methods",
            CreateAccountJournalParams {
                dedicated_payment_method_ids: vec![7],
                ..journal_params(fixture.company_id, "R6-PAYMENT-METHOD")
            },
        ),
        (
            "missing journal activity type",
            CreateAccountJournalParams {
                sale_activity_type_id: Some(u64::MAX),
                ..journal_params(fixture.company_id, "R6-ACTIVITY")
            },
        ),
    ] {
        expect_err(
            label,
            create_account_journal(ctx, fixture.organization_id, params),
        )?;
    }
    if ctx
        .db
        .account_journal()
        .iter()
        .filter(|journal| journal.organization_id == fixture.organization_id)
        .count()
        != journal_before
    {
        return Err("rejected journal relations persisted a journal".to_string());
    }

    create_account_group(
        ctx,
        foreign.organization_id,
        CreateAccountGroupParams {
            name: "ACC-RI-006 foreign group".to_string(),
            code_prefix_start: None,
            code_prefix_end: None,
            level: 1,
            parent_id: None,
            company_id: Some(foreign.company_id),
            metadata: None,
        },
    )?;
    let foreign_group_id = ctx
        .db
        .account_group()
        .iter()
        .find(|group| {
            group.organization_id == foreign.organization_id
                && group.name == "ACC-RI-006 foreign group"
        })
        .map(|group| group.id)
        .ok_or("foreign account group not found")?;
    expect_err(
        "cross-organization account-group parent",
        create_account_group(
            ctx,
            fixture.organization_id,
            CreateAccountGroupParams {
                name: "ACC-RI-006 invalid child".to_string(),
                code_prefix_start: None,
                code_prefix_end: None,
                level: 2,
                parent_id: Some(foreign_group_id),
                company_id: Some(fixture.company_id),
                metadata: None,
            },
        ),
    )?;
    create_account_group(
        ctx,
        fixture.organization_id,
        CreateAccountGroupParams {
            name: "ACC-RI-006 local group".to_string(),
            code_prefix_start: None,
            code_prefix_end: None,
            level: 1,
            parent_id: None,
            company_id: Some(fixture.company_id),
            metadata: None,
        },
    )?;
    let local_group_id = ctx
        .db
        .account_group()
        .iter()
        .find(|group| {
            group.organization_id == fixture.organization_id
                && group.name == "ACC-RI-006 local group"
        })
        .map(|group| group.id)
        .ok_or("local account group not found")?;
    expect_err(
        "self-parent account group",
        update_account_group(
            ctx,
            fixture.organization_id,
            local_group_id,
            UpdateAccountGroupParams {
                company_id: Some(fixture.company_id),
                name: None,
                code_prefix_start: None,
                code_prefix_end: None,
                level: None,
                parent_id: Some(Some(local_group_id)),
                metadata: None,
            },
        ),
    )?;

    let local_tax_group = seed_tax_group(ctx, &fixture, "ACC-RI-006 local tax group")?;
    let foreign_tax_group = seed_tax_group(ctx, &foreign, "ACC-RI-006 foreign tax group")?;
    let local_tax = seed_tax(ctx, &fixture, "ACC-RI-006 local tax", local_tax_group)?;
    let foreign_tax = seed_tax(ctx, &foreign, "ACC-RI-006 foreign tax", foreign_tax_group)?;

    for (label, params) in [
        (
            "cross-organization tax group",
            tax_params("ACC-RI-006 bad group tax", Some(foreign_tax_group)),
        ),
        (
            "missing numeric country",
            CreateAccountTaxParams {
                country_id: Some(u64::MAX),
                ..tax_params("ACC-RI-006 missing country tax", None)
            },
        ),
        (
            "unmodeled tax tags",
            CreateAccountTaxParams {
                tags: vec![1],
                ..tax_params("ACC-RI-006 tag tax", None)
            },
        ),
        (
            "unmodeled tax repartition lines",
            CreateAccountTaxParams {
                invoice_repartition_line_ids: vec![1],
                ..tax_params("ACC-RI-006 repartition tax", None)
            },
        ),
    ] {
        expect_err(
            label,
            create_account_tax(ctx, fixture.organization_id, fixture.company_id, params),
        )?;
    }

    let schedule_before = ctx
        .db
        .tax_schedule()
        .iter()
        .filter(|schedule| schedule.organization_id == fixture.organization_id)
        .count();
    let schedule_params = |name: &str, tax_ids: Vec<u64>| CreateTaxScheduleParams {
        name: name.to_string(),
        description: None,
        jurisdiction_id: None,
        tax_ids,
        is_active: true,
        effective_from: None,
        effective_to: None,
        metadata: Some(r#"{"test":"acc_ri_006"}"#.to_string()),
    };
    for (label, params) in [
        (
            "missing schedule tax",
            schedule_params("ACC-RI-006 missing schedule tax", vec![u64::MAX]),
        ),
        (
            "cross-organization schedule tax",
            schedule_params("ACC-RI-006 foreign schedule tax", vec![foreign_tax.id]),
        ),
        (
            "duplicate schedule taxes",
            schedule_params(
                "ACC-RI-006 duplicate schedule tax",
                vec![local_tax.id, local_tax.id],
            ),
        ),
    ] {
        expect_err(
            label,
            create_tax_schedule(ctx, fixture.organization_id, fixture.company_id, params),
        )?;
    }
    let inactive_tax = ctx.db.account_tax().id().update(AccountTax {
        active: false,
        ..local_tax.clone()
    });
    expect_err(
        "inactive schedule tax",
        create_tax_schedule(
            ctx,
            fixture.organization_id,
            fixture.company_id,
            schedule_params("ACC-RI-006 inactive schedule tax", vec![inactive_tax.id]),
        ),
    )?;
    ctx.db.account_tax().id().update(AccountTax {
        active: true,
        ..inactive_tax
    });
    if ctx
        .db
        .tax_schedule()
        .iter()
        .filter(|schedule| schedule.organization_id == fixture.organization_id)
        .count()
        != schedule_before
    {
        return Err("rejected tax schedule relations persisted a schedule".to_string());
    }

    let deadline_params = |company_id, tax_obligation_id, title: &str| CreateTaxDeadlineParams {
        company_id,
        tax_obligation_id,
        deadline_type: TaxDeadlineType::Filing,
        title: title.to_string(),
        description: None,
        due_date: ctx.timestamp,
        fiscal_period_start: None,
        fiscal_period_end: None,
        reminder_days_before: vec![7],
        auto_generated: false,
    };
    expect_err(
        "cross-organization tax deadline company",
        create_tax_deadline(
            ctx,
            fixture.organization_id,
            deadline_params(
                Some(foreign.company_id),
                None,
                "ACC-RI-006 foreign deadline",
            ),
        ),
    )?;
    expect_err(
        "unmodeled tax obligation",
        create_tax_deadline(
            ctx,
            fixture.organization_id,
            deadline_params(
                Some(fixture.company_id),
                Some(99),
                "ACC-RI-006 obligation deadline",
            ),
        ),
    )?;

    Ok(())
}

pub fn test_credit_control_relation_negative_matrix(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;

    let control_before = ctx
        .db
        .partner_credit_control()
        .iter()
        .filter(|row| row.organization_id == fixture.organization_id)
        .count();
    for (label, partner_id) in [
        ("missing credit-control partner", u64::MAX),
        (
            "cross-organization credit-control partner",
            foreign.partner_id,
        ),
    ] {
        expect_err(
            label,
            upsert_partner_credit_control(
                ctx,
                fixture.organization_id,
                fixture.company_id,
                UpsertPartnerCreditControlParams {
                    partner_id,
                    credit_limit: 42_500.0,
                    payment_hold: false,
                    notes: None,
                    metadata: Some(r#"{"test":"acc_ri_006"}"#.to_string()),
                },
            ),
        )?;
    }

    let original_partner = ctx
        .db
        .contact()
        .id()
        .find(&fixture.partner_id)
        .ok_or("credit-control partner missing")?;
    ctx.db.contact().id().update(crate::crm::contacts::Contact {
        is_customer: false,
        ..original_partner.clone()
    });
    expect_err(
        "wrong-role credit-control partner",
        upsert_partner_credit_control(
            ctx,
            fixture.organization_id,
            fixture.company_id,
            UpsertPartnerCreditControlParams {
                partner_id: fixture.partner_id,
                credit_limit: 42_500.0,
                payment_hold: false,
                notes: None,
                metadata: None,
            },
        ),
    )?;
    ctx.db.contact().id().update(crate::crm::contacts::Contact {
        deleted_at: Some(ctx.timestamp),
        ..original_partner.clone()
    });
    expect_err(
        "inactive credit-control partner",
        upsert_partner_credit_control(
            ctx,
            fixture.organization_id,
            fixture.company_id,
            UpsertPartnerCreditControlParams {
                partner_id: fixture.partner_id,
                credit_limit: 42_500.0,
                payment_hold: false,
                notes: None,
                metadata: None,
            },
        ),
    )?;
    ctx.db.contact().id().update(original_partner);
    if ctx
        .db
        .partner_credit_control()
        .iter()
        .filter(|row| row.organization_id == fixture.organization_id)
        .count()
        != control_before
    {
        return Err("rejected credit-control partners persisted a row".to_string());
    }

    let invoice_id = create_balanced_customer_invoice(ctx, &fixture, 612.34, true)?;
    let foreign_invoice_id = create_balanced_customer_invoice(ctx, &foreign, 612.34, true)?;
    let dependencies = asset_params(
        ctx,
        &fixture,
        format!("R6-CREDIT-DEPS-{}", fixture.company_id),
        None,
    )?;
    let foreign_dependencies = asset_params(
        ctx,
        &foreign,
        format!("R6-CREDIT-DEPS-{}", foreign.company_id),
        None,
    )?;
    let receivable_id = *fixture
        .chart_account_ids
        .get(chart_keys::AR)
        .ok_or("harness missing receivable account")?;
    let revenue_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("harness missing revenue account")?;
    let move_before = ctx
        .db
        .account_move()
        .iter()
        .filter(|row| row.organization_id == fixture.organization_id)
        .count();
    let write_off_params = |reference: &str| CreateBadDebtWriteOffParams {
        partner_id: fixture.partner_id,
        move_id: invoice_id,
        amount: 12.34,
        journal_id: dependencies.journal_id,
        receivable_account_id: receivable_id,
        write_off_account_id: dependencies.account_depreciation_expense_id,
        date: ctx.timestamp,
        reference: Some(reference.to_string()),
        metadata: Some(r#"{"test":"acc_ri_006"}"#.to_string()),
    };
    for (label, params) in [
        (
            "missing write-off source move",
            CreateBadDebtWriteOffParams {
                move_id: u64::MAX,
                ..write_off_params("R6 missing source")
            },
        ),
        (
            "cross-organization write-off source move",
            CreateBadDebtWriteOffParams {
                move_id: foreign_invoice_id,
                ..write_off_params("R6 foreign source")
            },
        ),
        (
            "cross-organization write-off journal",
            CreateBadDebtWriteOffParams {
                journal_id: foreign_dependencies.journal_id,
                ..write_off_params("R6 foreign journal")
            },
        ),
        (
            "wrong-role write-off receivable account",
            CreateBadDebtWriteOffParams {
                receivable_account_id: revenue_id,
                ..write_off_params("R6 wrong receivable")
            },
        ),
        (
            "wrong-role write-off expense account",
            CreateBadDebtWriteOffParams {
                write_off_account_id: receivable_id,
                ..write_off_params("R6 wrong expense")
            },
        ),
        (
            "mismatched write-off partner",
            CreateBadDebtWriteOffParams {
                partner_id: foreign.partner_id,
                ..write_off_params("R6 wrong partner")
            },
        ),
    ] {
        expect_err(
            label,
            create_bad_debt_write_off(ctx, fixture.organization_id, fixture.company_id, params),
        )?;
    }
    if ctx
        .db
        .account_move()
        .iter()
        .filter(|row| row.organization_id == fixture.organization_id)
        .count()
        != move_before
    {
        return Err("rejected write-off relations persisted a move".to_string());
    }

    Ok(())
}

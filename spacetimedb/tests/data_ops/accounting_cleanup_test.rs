//! Abandoned atomic accounting-import parent cleanup stays provenance-bound and fail-closed.

use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{account_journal, AccountJournal};
use crate::accounting::journal_entries::{
    account_move, account_move_line, add_account_move_line, AccountMove, AddAccountMoveLineParams,
};
use crate::core::audit::audit_log;
use crate::core::organization::{company, create_company, CreateCompanyParams};
use crate::core::permissions::{role, Role};
use crate::core::users::{
    find_user_profile_for_organization, user_organization, user_profile, UserProfile,
};
use crate::data_ops::import_tracker::{
    begin_import_job, cleanup_abandoned_account_move_import, finish_import_job, import_job,
    import_job_record, record_import_created_id, stamp_account_move_bundle_job, ImportJob,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{AccountMoveState, MoveType, PaymentState};

fn journal_for_company(ctx: &ReducerContext, company_id: u64) -> Result<AccountJournal, String> {
    ctx.db
        .account_journal()
        .journal_by_company()
        .filter(&company_id)
        .next()
        .ok_or_else(|| "cleanup test journal missing".to_string())
}

fn seed_abandoned_parent(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    move_count: usize,
) -> Result<(ImportJob, Vec<u64>), String> {
    let journal = journal_for_company(ctx, fixture.company_id)?;
    let mut job = begin_import_job(
        ctx,
        fixture.organization_id,
        "account_move",
        Some("abandoned-accounting.csv".to_string()),
        move_count as u32,
    );
    let job_id = job.id;
    let token = format!("cleanup-parent-{}", job.id);
    let mut move_ids = Vec::with_capacity(move_count);
    for row in 0..move_count {
        let metadata = serde_json::json!({
            "extra": {
                "lumiere_account_move_bundle": {
                    "version": 1,
                    "token": token,
                    "fingerprint": format!("v1-cleanup-{row}"),
                    "original_extra_present": false,
                    "original_extra": null,
                }
            }
        })
        .to_string();
        let created = ctx.db.account_move().insert(AccountMove {
            id: 0,
            organization_id: fixture.organization_id,
            name: format!("Cleanup import {row}"),
            ref_: Some(format!("cleanup-{}-{row}", job.id)),
            move_type: MoveType::Entry,
            auto_post: false,
            state: AccountMoveState::Draft,
            date: ctx.timestamp,
            invoice_date: None,
            invoice_date_due: None,
            invoice_payment_term_id: None,
            invoice_origin: None,
            invoice_partner_display_name: None,
            invoice_cash_rounding_id: None,
            payment_reference: None,
            partner_shipping_id: None,
            sale_order_id: None,
            partner_id: None,
            commercial_partner_id: None,
            partner_bank_id: None,
            fiscal_position_id: None,
            invoice_user_id: Some(ctx.sender()),
            invoice_incoterm_id: None,
            incoterm_location: None,
            campaign_id: None,
            source_id: None,
            medium_id: None,
            company_id: fixture.company_id,
            journal_id: journal.id,
            currency_id: fixture.currency_id,
            company_currency_id: fixture.currency_id,
            amount_untaxed: 0.0,
            amount_tax: 0.0,
            amount_total: 0.0,
            amount_residual: 0.0,
            amount_untaxed_signed: 0.0,
            amount_tax_signed: 0.0,
            amount_total_signed: 0.0,
            amount_total_in_currency_signed: 0.0,
            amount_residual_signed: 0.0,
            to_check: false,
            posted_before: false,
            is_storno: false,
            is_move_sent: false,
            secure_sequence_number: None,
            invoice_has_outstanding: false,
            payment_state: PaymentState::NotPaid,
            restrict_mode_hash_table: false,
            create_uid: Some(ctx.sender()),
            create_date: Some(job.started_at),
            write_uid: Some(ctx.sender()),
            write_date: Some(job.started_at),
            metadata: Some(metadata),
        });
        record_import_created_id(ctx, job.id, "account_move", created.id, row as u32 + 2);
        move_ids.push(created.id);
    }
    job = stamp_account_move_bundle_job(job, "parent", &token, None)?;
    finish_import_job(ctx, job, move_count as u32, 0);
    let persisted = ctx
        .db
        .import_job()
        .id()
        .find(&job_id)
        .ok_or("cleanup parent job missing")?;
    Ok((persisted, move_ids))
}

fn empty_line_params(account_id: u64) -> AddAccountMoveLineParams {
    AddAccountMoveLineParams {
        account_id,
        name: "operator-added line".to_string(),
        debit: 1.0,
        credit: 0.0,
        sequence: 1,
        quantity: 1.0,
        price_unit: 1.0,
        discount: 0.0,
        tax_ids: vec![],
        partner_id: None,
        product_id: None,
        product_uom_id: None,
        product_category_id: None,
        analytic_account_id: None,
        analytic_tag_ids: vec![],
        display_type: None,
        is_downpayment: false,
        exclude_from_invoice_tab: false,
        blocked: false,
        group_tax_id: None,
        tax_line_id: None,
        tax_group_id: None,
        tax_repartition_line_id: None,
        tax_audit: None,
        reconcile_model_id: None,
        payment_id: None,
        statement_line_id: None,
        matching_number: None,
        matching_label: None,
        expected_pay_date: None,
        expected_pay_date_currency_id: None,
        expected_pay_date_amount: 0.0,
        expected_pay_date_residual: 0.0,
        metadata: None,
    }
}

pub fn test_abandoned_account_move_cleanup_is_safe_and_idempotent(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;

    let (parent, move_ids) = seed_abandoned_parent(ctx, &fixture, 1)?;
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|row| row.organization_id == fixture.organization_id)
        .ok_or("cleanup authorization membership missing")?;
    let owner_role = ctx
        .db
        .role()
        .id()
        .find(&membership.role_id)
        .ok_or("cleanup authorization role missing")?;
    let caller = find_user_profile_for_organization(ctx, ctx.sender(), fixture.organization_id)
        .ok_or("cleanup authorization profile missing")?;
    let caller_id = caller.id;
    ctx.db.role().id().update(Role {
        permissions: vec![],
        ..owner_role.clone()
    });
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: false,
        ..caller
    });
    let denied = cleanup_abandoned_account_move_import(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        parent.id,
    );
    ctx.db.role().id().update(owner_role);
    let denied_caller = ctx
        .db
        .user_profile()
        .id()
        .find(&caller_id)
        .ok_or("cleanup authorization profile disappeared")?;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: true,
        ..denied_caller
    });
    if !denied.is_err_and(|error| error.contains("Permission denied"))
        || ctx.db.account_move().id().find(&move_ids[0]).is_none()
    {
        return Err("cleanup permission denial changed its parent draft".to_string());
    }

    let sibling_before: Vec<_> = ctx
        .db
        .company()
        .company_by_org()
        .filter(&fixture.organization_id)
        .map(|row| row.id)
        .collect();
    create_company(
        ctx,
        fixture.organization_id,
        CreateCompanyParams {
            name: "Cleanup sibling".to_string(),
            code: format!("CLEANUP-{}", parent.id),
            currency_id: fixture.currency_id,
            fiscal_year_end_month: 12,
            fiscal_year_end_day: 31,
            is_parent: false,
            parent_id: None,
            tax_id: None,
            company_registry: None,
            address_street: None,
            address_city: None,
            address_zip: None,
            address_country_code: None,
            metadata: None,
        },
    )?;
    let sibling_id = ctx
        .db
        .company()
        .company_by_org()
        .filter(&fixture.organization_id)
        .find(|row| !sibling_before.contains(&row.id))
        .map(|row| row.id)
        .ok_or("cleanup sibling company missing")?;
    if cleanup_abandoned_account_move_import(ctx, fixture.organization_id, sibling_id, parent.id)
        .is_ok()
    {
        return Err("cross-company cleanup succeeded".to_string());
    }
    let other = OrgFixture::seed_minimal(ctx)?;
    if cleanup_abandoned_account_move_import(
        ctx,
        other.organization_id,
        other.company_id,
        parent.id,
    )
    .is_ok()
    {
        return Err("cross-organization cleanup succeeded".to_string());
    }

    cleanup_abandoned_account_move_import(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        parent.id,
    )?;
    if ctx.db.account_move().id().find(&move_ids[0]).is_some()
        || ctx
            .db
            .import_job_record()
            .import_record_by_job()
            .filter(&parent.id)
            .next()
            .is_some()
    {
        return Err("successful cleanup retained its empty draft or tracking row".to_string());
    }
    let audit_count = ctx
        .db
        .audit_log()
        .audit_by_org()
        .filter(&fixture.organization_id)
        .filter(|row| {
            row.table_name == "import_job"
                && row.record_id == parent.id
                && row.action == "ABANDONED_DRAFT_CLEANUP"
        })
        .count();
    cleanup_abandoned_account_move_import(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        parent.id,
    )?;
    let audit_count_after_replay = ctx
        .db
        .audit_log()
        .audit_by_org()
        .filter(&fixture.organization_id)
        .filter(|row| {
            row.table_name == "import_job"
                && row.record_id == parent.id
                && row.action == "ABANDONED_DRAFT_CLEANUP"
        })
        .count();
    if audit_count != 1 || audit_count_after_replay != 1 {
        return Err("cleanup replay was not idempotent or audit-once".to_string());
    }

    let (completed_parent, completed_moves) = seed_abandoned_parent(ctx, &fixture, 1)?;
    let mut child = begin_import_job(ctx, fixture.organization_id, "account_move_line", None, 1);
    let parent_marker = crate::data_ops::import_tracker::account_move_bundle_job_metadata(
        completed_parent.metadata.as_deref(),
    )
    .ok_or("completed test parent marker missing")?;
    child = stamp_account_move_bundle_job(
        child,
        "complete",
        &parent_marker.token,
        Some(completed_parent.id),
    )?;
    finish_import_job(ctx, child, 1, 0);
    if cleanup_abandoned_account_move_import(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        completed_parent.id,
    )
    .is_ok()
        || ctx
            .db
            .account_move()
            .id()
            .find(&completed_moves[0])
            .is_none()
    {
        return Err("cleanup accepted a completed child bundle".to_string());
    }

    let (atomic_parent, atomic_moves) = seed_abandoned_parent(ctx, &fixture, 2)?;
    let second = ctx
        .db
        .account_move()
        .id()
        .find(&atomic_moves[1])
        .ok_or("atomic refusal move missing")?;
    ctx.db.account_move().id().update(AccountMove {
        state: AccountMoveState::Posted,
        posted_before: true,
        ..second
    });
    if cleanup_abandoned_account_move_import(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        atomic_parent.id,
    )
    .is_ok()
        || atomic_moves
            .iter()
            .any(|move_id| ctx.db.account_move().id().find(move_id).is_none())
    {
        return Err("cleanup did not atomically refuse an accounting-effective move".to_string());
    }

    let (nonempty_parent, nonempty_moves) = seed_abandoned_parent(ctx, &fixture, 1)?;
    let account_id = *fixture
        .chart_account_ids
        .values()
        .next()
        .ok_or("cleanup test account missing")?;
    add_account_move_line(
        ctx,
        fixture.organization_id,
        nonempty_moves[0],
        empty_line_params(account_id),
    )?;
    if cleanup_abandoned_account_move_import(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        nonempty_parent.id,
    )
    .is_ok()
        || ctx
            .db
            .account_move_line()
            .move_line_by_move()
            .filter(&nonempty_moves[0])
            .next()
            .is_none()
    {
        return Err("cleanup accepted or changed a non-empty draft".to_string());
    }

    Ok(())
}

/// Tax Management — AccountTax, AccountTaxGroup, TaxJurisdiction, TaxSchedule, TaxDeadline
///
/// # 7.3 Tax Management
///
/// Tables for managing taxes, tax groups, jurisdictions, tax schedules, and tax deadlines.
/// Includes a scheduled reducer for automatic deadline status updates.
use spacetimedb::{Identity, ReducerContext, ScheduleAt, Table, Timestamp};

use crate::accounting::chart_of_accounts::account_account;
use crate::helpers::{check_permission, write_audit_log};
use crate::types::{TaxAmountType, TaxDeadlineStatus, TaxDeadlineType, TaxTypeUse};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = account_tax,
    public,
    index(accessor = tax_by_company, btree(columns = [company_id])),
    index(accessor = tax_by_sequence, btree(columns = [sequence])),
    index(accessor = tax_by_country, btree(columns = [country_id]))
)]
pub struct AccountTax {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub description: Option<String>,
    pub type_tax_use: TaxTypeUse,
    pub amount_type: TaxAmountType,
    pub amount: f64,
    pub active: bool,
    pub price_include: bool,
    pub include_base_amount: bool,
    pub is_base_affected: bool,
    pub sequence: u32,
    pub company_id: u64,
    pub tax_group_id: Option<u64>,
    pub country_id: Option<u64>,
    pub country_code: Option<String>,
    pub tags: Vec<u64>,
    pub has_negative_factor: bool,
    pub invoice_repartition_line_ids: Vec<u64>,
    pub refund_repartition_line_ids: Vec<u64>,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = account_tax_group,
    public,
    index(accessor = tax_group_by_company, btree(columns = [company_id])),
    index(accessor = tax_group_by_sequence, btree(columns = [sequence]))
)]
pub struct AccountTaxGroup {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub sequence: u32,
    pub company_id: u64,
    pub preceding_subtotal: Option<String>,
    pub tax_payable_account_id: Option<u64>,
    pub tax_receivable_account_id: Option<u64>,
    pub advance_tax_payment_account_id: Option<u64>,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = tax_jurisdiction,
    public,
    index(accessor = jurisdiction_by_country, btree(columns = [country_code])),
    index(accessor = jurisdiction_by_state, btree(columns = [state_code]))
)]
pub struct TaxJurisdiction {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub code: String,
    pub country_code: String,
    pub state_code: Option<String>,
    pub county_code: Option<String>,
    pub city: Option<String>,
    pub zip_from: Option<String>,
    pub zip_to: Option<String>,
    pub is_active: bool,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = tax_schedule,
    public,
    index(accessor = schedule_by_jurisdiction, btree(columns = [jurisdiction_id])),
    index(accessor = schedule_by_company, btree(columns = [company_id]))
)]
pub struct TaxSchedule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub description: Option<String>,
    pub jurisdiction_id: Option<u64>,
    pub company_id: u64,
    pub tax_ids: Vec<u64>,
    pub is_active: bool,
    pub effective_from: Option<Timestamp>,
    pub effective_to: Option<Timestamp>,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn create_account_tax_group(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    sequence: u32,
    company_id: u64,
    preceding_subtotal: Option<String>,
    tax_payable_account_id: Option<u64>,
    tax_receivable_account_id: Option<u64>,
    advance_tax_payment_account_id: Option<u64>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_tax_group", "create")?;

    // Validate accounts if provided
    for maybe_id in [
        tax_payable_account_id,
        tax_receivable_account_id,
        advance_tax_payment_account_id,
    ] {
        if let Some(id) = maybe_id {
            ctx.db
                .account_account()
                .id()
                .find(&id)
                .ok_or("Referenced account not found")?;
        }
    }

    let group = ctx.db.account_tax_group().insert(AccountTaxGroup {
        id: 0,
        name: name.clone(),
        sequence,
        company_id,
        preceding_subtotal,
        tax_payable_account_id,
        tax_receivable_account_id,
        advance_tax_payment_account_id,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "account_tax_group",
        group.id,
        "CREATE",
        None,
        Some(serde_json::json!({ "name": name.clone(), "sequence": sequence.clone() }).to_string()),
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_account_tax_group(
    ctx: &ReducerContext,
    organization_id: u64,
    group_id: u64,
    name: Option<String>,
    sequence: Option<u32>,
    preceding_subtotal: Option<Option<String>>,
    tax_payable_account_id: Option<Option<u64>>,
    tax_receivable_account_id: Option<Option<u64>>,
    advance_tax_payment_account_id: Option<Option<u64>>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_tax_group", "write")?;

    let group = ctx
        .db
        .account_tax_group()
        .id()
        .find(&group_id)
        .ok_or("Tax group not found")?;

    // Validate accounts if provided
    for maybe_id in [
        tax_payable_account_id.flatten(),
        tax_receivable_account_id.flatten(),
        advance_tax_payment_account_id.flatten(),
    ] {
        if let Some(id) = maybe_id {
            ctx.db
                .account_account()
                .id()
                .find(&id)
                .ok_or("Referenced account not found")?;
        }
    }

    ctx.db.account_tax_group().id().update(AccountTaxGroup {
        name: name.unwrap_or(group.name),
        sequence: sequence.unwrap_or(group.sequence),
        preceding_subtotal: preceding_subtotal.unwrap_or(group.preceding_subtotal),
        tax_payable_account_id: tax_payable_account_id.unwrap_or(group.tax_payable_account_id),
        tax_receivable_account_id: tax_receivable_account_id
            .unwrap_or(group.tax_receivable_account_id),
        advance_tax_payment_account_id: advance_tax_payment_account_id
            .unwrap_or(group.advance_tax_payment_account_id),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: metadata.or(group.metadata),
        ..group
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(group.company_id),
        "account_tax_group",
        group_id,
        "UPDATE",
        None,
        None,
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_account_tax(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    description: Option<String>,
    type_tax_use: TaxTypeUse,
    amount_type: TaxAmountType,
    amount: f64,
    company_id: u64,
    price_include: bool,
    include_base_amount: bool,
    is_base_affected: bool,
    sequence: u32,
    tax_group_id: Option<u64>,
    country_id: Option<u64>,
    country_code: Option<String>,
    tags: Vec<u64>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_tax", "create")?;

    // Validate tax group if provided
    if let Some(gid) = tax_group_id {
        let group = ctx
            .db
            .account_tax_group()
            .id()
            .find(&gid)
            .ok_or("Tax group not found")?;
        if group.company_id != company_id {
            return Err("Tax group does not belong to the specified company".to_string());
        }
    }

    let tax = ctx.db.account_tax().insert(AccountTax {
        id: 0,
        name: name.clone(),
        description,
        type_tax_use,
        amount_type,
        amount,
        active: true,
        price_include,
        include_base_amount,
        is_base_affected,
        sequence,
        company_id,
        tax_group_id,
        country_id,
        country_code,
        tags,
        has_negative_factor: false,
        invoice_repartition_line_ids: Vec::new(),
        refund_repartition_line_ids: Vec::new(),
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "account_tax",
        tax.id,
        "CREATE",
        None,
        Some(serde_json::json!({ "name": name, "amount": amount }).to_string()),
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_account_tax(
    ctx: &ReducerContext,
    organization_id: u64,
    tax_id: u64,
    name: Option<String>,
    description: Option<Option<String>>,
    type_tax_use: Option<TaxTypeUse>,
    amount: Option<f64>,
    active: Option<bool>,
    price_include: Option<bool>,
    include_base_amount: Option<bool>,
    is_base_affected: Option<bool>,
    sequence: Option<u32>,
    tax_group_id: Option<Option<u64>>,
    tags: Option<Vec<u64>>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_tax", "write")?;

    let tax = ctx
        .db
        .account_tax()
        .id()
        .find(&tax_id)
        .ok_or("Tax not found")?;

    // Validate tax group if provided
    if let Some(Some(gid)) = tax_group_id {
        let group = ctx
            .db
            .account_tax_group()
            .id()
            .find(&gid)
            .ok_or("Tax group not found")?;
        if group.company_id != tax.company_id {
            return Err("Tax group does not belong to the same company".to_string());
        }
    }

    ctx.db.account_tax().id().update(AccountTax {
        name: name.unwrap_or(tax.name),
        description: description.unwrap_or(tax.description),
        type_tax_use: type_tax_use.unwrap_or(tax.type_tax_use),
        amount: amount.unwrap_or(tax.amount),
        active: active.unwrap_or(tax.active),
        price_include: price_include.unwrap_or(tax.price_include),
        include_base_amount: include_base_amount.unwrap_or(tax.include_base_amount),
        is_base_affected: is_base_affected.unwrap_or(tax.is_base_affected),
        sequence: sequence.unwrap_or(tax.sequence),
        tax_group_id: tax_group_id.unwrap_or(tax.tax_group_id),
        tags: tags.unwrap_or(tax.tags),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: metadata.or(tax.metadata),
        ..tax
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(tax.company_id),
        "account_tax",
        tax_id,
        "UPDATE",
        None,
        None,
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_tax_jurisdiction(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    code: String,
    country_code: String,
    state_code: Option<String>,
    county_code: Option<String>,
    city: Option<String>,
    zip_from: Option<String>,
    zip_to: Option<String>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "tax_jurisdiction", "create")?;

    let jurisdiction = ctx.db.tax_jurisdiction().insert(TaxJurisdiction {
        id: 0,
        name: name.clone(),
        code: code.clone(),
        country_code,
        state_code,
        county_code,
        city,
        zip_from,
        zip_to,
        is_active: true,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "tax_jurisdiction",
        jurisdiction.id,
        "CREATE",
        None,
        Some(serde_json::json!({ "name": name, "code": code }).to_string()),
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_tax_jurisdiction(
    ctx: &ReducerContext,
    organization_id: u64,
    jurisdiction_id: u64,
    name: Option<String>,
    code: Option<String>,
    state_code: Option<Option<String>>,
    county_code: Option<Option<String>>,
    city: Option<Option<String>>,
    zip_from: Option<Option<String>>,
    zip_to: Option<Option<String>>,
    is_active: Option<bool>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "tax_jurisdiction", "write")?;

    let jurisdiction = ctx
        .db
        .tax_jurisdiction()
        .id()
        .find(&jurisdiction_id)
        .ok_or("Jurisdiction not found")?;

    ctx.db.tax_jurisdiction().id().update(TaxJurisdiction {
        name: name.unwrap_or(jurisdiction.name),
        code: code.unwrap_or(jurisdiction.code),
        state_code: state_code.unwrap_or(jurisdiction.state_code),
        county_code: county_code.unwrap_or(jurisdiction.county_code),
        city: city.unwrap_or(jurisdiction.city),
        zip_from: zip_from.unwrap_or(jurisdiction.zip_from),
        zip_to: zip_to.unwrap_or(jurisdiction.zip_to),
        is_active: is_active.unwrap_or(jurisdiction.is_active),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: metadata.or(jurisdiction.metadata),
        ..jurisdiction
    });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "tax_jurisdiction",
        jurisdiction_id,
        "UPDATE",
        None,
        None,
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_tax_schedule(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    description: Option<String>,
    jurisdiction_id: Option<u64>,
    company_id: u64,
    tax_ids: Vec<u64>,
    effective_from: Option<Timestamp>,
    effective_to: Option<Timestamp>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "tax_schedule", "create")?;

    // Validate jurisdiction if provided
    if let Some(jid) = jurisdiction_id {
        ctx.db
            .tax_jurisdiction()
            .id()
            .find(&jid)
            .ok_or("Jurisdiction not found")?;
    }

    // Validate all taxes exist and belong to company
    for tax_id in &tax_ids {
        let tax = ctx
            .db
            .account_tax()
            .id()
            .find(tax_id)
            .ok_or(format!("Tax {} not found", tax_id))?;
        if tax.company_id != company_id {
            return Err(format!(
                "Tax {} does not belong to the specified company",
                tax_id
            ));
        }
    }

    let schedule = ctx.db.tax_schedule().insert(TaxSchedule {
        id: 0,
        name: name.clone(),
        description,
        jurisdiction_id,
        company_id,
        tax_ids: tax_ids.clone(),
        is_active: true,
        effective_from,
        effective_to,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "tax_schedule",
        schedule.id,
        "CREATE",
        None,
        Some(serde_json::json!({ "name": name, "tax_ids": tax_ids }).to_string()),
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_tax_schedule(
    ctx: &ReducerContext,
    organization_id: u64,
    schedule_id: u64,
    name: Option<String>,
    description: Option<Option<String>>,
    jurisdiction_id: Option<Option<u64>>,
    tax_ids: Option<Vec<u64>>,
    is_active: Option<bool>,
    effective_from: Option<Option<Timestamp>>,
    effective_to: Option<Option<Timestamp>>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "tax_schedule", "write")?;

    let schedule = ctx
        .db
        .tax_schedule()
        .id()
        .find(&schedule_id)
        .ok_or("Tax schedule not found")?;

    // Validate jurisdiction if provided
    if let Some(Some(jid)) = jurisdiction_id {
        ctx.db
            .tax_jurisdiction()
            .id()
            .find(&jid)
            .ok_or("Jurisdiction not found")?;
    }

    // Validate all taxes if provided
    if let Some(ref new_tax_ids) = tax_ids {
        for tax_id in new_tax_ids {
            let tax = ctx
                .db
                .account_tax()
                .id()
                .find(tax_id)
                .ok_or(format!("Tax {} not found", tax_id))?;
            if tax.company_id != schedule.company_id {
                return Err(format!(
                    "Tax {} does not belong to the same company",
                    tax_id
                ));
            }
        }
    }

    ctx.db.tax_schedule().id().update(TaxSchedule {
        name: name.unwrap_or(schedule.name),
        description: description.unwrap_or(schedule.description),
        jurisdiction_id: jurisdiction_id.unwrap_or(schedule.jurisdiction_id),
        tax_ids: tax_ids.unwrap_or(schedule.tax_ids),
        is_active: is_active.unwrap_or(schedule.is_active),
        effective_from: effective_from.unwrap_or(schedule.effective_from),
        effective_to: effective_to.unwrap_or(schedule.effective_to),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: metadata.or(schedule.metadata),
        ..schedule
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(schedule.company_id),
        "tax_schedule",
        schedule_id,
        "UPDATE",
        None,
        None,
        vec![],
    );

    Ok(())
}

// ── Tax Deadline Tables ──────────────────────────────────────────────────────

/// Tax Deadline — Tracks tax filing and payment deadlines
///
/// Supports automatic status transitions via scheduled reducer.
#[spacetimedb::table(
    accessor = tax_deadline,
    public,
    index(accessor = deadline_by_org, btree(columns = [organization_id])),
    index(accessor = deadline_by_company, btree(columns = [company_id])),
    index(accessor = deadline_by_status, btree(columns = [status])),
    index(accessor = deadline_by_due_date, btree(columns = [due_date]))
)]
pub struct TaxDeadline {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub tax_obligation_id: Option<u64>,
    pub deadline_type: TaxDeadlineType,
    pub title: String,
    pub description: Option<String>,
    pub due_date: Timestamp,
    pub fiscal_period_start: Option<Timestamp>,
    pub fiscal_period_end: Option<Timestamp>,
    pub status: TaxDeadlineStatus,
    pub completed_at: Option<Timestamp>,
    pub completed_by: Option<Identity>,
    pub reminder_days_before: Vec<u32>,
    pub auto_generated: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub created_by: Option<Identity>,
    pub updated_by: Option<Identity>,
    pub deleted_at: Option<Timestamp>,
}

/// Tax Deadline Reminder — Reminder notifications for tax deadlines
#[spacetimedb::table(
    accessor = tax_deadline_reminder,
    public,
    index(accessor = reminder_by_deadline, btree(columns = [tax_deadline_id])),
    index(accessor = reminder_by_status, btree(columns = [status]))
)]
pub struct TaxDeadlineReminder {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub tax_deadline_id: Option<u64>,
    pub user_id: Option<Identity>,
    pub reminder_date: Timestamp,
    pub days_before_deadline: u32,
    pub notification_type: Option<String>,
    pub status: String,
    pub sent_at: Option<Timestamp>,
    pub acknowledged_at: Option<Timestamp>,
    pub created_at: Timestamp,
}

/// Scheduled job for updating tax deadline statuses
///
/// This scheduled reducer runs daily to flip `upcoming → overdue` for deadlines
/// that have passed their due date.
#[spacetimedb::table(accessor = tax_deadline_status_job, scheduled(update_tax_deadlines))]
pub struct TaxDeadlineStatusJob {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
    pub organization_id: Option<u64>, // If None, processes all orgs
}

// ── Tax Deadline Reducers ────────────────────────────────────────────────────

/// Scheduled reducer: Updates tax deadline statuses automatically
///
/// This reducer is called by the SpacetimeDB scheduler. It:
/// 1. Finds all deadlines with status "upcoming" that are past due
/// 2. Updates them to "overdue"
/// 3. Reschedules itself for the next day
#[spacetimedb::reducer]
pub fn update_tax_deadlines(ctx: &ReducerContext, job: TaxDeadlineStatusJob) {
    log::info!("Running scheduled tax deadline status update");

    let now = ctx.timestamp;
    let mut updated_count: u64 = 0;

    // Update deadlines based on organization filter
    let deadlines_to_update: Vec<TaxDeadline> = if let Some(org_id) = job.organization_id {
        ctx.db
            .tax_deadline()
            .deadline_by_org()
            .filter(&org_id)
            .filter(|d| {
                d.status == TaxDeadlineStatus::Upcoming
                    && d.due_date < now
                    && d.deleted_at.is_none()
            })
            .collect()
    } else {
        // Process all organizations
        ctx.db
            .tax_deadline()
            .iter()
            .filter(|d| {
                d.status == TaxDeadlineStatus::Upcoming
                    && d.due_date < now
                    && d.deleted_at.is_none()
            })
            .collect()
    };

    for deadline in deadlines_to_update {
        ctx.db.tax_deadline().id().update(TaxDeadline {
            status: TaxDeadlineStatus::Overdue,
            updated_at: now,
            updated_by: None, // System update
            ..deadline
        });
        updated_count += 1;
    }

    // Also update "due_soon" status for deadlines within 7 days
    let due_soon_threshold = now + std::time::Duration::from_secs(7 * 24 * 60 * 60);
    let mut due_soon_count: u64 = 0;

    let deadlines_for_due_soon: Vec<TaxDeadline> = if let Some(org_id) = job.organization_id {
        ctx.db
            .tax_deadline()
            .deadline_by_org()
            .filter(&org_id)
            .filter(|d| {
                d.status == TaxDeadlineStatus::Upcoming
                    && d.due_date <= due_soon_threshold
                    && d.due_date > now
                    && d.deleted_at.is_none()
            })
            .collect()
    } else {
        ctx.db
            .tax_deadline()
            .iter()
            .filter(|d| {
                d.status == TaxDeadlineStatus::Upcoming
                    && d.due_date <= due_soon_threshold
                    && d.due_date > now
                    && d.deleted_at.is_none()
            })
            .collect()
    };

    for deadline in deadlines_for_due_soon {
        ctx.db.tax_deadline().id().update(TaxDeadline {
            status: TaxDeadlineStatus::DueSoon,
            updated_at: now,
            updated_by: None,
            ..deadline
        });
        due_soon_count += 1;
    }

    log::info!(
        "Tax deadline update complete: {} overdue, {} due_soon",
        updated_count,
        due_soon_count
    );

    // Reschedule for next day (24 hours)
    let next_run = now + std::time::Duration::from_secs(24 * 60 * 60);
    ctx.db
        .tax_deadline_status_job()
        .insert(TaxDeadlineStatusJob {
            scheduled_id: 0, // Auto-increment
            scheduled_at: ScheduleAt::Time(next_run),
            organization_id: job.organization_id,
        });
}

/// Manually trigger tax deadline status update for an organization
///
/// This allows administrators to immediately update deadline statuses
/// without waiting for the scheduled job.
#[spacetimedb::reducer]
pub fn refresh_tax_deadline_statuses(
    ctx: &ReducerContext,
    organization_id: u64,
) -> Result<(), String> {
    // Permission check
    check_permission(ctx, organization_id, "tax_deadline", "write")?;

    let now = ctx.timestamp;
    let mut updated_count: u64 = 0;

    // Update overdue deadlines
    let deadlines_to_update: Vec<TaxDeadline> = ctx
        .db
        .tax_deadline()
        .deadline_by_org()
        .filter(&organization_id)
        .filter(|d| {
            d.status == TaxDeadlineStatus::Upcoming && d.due_date < now && d.deleted_at.is_none()
        })
        .collect();

    for deadline in deadlines_to_update {
        ctx.db.tax_deadline().id().update(TaxDeadline {
            status: TaxDeadlineStatus::Overdue,
            updated_at: now,
            updated_by: Some(ctx.sender()),
            ..deadline
        });
        updated_count += 1;
    }

    // Update due_soon deadlines (within 7 days)
    let due_soon_threshold = now + std::time::Duration::from_secs(7 * 24 * 60 * 60);
    let mut due_soon_count: u64 = 0;

    let deadlines_for_due_soon: Vec<TaxDeadline> = ctx
        .db
        .tax_deadline()
        .deadline_by_org()
        .filter(&organization_id)
        .filter(|d| {
            d.status == TaxDeadlineStatus::Upcoming
                && d.due_date <= due_soon_threshold
                && d.due_date > now
                && d.deleted_at.is_none()
        })
        .collect();

    for deadline in deadlines_for_due_soon {
        ctx.db.tax_deadline().id().update(TaxDeadline {
            status: TaxDeadlineStatus::DueSoon,
            updated_at: now,
            updated_by: Some(ctx.sender()),
            ..deadline
        });
        due_soon_count += 1;
    }

    // Audit log
    write_audit_log(
        ctx,
        organization_id,
        None,
        "tax_deadline",
        0,
        "REFRESH_STATUSES",
        None,
        Some(format!(
            "{{ \"overdue_updated\": {}, \"due_soon_updated\": {} }}",
            updated_count, due_soon_count
        )),
        vec!["status".to_string()],
    );

    Ok(())
}

/// Schedule the tax deadline status update job
///
/// Call this reducer to start the daily scheduled updates.
/// If a job already exists, it will be replaced.
#[spacetimedb::reducer]
pub fn schedule_tax_deadline_updates(
    ctx: &ReducerContext,
    organization_id: Option<u64>,
) -> Result<(), String> {
    // Permission check - only admins can schedule system jobs
    if let Some(org_id) = organization_id {
        check_permission(ctx, org_id, "tax_deadline", "admin")?;
    }

    // Schedule the first run for 1 minute from now
    let first_run = ctx.timestamp + std::time::Duration::from_secs(60);

    ctx.db
        .tax_deadline_status_job()
        .insert(TaxDeadlineStatusJob {
            scheduled_id: 0,
            scheduled_at: ScheduleAt::Time(first_run),
            organization_id,
        });

    log::info!("Scheduled tax deadline status updates");
    Ok(())
}

/// Create a new tax deadline
#[spacetimedb::reducer]
pub fn create_tax_deadline(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    tax_obligation_id: Option<u64>,
    deadline_type: TaxDeadlineType,
    title: String,
    description: Option<String>,
    due_date: Timestamp,
    fiscal_period_start: Option<Timestamp>,
    fiscal_period_end: Option<Timestamp>,
    reminder_days_before: Vec<u32>,
) -> Result<(), String> {
    // Permission check
    check_permission(ctx, organization_id, "tax_deadline", "create")?;

    // Validate title
    if title.trim().is_empty() {
        return Err("Title cannot be empty".to_string());
    }

    // Determine initial status based on due date
    let now = ctx.timestamp;
    let status = if due_date < now {
        TaxDeadlineStatus::Overdue
    } else {
        let due_soon_threshold = now + std::time::Duration::from_secs(7 * 24 * 60 * 60);
        if due_date <= due_soon_threshold {
            TaxDeadlineStatus::DueSoon
        } else {
            TaxDeadlineStatus::Upcoming
        }
    };

    let row = ctx.db.tax_deadline().insert(TaxDeadline {
        id: 0,
        organization_id,
        company_id,
        tax_obligation_id,
        deadline_type,
        title: title.clone(),
        description,
        due_date,
        fiscal_period_start,
        fiscal_period_end,
        status,
        completed_at: None,
        completed_by: None,
        reminder_days_before,
        auto_generated: false,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        created_by: Some(ctx.sender()),
        updated_by: Some(ctx.sender()),
        deleted_at: None,
    });

    // Audit log
    write_audit_log(
        ctx,
        organization_id,
        company_id,
        "tax_deadline",
        row.id,
        "CREATE",
        None,
        Some(format!("{{ \"title\": \"{}\" }}", title)),
        vec![],
    );

    Ok(())
}

/// Update an existing tax deadline
#[spacetimedb::reducer]
pub fn update_tax_deadline(
    ctx: &ReducerContext,
    deadline_id: u64,
    title: Option<String>,
    description: Option<String>,
    due_date: Option<Timestamp>,
    fiscal_period_start: Option<Timestamp>,
    fiscal_period_end: Option<Timestamp>,
    reminder_days_before: Option<Vec<u32>>,
) -> Result<(), String> {
    let deadline = ctx
        .db
        .tax_deadline()
        .id()
        .find(&deadline_id)
        .ok_or("Tax deadline not found")?;

    // Permission check
    check_permission(ctx, deadline.organization_id, "tax_deadline", "write")?;

    // Check soft delete
    if deadline.deleted_at.is_some() {
        return Err("Cannot update a deleted tax deadline".to_string());
    }

    // Build updated deadline
    let new_title = title.unwrap_or(deadline.title);
    if new_title.trim().is_empty() {
        return Err("Title cannot be empty".to_string());
    }

    let new_due_date = due_date.unwrap_or(deadline.due_date);
    let now = ctx.timestamp;

    // Recalculate status if due_date changed
    let new_status = if deadline.status == TaxDeadlineStatus::Completed
        || deadline.status == TaxDeadlineStatus::Waived
    {
        deadline.status.clone()
    } else if new_due_date < now {
        TaxDeadlineStatus::Overdue
    } else {
        let due_soon_threshold = now + std::time::Duration::from_secs(7 * 24 * 60 * 60);
        if new_due_date <= due_soon_threshold {
            TaxDeadlineStatus::DueSoon
        } else {
            TaxDeadlineStatus::Upcoming
        }
    };

    ctx.db.tax_deadline().id().update(TaxDeadline {
        title: new_title,
        description: description.or(deadline.description),
        due_date: new_due_date,
        fiscal_period_start: fiscal_period_start.or(deadline.fiscal_period_start),
        fiscal_period_end: fiscal_period_end.or(deadline.fiscal_period_end),
        reminder_days_before: reminder_days_before.unwrap_or(deadline.reminder_days_before),
        status: new_status,
        updated_at: now,
        updated_by: Some(ctx.sender()),
        ..deadline
    });

    // Audit log
    write_audit_log(
        ctx,
        deadline.organization_id,
        deadline.company_id,
        "tax_deadline",
        deadline_id,
        "UPDATE",
        None,
        None,
        vec![
            "title".to_string(),
            "due_date".to_string(),
            "status".to_string(),
        ],
    );

    Ok(())
}

/// Mark a tax deadline as completed
#[spacetimedb::reducer]
pub fn complete_tax_deadline(ctx: &ReducerContext, deadline_id: u64) -> Result<(), String> {
    let deadline = ctx
        .db
        .tax_deadline()
        .id()
        .find(&deadline_id)
        .ok_or("Tax deadline not found")?;

    // Permission check
    check_permission(ctx, deadline.organization_id, "tax_deadline", "write")?;

    // Check soft delete
    if deadline.deleted_at.is_some() {
        return Err("Cannot complete a deleted tax deadline".to_string());
    }

    // Check if already completed
    if deadline.status == TaxDeadlineStatus::Completed {
        return Err("Tax deadline is already completed".to_string());
    }

    ctx.db.tax_deadline().id().update(TaxDeadline {
        status: TaxDeadlineStatus::Completed,
        completed_at: Some(ctx.timestamp),
        completed_by: Some(ctx.sender()),
        updated_at: ctx.timestamp,
        updated_by: Some(ctx.sender()),
        ..deadline
    });

    // Audit log
    write_audit_log(
        ctx,
        deadline.organization_id,
        deadline.company_id,
        "tax_deadline",
        deadline_id,
        "COMPLETE",
        None,
        None,
        vec!["status".to_string()],
    );

    Ok(())
}

/// Waive a tax deadline (mark as not applicable)
#[spacetimedb::reducer]
pub fn waive_tax_deadline(ctx: &ReducerContext, deadline_id: u64) -> Result<(), String> {
    let deadline = ctx
        .db
        .tax_deadline()
        .id()
        .find(&deadline_id)
        .ok_or("Tax deadline not found")?;

    // Permission check - requires admin
    check_permission(ctx, deadline.organization_id, "tax_deadline", "admin")?;

    // Check soft delete
    if deadline.deleted_at.is_some() {
        return Err("Cannot waive a deleted tax deadline".to_string());
    }

    ctx.db.tax_deadline().id().update(TaxDeadline {
        status: TaxDeadlineStatus::Waived,
        updated_at: ctx.timestamp,
        updated_by: Some(ctx.sender()),
        ..deadline
    });

    // Audit log
    write_audit_log(
        ctx,
        deadline.organization_id,
        deadline.company_id,
        "tax_deadline",
        deadline_id,
        "WAIVE",
        None,
        None,
        vec!["status".to_string()],
    );

    Ok(())
}

/// Soft delete a tax deadline
#[spacetimedb::reducer]
pub fn delete_tax_deadline(ctx: &ReducerContext, deadline_id: u64) -> Result<(), String> {
    let deadline = ctx
        .db
        .tax_deadline()
        .id()
        .find(&deadline_id)
        .ok_or("Tax deadline not found")?;

    // Permission check
    check_permission(ctx, deadline.organization_id, "tax_deadline", "delete")?;

    // Already deleted
    if deadline.deleted_at.is_some() {
        return Ok(());
    }

    ctx.db.tax_deadline().id().update(TaxDeadline {
        deleted_at: Some(ctx.timestamp),
        updated_at: ctx.timestamp,
        updated_by: Some(ctx.sender()),
        ..deadline
    });

    // Audit log
    write_audit_log(
        ctx,
        deadline.organization_id,
        deadline.company_id,
        "tax_deadline",
        deadline_id,
        "DELETE",
        None,
        None,
        vec![],
    );

    Ok(())
}

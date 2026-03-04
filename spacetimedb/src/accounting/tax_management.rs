/// Tax Management — AccountTax, AccountTaxGroup, TaxJurisdiction, TaxSchedule, TaxDeadline
///
/// # 7.3 Tax Management
///
/// Tables for managing taxes, tax groups, jurisdictions, tax schedules, and tax deadlines.
/// Includes a scheduled reducer for automatic deadline status updates.
use spacetimedb::{Identity, ReducerContext, ScheduleAt, SpacetimeType, Table, Timestamp};

use crate::accounting::chart_of_accounts::account_account;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::{TaxAmountType, TaxDeadlineStatus, TaxDeadlineType, TaxTypeUse};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = account_tax,
    public,
    index(accessor = tax_by_company, btree(columns = [company_id])),
    index(accessor = tax_by_sequence, btree(columns = [sequence])),
    index(accessor = tax_by_country, btree(columns = [country_id]))
)]
#[derive(Clone)]
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
#[derive(Clone)]
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
#[derive(Clone)]
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
#[derive(Clone)]
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
#[derive(Clone)]
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

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAccountTaxGroupParams {
    pub name: String,
    pub sequence: u32,
    pub preceding_subtotal: Option<String>,
    pub tax_payable_account_id: Option<u64>,
    pub tax_receivable_account_id: Option<u64>,
    pub advance_tax_payment_account_id: Option<u64>,
    pub metadata: Option<String>,
}

/// `None` outer = no change; `Some(None)` = clear nullable field.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateAccountTaxGroupParams {
    pub name: Option<String>,
    pub sequence: Option<u32>,
    pub preceding_subtotal: Option<Option<String>>,
    pub tax_payable_account_id: Option<Option<u64>>,
    pub tax_receivable_account_id: Option<Option<u64>>,
    pub advance_tax_payment_account_id: Option<Option<u64>>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAccountTaxParams {
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
    pub tax_group_id: Option<u64>,
    pub country_id: Option<u64>,
    pub country_code: Option<String>,
    pub tags: Vec<u64>,
    pub has_negative_factor: bool,
    pub invoice_repartition_line_ids: Vec<u64>,
    pub refund_repartition_line_ids: Vec<u64>,
    pub metadata: Option<String>,
}

/// `None` outer = no change; `Some(None)` = clear nullable field.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateAccountTaxParams {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub type_tax_use: Option<TaxTypeUse>,
    pub amount: Option<f64>,
    pub active: Option<bool>,
    pub price_include: Option<bool>,
    pub include_base_amount: Option<bool>,
    pub is_base_affected: Option<bool>,
    pub sequence: Option<u32>,
    pub tax_group_id: Option<Option<u64>>,
    pub tags: Option<Vec<u64>>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateTaxJurisdictionParams {
    pub name: String,
    pub code: String,
    pub country_code: String,
    pub state_code: Option<String>,
    pub county_code: Option<String>,
    pub city: Option<String>,
    pub zip_from: Option<String>,
    pub zip_to: Option<String>,
    pub is_active: bool,
    pub metadata: Option<String>,
}

/// `None` outer = no change; `Some(None)` = clear nullable field.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateTaxJurisdictionParams {
    pub name: Option<String>,
    pub code: Option<String>,
    pub state_code: Option<Option<String>>,
    pub county_code: Option<Option<String>>,
    pub city: Option<Option<String>>,
    pub zip_from: Option<Option<String>>,
    pub zip_to: Option<Option<String>>,
    pub is_active: Option<bool>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateTaxScheduleParams {
    pub name: String,
    pub description: Option<String>,
    pub jurisdiction_id: Option<u64>,
    pub tax_ids: Vec<u64>,
    pub is_active: bool,
    pub effective_from: Option<Timestamp>,
    pub effective_to: Option<Timestamp>,
    pub metadata: Option<String>,
}

/// `None` outer = no change; `Some(None)` = clear nullable field.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateTaxScheduleParams {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub jurisdiction_id: Option<Option<u64>>,
    pub tax_ids: Option<Vec<u64>>,
    pub is_active: Option<bool>,
    pub effective_from: Option<Option<Timestamp>>,
    pub effective_to: Option<Option<Timestamp>>,
    pub metadata: Option<String>,
}

/// `company_id` is `Option<u64>` in params because not all tax deadlines are
/// scoped to a specific company. `status`, `completed_at/by`, `deleted_at` are
/// system-managed and initialized by the reducer.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateTaxDeadlineParams {
    pub company_id: Option<u64>,
    pub tax_obligation_id: Option<u64>,
    pub deadline_type: TaxDeadlineType,
    pub title: String,
    pub description: Option<String>,
    pub due_date: Timestamp,
    pub fiscal_period_start: Option<Timestamp>,
    pub fiscal_period_end: Option<Timestamp>,
    pub reminder_days_before: Vec<u32>,
    pub auto_generated: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateTaxDeadlineParams {
    pub title: Option<String>,
    pub description: Option<String>,
    pub due_date: Option<Timestamp>,
    pub fiscal_period_start: Option<Timestamp>,
    pub fiscal_period_end: Option<Timestamp>,
    pub reminder_days_before: Option<Vec<u32>>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn create_account_tax_group(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateAccountTaxGroupParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_tax_group", "create")?;

    // Validate accounts if provided
    for maybe_id in [
        params.tax_payable_account_id,
        params.tax_receivable_account_id,
        params.advance_tax_payment_account_id,
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
        name: params.name.clone(),
        sequence: params.sequence,
        company_id,
        preceding_subtotal: params.preceding_subtotal,
        tax_payable_account_id: params.tax_payable_account_id,
        tax_receivable_account_id: params.tax_receivable_account_id,
        advance_tax_payment_account_id: params.advance_tax_payment_account_id,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_tax_group",
            record_id: group.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "name": params.name, "sequence": params.sequence })
                    .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "sequence".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_account_tax_group(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    group_id: u64,
    params: UpdateAccountTaxGroupParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_tax_group", "write")?;

    let group = ctx
        .db
        .account_tax_group()
        .id()
        .find(&group_id)
        .ok_or("Tax group not found")?;

    if group.company_id != company_id {
        return Err("Tax group does not belong to this company".to_string());
    }

    // Validate accounts if provided
    for maybe_id in [
        params.tax_payable_account_id.flatten(),
        params.tax_receivable_account_id.flatten(),
        params.advance_tax_payment_account_id.flatten(),
    ] {
        if let Some(id) = maybe_id {
            ctx.db
                .account_account()
                .id()
                .find(&id)
                .ok_or("Referenced account not found")?;
        }
    }

    let old_values =
        serde_json::json!({ "name": group.name, "sequence": group.sequence }).to_string();

    let mut changed_fields = Vec::new();
    if params.name.is_some() {
        changed_fields.push("name".to_string());
    }
    if params.sequence.is_some() {
        changed_fields.push("sequence".to_string());
    }
    if params.preceding_subtotal.is_some() {
        changed_fields.push("preceding_subtotal".to_string());
    }
    if params.tax_payable_account_id.is_some() {
        changed_fields.push("tax_payable_account_id".to_string());
    }
    if params.tax_receivable_account_id.is_some() {
        changed_fields.push("tax_receivable_account_id".to_string());
    }
    if params.advance_tax_payment_account_id.is_some() {
        changed_fields.push("advance_tax_payment_account_id".to_string());
    }

    ctx.db.account_tax_group().id().update(AccountTaxGroup {
        name: params.name.unwrap_or(group.name),
        sequence: params.sequence.unwrap_or(group.sequence),
        preceding_subtotal: params.preceding_subtotal.unwrap_or(group.preceding_subtotal),
        tax_payable_account_id: params
            .tax_payable_account_id
            .unwrap_or(group.tax_payable_account_id),
        tax_receivable_account_id: params
            .tax_receivable_account_id
            .unwrap_or(group.tax_receivable_account_id),
        advance_tax_payment_account_id: params
            .advance_tax_payment_account_id
            .unwrap_or(group.advance_tax_payment_account_id),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata.map(Some).unwrap_or(group.metadata),
        ..group
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_tax_group",
            record_id: group_id,
            action: "UPDATE",
            old_values: Some(old_values),
            new_values: None,
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_account_tax(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateAccountTaxParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_tax", "create")?;

    // Validate tax group if provided
    if let Some(gid) = params.tax_group_id {
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
        name: params.name.clone(),
        description: params.description,
        type_tax_use: params.type_tax_use,
        amount_type: params.amount_type,
        amount: params.amount,
        active: params.active,
        price_include: params.price_include,
        include_base_amount: params.include_base_amount,
        is_base_affected: params.is_base_affected,
        sequence: params.sequence,
        company_id,
        tax_group_id: params.tax_group_id,
        country_id: params.country_id,
        country_code: params.country_code,
        tags: params.tags,
        has_negative_factor: params.has_negative_factor,
        invoice_repartition_line_ids: params.invoice_repartition_line_ids,
        refund_repartition_line_ids: params.refund_repartition_line_ids,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_tax",
            record_id: tax.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "name": params.name, "amount": params.amount }).to_string(),
            ),
            changed_fields: vec!["name".to_string(), "amount".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_account_tax(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    tax_id: u64,
    params: UpdateAccountTaxParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_tax", "write")?;

    let tax = ctx
        .db
        .account_tax()
        .id()
        .find(&tax_id)
        .ok_or("Tax not found")?;

    if tax.company_id != company_id {
        return Err("Tax does not belong to this company".to_string());
    }

    // Validate tax group if provided
    if let Some(Some(gid)) = params.tax_group_id {
        let group = ctx
            .db
            .account_tax_group()
            .id()
            .find(&gid)
            .ok_or("Tax group not found")?;
        if group.company_id != company_id {
            return Err("Tax group does not belong to the same company".to_string());
        }
    }

    let old_values =
        serde_json::json!({ "name": tax.name, "amount": tax.amount, "active": tax.active })
            .to_string();

    let mut changed_fields = Vec::new();
    if params.name.is_some() {
        changed_fields.push("name".to_string());
    }
    if params.description.is_some() {
        changed_fields.push("description".to_string());
    }
    if params.type_tax_use.is_some() {
        changed_fields.push("type_tax_use".to_string());
    }
    if params.amount.is_some() {
        changed_fields.push("amount".to_string());
    }
    if params.active.is_some() {
        changed_fields.push("active".to_string());
    }
    if params.price_include.is_some() {
        changed_fields.push("price_include".to_string());
    }
    if params.include_base_amount.is_some() {
        changed_fields.push("include_base_amount".to_string());
    }
    if params.is_base_affected.is_some() {
        changed_fields.push("is_base_affected".to_string());
    }
    if params.sequence.is_some() {
        changed_fields.push("sequence".to_string());
    }
    if params.tax_group_id.is_some() {
        changed_fields.push("tax_group_id".to_string());
    }
    if params.tags.is_some() {
        changed_fields.push("tags".to_string());
    }

    ctx.db.account_tax().id().update(AccountTax {
        name: params.name.unwrap_or(tax.name),
        description: params.description.unwrap_or(tax.description),
        type_tax_use: params.type_tax_use.unwrap_or(tax.type_tax_use),
        amount: params.amount.unwrap_or(tax.amount),
        active: params.active.unwrap_or(tax.active),
        price_include: params.price_include.unwrap_or(tax.price_include),
        include_base_amount: params.include_base_amount.unwrap_or(tax.include_base_amount),
        is_base_affected: params.is_base_affected.unwrap_or(tax.is_base_affected),
        sequence: params.sequence.unwrap_or(tax.sequence),
        tax_group_id: params.tax_group_id.unwrap_or(tax.tax_group_id),
        tags: params.tags.unwrap_or(tax.tags),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata.map(Some).unwrap_or(tax.metadata),
        ..tax
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_tax",
            record_id: tax_id,
            action: "UPDATE",
            old_values: Some(old_values),
            new_values: None,
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_tax_jurisdiction(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateTaxJurisdictionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "tax_jurisdiction", "create")?;

    let jurisdiction = ctx.db.tax_jurisdiction().insert(TaxJurisdiction {
        id: 0,
        name: params.name.clone(),
        code: params.code.clone(),
        country_code: params.country_code,
        state_code: params.state_code,
        county_code: params.county_code,
        city: params.city,
        zip_from: params.zip_from,
        zip_to: params.zip_to,
        is_active: params.is_active,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "tax_jurisdiction",
            record_id: jurisdiction.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "name": params.name, "code": params.code }).to_string(),
            ),
            changed_fields: vec!["name".to_string(), "code".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_tax_jurisdiction(
    ctx: &ReducerContext,
    organization_id: u64,
    jurisdiction_id: u64,
    params: UpdateTaxJurisdictionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "tax_jurisdiction", "write")?;

    let jurisdiction = ctx
        .db
        .tax_jurisdiction()
        .id()
        .find(&jurisdiction_id)
        .ok_or("Jurisdiction not found")?;

    let old_values =
        serde_json::json!({ "name": jurisdiction.name, "code": jurisdiction.code }).to_string();

    let mut changed_fields = Vec::new();
    if params.name.is_some() {
        changed_fields.push("name".to_string());
    }
    if params.code.is_some() {
        changed_fields.push("code".to_string());
    }
    if params.state_code.is_some() {
        changed_fields.push("state_code".to_string());
    }
    if params.county_code.is_some() {
        changed_fields.push("county_code".to_string());
    }
    if params.city.is_some() {
        changed_fields.push("city".to_string());
    }
    if params.zip_from.is_some() {
        changed_fields.push("zip_from".to_string());
    }
    if params.zip_to.is_some() {
        changed_fields.push("zip_to".to_string());
    }
    if params.is_active.is_some() {
        changed_fields.push("is_active".to_string());
    }

    ctx.db.tax_jurisdiction().id().update(TaxJurisdiction {
        name: params.name.unwrap_or(jurisdiction.name),
        code: params.code.unwrap_or(jurisdiction.code),
        state_code: params.state_code.unwrap_or(jurisdiction.state_code),
        county_code: params.county_code.unwrap_or(jurisdiction.county_code),
        city: params.city.unwrap_or(jurisdiction.city),
        zip_from: params.zip_from.unwrap_or(jurisdiction.zip_from),
        zip_to: params.zip_to.unwrap_or(jurisdiction.zip_to),
        is_active: params.is_active.unwrap_or(jurisdiction.is_active),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata.map(Some).unwrap_or(jurisdiction.metadata),
        ..jurisdiction
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "tax_jurisdiction",
            record_id: jurisdiction_id,
            action: "UPDATE",
            old_values: Some(old_values),
            new_values: None,
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_tax_schedule(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateTaxScheduleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "tax_schedule", "create")?;

    // Validate jurisdiction if provided
    if let Some(jid) = params.jurisdiction_id {
        ctx.db
            .tax_jurisdiction()
            .id()
            .find(&jid)
            .ok_or("Jurisdiction not found")?;
    }

    // Validate all taxes exist and belong to company
    for tax_id in &params.tax_ids {
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
        name: params.name.clone(),
        description: params.description,
        jurisdiction_id: params.jurisdiction_id,
        company_id,
        tax_ids: params.tax_ids.clone(),
        is_active: params.is_active,
        effective_from: params.effective_from,
        effective_to: params.effective_to,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "tax_schedule",
            record_id: schedule.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "name": params.name, "tax_ids": params.tax_ids }).to_string(),
            ),
            changed_fields: vec!["name".to_string(), "tax_ids".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_tax_schedule(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    schedule_id: u64,
    params: UpdateTaxScheduleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "tax_schedule", "write")?;

    let schedule = ctx
        .db
        .tax_schedule()
        .id()
        .find(&schedule_id)
        .ok_or("Tax schedule not found")?;

    if schedule.company_id != company_id {
        return Err("Tax schedule does not belong to this company".to_string());
    }

    // Validate jurisdiction if provided
    if let Some(Some(jid)) = params.jurisdiction_id {
        ctx.db
            .tax_jurisdiction()
            .id()
            .find(&jid)
            .ok_or("Jurisdiction not found")?;
    }

    // Validate all taxes if provided
    if let Some(ref new_tax_ids) = params.tax_ids {
        for tax_id in new_tax_ids {
            let tax = ctx
                .db
                .account_tax()
                .id()
                .find(tax_id)
                .ok_or(format!("Tax {} not found", tax_id))?;
            if tax.company_id != company_id {
                return Err(format!(
                    "Tax {} does not belong to the same company",
                    tax_id
                ));
            }
        }
    }

    let old_values =
        serde_json::json!({ "name": schedule.name, "is_active": schedule.is_active }).to_string();

    let mut changed_fields = Vec::new();
    if params.name.is_some() {
        changed_fields.push("name".to_string());
    }
    if params.description.is_some() {
        changed_fields.push("description".to_string());
    }
    if params.jurisdiction_id.is_some() {
        changed_fields.push("jurisdiction_id".to_string());
    }
    if params.tax_ids.is_some() {
        changed_fields.push("tax_ids".to_string());
    }
    if params.is_active.is_some() {
        changed_fields.push("is_active".to_string());
    }
    if params.effective_from.is_some() {
        changed_fields.push("effective_from".to_string());
    }
    if params.effective_to.is_some() {
        changed_fields.push("effective_to".to_string());
    }

    ctx.db.tax_schedule().id().update(TaxSchedule {
        name: params.name.unwrap_or(schedule.name),
        description: params.description.unwrap_or(schedule.description),
        jurisdiction_id: params.jurisdiction_id.unwrap_or(schedule.jurisdiction_id),
        tax_ids: params.tax_ids.unwrap_or(schedule.tax_ids),
        is_active: params.is_active.unwrap_or(schedule.is_active),
        effective_from: params.effective_from.unwrap_or(schedule.effective_from),
        effective_to: params.effective_to.unwrap_or(schedule.effective_to),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata.map(Some).unwrap_or(schedule.metadata),
        ..schedule
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "tax_schedule",
            record_id: schedule_id,
            action: "UPDATE",
            old_values: Some(old_values),
            new_values: None,
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
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

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "tax_deadline",
            record_id: 0,
            action: "REFRESH_STATUSES",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "overdue_updated": updated_count,
                    "due_soon_updated": due_soon_count,
                })
                .to_string(),
            ),
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
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
    params: CreateTaxDeadlineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "tax_deadline", "create")?;

    if params.title.trim().is_empty() {
        return Err("Title cannot be empty".to_string());
    }

    // Derive initial status from due date
    let now = ctx.timestamp;
    let status = if params.due_date < now {
        TaxDeadlineStatus::Overdue
    } else {
        let due_soon_threshold = now + std::time::Duration::from_secs(7 * 24 * 60 * 60);
        if params.due_date <= due_soon_threshold {
            TaxDeadlineStatus::DueSoon
        } else {
            TaxDeadlineStatus::Upcoming
        }
    };

    let row = ctx.db.tax_deadline().insert(TaxDeadline {
        id: 0,
        organization_id,
        company_id: params.company_id,
        tax_obligation_id: params.tax_obligation_id,
        deadline_type: params.deadline_type,
        title: params.title.clone(),
        description: params.description,
        due_date: params.due_date,
        fiscal_period_start: params.fiscal_period_start,
        fiscal_period_end: params.fiscal_period_end,
        // Derived from due_date
        status,
        // System-managed: set when completed via complete_tax_deadline
        completed_at: None,
        completed_by: None,
        reminder_days_before: params.reminder_days_before,
        auto_generated: params.auto_generated,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        created_by: Some(ctx.sender()),
        updated_by: Some(ctx.sender()),
        // System-managed: set via delete_tax_deadline
        deleted_at: None,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: params.company_id,
            table_name: "tax_deadline",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "title": params.title }).to_string()),
            changed_fields: vec!["title".to_string(), "due_date".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Update an existing tax deadline
#[spacetimedb::reducer]
pub fn update_tax_deadline(
    ctx: &ReducerContext,
    organization_id: u64,
    deadline_id: u64,
    params: UpdateTaxDeadlineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "tax_deadline", "write")?;

    let deadline = ctx
        .db
        .tax_deadline()
        .id()
        .find(&deadline_id)
        .ok_or("Tax deadline not found")?;

    if deadline.organization_id != organization_id {
        return Err("Tax deadline does not belong to this organization".to_string());
    }

    if deadline.deleted_at.is_some() {
        return Err("Cannot update a deleted tax deadline".to_string());
    }

    // Capture old values before any moves
    let old_title = deadline.title.clone();
    let old_due_date_str = deadline.due_date.to_string();
    let old_status_str = format!("{:?}", deadline.status);

    let new_title = params.title.unwrap_or(deadline.title.clone());
    if new_title.trim().is_empty() {
        return Err("Title cannot be empty".to_string());
    }

    let new_due_date = params.due_date.unwrap_or(deadline.due_date);
    let now = ctx.timestamp;

    // Recalculate status if due_date changed and not in terminal state
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

    let old_values = serde_json::json!({
        "title": old_title,
        "due_date": old_due_date_str,
        "status": old_status_str,
    })
    .to_string();

    ctx.db.tax_deadline().id().update(TaxDeadline {
        title: new_title,
        description: params.description.or(deadline.description),
        due_date: new_due_date,
        fiscal_period_start: params.fiscal_period_start.or(deadline.fiscal_period_start),
        fiscal_period_end: params.fiscal_period_end.or(deadline.fiscal_period_end),
        reminder_days_before: params
            .reminder_days_before
            .unwrap_or(deadline.reminder_days_before),
        status: new_status,
        updated_at: now,
        updated_by: Some(ctx.sender()),
        ..deadline
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: deadline.company_id,
            table_name: "tax_deadline",
            record_id: deadline_id,
            action: "UPDATE",
            old_values: Some(old_values),
            new_values: None,
            changed_fields: vec![
                "title".to_string(),
                "due_date".to_string(),
                "status".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

/// Mark a tax deadline as completed
#[spacetimedb::reducer]
pub fn complete_tax_deadline(
    ctx: &ReducerContext,
    organization_id: u64,
    deadline_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "tax_deadline", "write")?;

    let deadline = ctx
        .db
        .tax_deadline()
        .id()
        .find(&deadline_id)
        .ok_or("Tax deadline not found")?;

    if deadline.organization_id != organization_id {
        return Err("Tax deadline does not belong to this organization".to_string());
    }

    if deadline.deleted_at.is_some() {
        return Err("Cannot complete a deleted tax deadline".to_string());
    }

    if deadline.status == TaxDeadlineStatus::Completed {
        return Err("Tax deadline is already completed".to_string());
    }

    let old_state = format!("{:?}", deadline.status);

    ctx.db.tax_deadline().id().update(TaxDeadline {
        status: TaxDeadlineStatus::Completed,
        completed_at: Some(ctx.timestamp),
        completed_by: Some(ctx.sender()),
        updated_at: ctx.timestamp,
        updated_by: Some(ctx.sender()),
        ..deadline
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: deadline.company_id,
            table_name: "tax_deadline",
            record_id: deadline_id,
            action: "COMPLETE",
            old_values: Some(serde_json::json!({ "status": old_state }).to_string()),
            new_values: Some(serde_json::json!({ "status": "Completed" }).to_string()),
            changed_fields: vec!["status".to_string(), "completed_at".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Waive a tax deadline (mark as not applicable)
#[spacetimedb::reducer]
pub fn waive_tax_deadline(
    ctx: &ReducerContext,
    organization_id: u64,
    deadline_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "tax_deadline", "admin")?;

    let deadline = ctx
        .db
        .tax_deadline()
        .id()
        .find(&deadline_id)
        .ok_or("Tax deadline not found")?;

    if deadline.organization_id != organization_id {
        return Err("Tax deadline does not belong to this organization".to_string());
    }

    if deadline.deleted_at.is_some() {
        return Err("Cannot waive a deleted tax deadline".to_string());
    }

    let old_state = format!("{:?}", deadline.status);

    ctx.db.tax_deadline().id().update(TaxDeadline {
        status: TaxDeadlineStatus::Waived,
        updated_at: ctx.timestamp,
        updated_by: Some(ctx.sender()),
        ..deadline
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: deadline.company_id,
            table_name: "tax_deadline",
            record_id: deadline_id,
            action: "WAIVE",
            old_values: Some(serde_json::json!({ "status": old_state }).to_string()),
            new_values: Some(serde_json::json!({ "status": "Waived" }).to_string()),
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Soft delete a tax deadline
#[spacetimedb::reducer]
pub fn delete_tax_deadline(
    ctx: &ReducerContext,
    organization_id: u64,
    deadline_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "tax_deadline", "delete")?;

    let deadline = ctx
        .db
        .tax_deadline()
        .id()
        .find(&deadline_id)
        .ok_or("Tax deadline not found")?;

    if deadline.organization_id != organization_id {
        return Err("Tax deadline does not belong to this organization".to_string());
    }

    // Already deleted — idempotent
    if deadline.deleted_at.is_some() {
        return Ok(());
    }

    let old_title = deadline.title.clone();
    let deadline_company_id = deadline.company_id;

    ctx.db.tax_deadline().id().update(TaxDeadline {
        deleted_at: Some(ctx.timestamp),
        updated_at: ctx.timestamp,
        updated_by: Some(ctx.sender()),
        ..deadline
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: deadline_company_id,
            table_name: "tax_deadline",
            record_id: deadline_id,
            action: "DELETE",
            old_values: Some(serde_json::json!({ "title": old_title }).to_string()),
            new_values: None,
            changed_fields: vec!["deleted_at".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

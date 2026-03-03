/// Tax Management — AccountTax, AccountTaxGroup, TaxJurisdiction, TaxSchedule
///
/// # 7.3 Tax Management
///
/// Tables for managing taxes, tax groups, jurisdictions, and tax schedules.
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::accounting::chart_of_accounts::account_account;
use crate::helpers::{check_permission, write_audit_log};
use crate::types::{TaxAmountType, TaxTypeUse};

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

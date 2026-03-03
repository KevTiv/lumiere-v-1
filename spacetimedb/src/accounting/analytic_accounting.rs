/// Analytic Accounting — AccountAnalyticAccount, AccountAnalyticLine, AccountAnalyticDistributionModel
///
/// # 8.3 Analytic Accounting
///
/// Tables for managing analytic accounts, analytic lines, and distribution models.
/// Supports project-based accounting, cost center tracking, and multi-dimensional
/// analysis of financial data.
///
/// ## Tables
/// - `AccountAnalyticAccount` — Analytic accounts for cost tracking
/// - `AccountAnalyticLine` — Analytic entries (timesheets, costs, revenues)
/// - `AccountAnalyticDistributionModel` — Auto-distribution rules for analytic accounts
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = account_analytic_account,
    public,
    index(accessor = analytic_account_by_code, btree(columns = [company_id, code])),
    index(accessor = analytic_account_by_company, btree(columns = [company_id])),
    index(accessor = analytic_account_by_partner, btree(columns = [partner_id])),
    index(accessor = analytic_account_by_plan, btree(columns = [plan_id]))
)]
#[derive(Clone)]
pub struct AccountAnalyticAccount {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub code: Option<String>,
    pub active: bool,
    pub company_id: u64,
    pub partner_id: Option<u64>,
    pub group_id: Option<u64>,
    pub line_ids: Vec<u64>,
    pub balance: f64,
    pub debit: f64,
    pub credit: f64,
    pub currency_id: u64,
    pub root_plan_id: Option<u64>,
    pub plan_id: Option<u64>,
    pub root_id: Option<u64>,
    pub is_required_in_move_lines: bool,
    pub is_required_in_distribution: bool,
    pub color: Option<u8>,
    pub parent_id: Option<u64>,
    pub child_ids: Vec<u64>,
    pub message_follower_ids: Vec<u64>,
    pub activity_ids: Vec<u64>,
    pub message_ids: Vec<u64>,
    pub is_company_root: bool,
    pub is_root_plan: bool,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = account_analytic_line,
    public,
    index(accessor = analytic_line_by_account, btree(columns = [account_id])),
    index(accessor = analytic_line_by_date, btree(columns = [date])),
    index(accessor = analytic_line_by_company, btree(columns = [company_id])),
    index(accessor = analytic_line_by_partner, btree(columns = [partner_id]))
)]
#[derive(Clone)]
pub struct AccountAnalyticLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub description: Option<String>,
    pub amount: f64,
    pub unit_amount: f64, // Amount in company currency
    pub product_id: Option<u64>,
    pub product_uom_id: Option<u64>,
    pub account_id: u64,
    pub partner_id: Option<u64>,
    pub user_id: Option<Identity>,
    pub company_id: u64,
    pub currency_id: u64,
    pub general_account_id: Option<u64>,
    pub move_id: Option<u64>,
    pub move_line_id: Option<u64>,
    pub payment_id: Option<u64>,
    pub category: Option<String>,
    pub date: Timestamp,
    pub tag_ids: Vec<u64>,
    pub project_id: Option<u64>,
    pub task_id: Option<u64>,
    pub employee_id: Option<u64>,
    pub timesheet_invoice_id: Option<u64>,
    pub timesheet_invoice_type: Option<String>,
    pub sheet_id: Option<u64>,
    pub is_timesheet: bool,
    pub r#ref: Option<String>,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = account_analytic_distribution_model,
    public,
    index(accessor = analytic_dist_by_partner_category, btree(columns = [partner_category_id])),
    index(accessor = analytic_dist_by_product, btree(columns = [product_id])),
    index(accessor = analytic_dist_by_product_categ, btree(columns = [product_categ_id]))
)]
#[derive(Clone)]
pub struct AccountAnalyticDistributionModel {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: Option<String>,
    pub partner_category_id: Option<u64>,
    pub product_id: Option<u64>,
    pub product_categ_id: Option<u64>,
    pub company_id: u64,
    pub analytic_distribution: String, // JSON: [{"account_id": u64, "percentage": f64}, ...]
    pub analytic_precision: u8,        // Decimal places for percentage
    pub is_active: bool,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Create a new analytic account
#[spacetimedb::reducer]
pub fn create_analytic_account(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    name: String,
    code: Option<String>,
    currency_id: u64,
    partner_id: Option<u64>,
    plan_id: Option<u64>,
    group_id: Option<u64>,
    parent_id: Option<u64>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_analytic_account", "create")?;

    if name.is_empty() {
        return Err("Analytic account name is required".to_string());
    }

    let account = ctx
        .db
        .account_analytic_account()
        .insert(AccountAnalyticAccount {
            id: 0,
            name: name.clone(),
            code,
            active: true,
            company_id,
            partner_id,
            group_id,
            line_ids: Vec::new(),
            balance: 0.0,
            debit: 0.0,
            credit: 0.0,
            currency_id,
            root_plan_id: plan_id,
            plan_id,
            root_id: None,
            is_required_in_move_lines: false,
            is_required_in_distribution: false,
            color: None,
            parent_id,
            child_ids: Vec::new(),
            message_follower_ids: Vec::new(),
            activity_ids: Vec::new(),
            message_ids: Vec::new(),
            is_company_root: parent_id.is_none(),
            is_root_plan: false,
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata,
        });

    // Update parent's child_ids if parent exists
    if let Some(pid) = parent_id {
        if let Some(mut parent) = ctx.db.account_analytic_account().id().find(&pid) {
            parent.child_ids.push(account.id);
            parent.write_uid = Some(ctx.sender());
            parent.write_date = Some(ctx.timestamp);
            ctx.db.account_analytic_account().id().update(parent);
        }
    }

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "account_analytic_account",
        account.id,
        "CREATE",
        None,
        Some(serde_json::json!({ "name": name }).to_string()),
        vec!["name".to_string()],
    );

    Ok(())
}

/// Update an analytic account
#[spacetimedb::reducer]
pub fn update_analytic_account(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    account_id: u64,
    name: Option<String>,
    code: Option<String>,
    partner_id: Option<u64>,
    plan_id: Option<u64>,
    group_id: Option<u64>,
    color: Option<u8>,
    is_required_in_move_lines: Option<bool>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_analytic_account", "write")?;

    let mut account = ctx
        .db
        .account_analytic_account()
        .id()
        .find(&account_id)
        .ok_or("Analytic account not found")?;

    if account.company_id != company_id {
        return Err("Analytic account does not belong to this company".to_string());
    }

    let old_values = serde_json::json!({
        "name": account.name,
        "code": account.code
    });

    let mut changed_fields = Vec::new();

    if let Some(n) = name {
        if n.is_empty() {
            return Err("Analytic account name cannot be empty".to_string());
        }
        account.name = n;
        changed_fields.push("name".to_string());
    }

    if code.is_some() {
        account.code = code;
        changed_fields.push("code".to_string());
    }

    if partner_id.is_some() {
        account.partner_id = partner_id;
        changed_fields.push("partner_id".to_string());
    }

    if plan_id.is_some() {
        account.plan_id = plan_id;
        account.root_plan_id = plan_id;
        changed_fields.push("plan_id".to_string());
    }

    if group_id.is_some() {
        account.group_id = group_id;
        changed_fields.push("group_id".to_string());
    }

    if let Some(c) = color {
        account.color = Some(c);
        changed_fields.push("color".to_string());
    }

    if let Some(req) = is_required_in_move_lines {
        account.is_required_in_move_lines = req;
        changed_fields.push("is_required_in_move_lines".to_string());
    }

    if let Some(m) = metadata {
        account.metadata = Some(m);
        changed_fields.push("metadata".to_string());
    }

    account.write_uid = Some(ctx.sender());
    account.write_date = Some(ctx.timestamp);

    ctx.db
        .account_analytic_account()
        .id()
        .update(account.clone());

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "account_analytic_account",
        account_id,
        "UPDATE",
        Some(old_values.to_string()),
        Some(serde_json::json!({ "name": account.name }).to_string()),
        changed_fields,
    );

    Ok(())
}

/// Create an analytic line (entry)
#[spacetimedb::reducer]
pub fn create_analytic_line(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    name: String,
    account_id: u64,
    amount: f64,
    unit_amount: f64,
    currency_id: u64,
    date: Timestamp,
    partner_id: Option<u64>,
    product_id: Option<u64>,
    product_uom_id: Option<u64>,
    general_account_id: Option<u64>,
    project_id: Option<u64>,
    task_id: Option<u64>,
    employee_id: Option<u64>,
    is_timesheet: bool,
    category: Option<String>,
    tag_ids: Vec<u64>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_analytic_line", "create")?;

    if name.is_empty() {
        return Err("Analytic line name is required".to_string());
    }

    // Verify account exists
    let account = ctx
        .db
        .account_analytic_account()
        .id()
        .find(&account_id)
        .ok_or("Analytic account not found")?;

    if account.company_id != company_id {
        return Err("Analytic account does not belong to this company".to_string());
    }

    let line = ctx.db.account_analytic_line().insert(AccountAnalyticLine {
        id: 0,
        name: name.clone(),
        description: None,
        amount,
        unit_amount,
        product_id,
        product_uom_id,
        account_id,
        partner_id,
        user_id: Some(ctx.sender()),
        company_id,
        currency_id,
        general_account_id,
        move_id: None,
        move_line_id: None,
        payment_id: None,
        category,
        date,
        tag_ids,
        project_id,
        task_id,
        employee_id,
        timesheet_invoice_id: None,
        timesheet_invoice_type: None,
        sheet_id: None,
        is_timesheet,
        r#ref: None,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata,
    });

    // Update account balance
    let mut account = account;
    account.line_ids.push(line.id);
    if amount > 0.0 {
        account.debit += amount;
    } else {
        account.credit += amount.abs();
    }
    account.balance = account.debit - account.credit;
    account.write_uid = Some(ctx.sender());
    account.write_date = Some(ctx.timestamp);

    ctx.db.account_analytic_account().id().update(account);

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "account_analytic_line",
        line.id,
        "CREATE",
        None,
        Some(
            serde_json::json!({ "name": name, "account_id": account_id, "amount": amount })
                .to_string(),
        ),
        vec![
            "name".to_string(),
            "account_id".to_string(),
            "amount".to_string(),
        ],
    );

    Ok(())
}

/// Update an analytic line
#[spacetimedb::reducer]
pub fn update_analytic_line(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    line_id: u64,
    name: Option<String>,
    amount: Option<f64>,
    unit_amount: Option<f64>,
    partner_id: Option<u64>,
    project_id: Option<u64>,
    task_id: Option<u64>,
    category: Option<String>,
    tag_ids: Option<Vec<u64>>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_analytic_line", "write")?;

    let mut line = ctx
        .db
        .account_analytic_line()
        .id()
        .find(&line_id)
        .ok_or("Analytic line not found")?;

    if line.company_id != company_id {
        return Err("Analytic line does not belong to this company".to_string());
    }

    let old_amount = line.amount;

    let mut changed_fields = Vec::new();

    if let Some(n) = name {
        if n.is_empty() {
            return Err("Analytic line name cannot be empty".to_string());
        }
        line.name = n;
        changed_fields.push("name".to_string());
    }

    if let Some(a) = amount {
        line.amount = a;
        changed_fields.push("amount".to_string());
    }

    if let Some(ua) = unit_amount {
        line.unit_amount = ua;
        changed_fields.push("unit_amount".to_string());
    }

    if partner_id.is_some() {
        line.partner_id = partner_id;
        changed_fields.push("partner_id".to_string());
    }

    if project_id.is_some() {
        line.project_id = project_id;
        changed_fields.push("project_id".to_string());
    }

    if task_id.is_some() {
        line.task_id = task_id;
        changed_fields.push("task_id".to_string());
    }

    if category.is_some() {
        line.category = category;
        changed_fields.push("category".to_string());
    }

    if let Some(tags) = tag_ids {
        line.tag_ids = tags;
        changed_fields.push("tag_ids".to_string());
    }

    if let Some(m) = metadata {
        line.metadata = Some(m);
        changed_fields.push("metadata".to_string());
    }

    line.write_uid = Some(ctx.sender());
    line.write_date = Some(ctx.timestamp);

    ctx.db.account_analytic_line().id().update(line.clone());

    // Update account balance if amount changed
    if let Some(new_amount) = amount {
        let mut account = ctx
            .db
            .account_analytic_account()
            .id()
            .find(&line.account_id)
            .ok_or("Analytic account not found")?;

        // Reverse old amount
        if old_amount > 0.0 {
            account.debit -= old_amount;
        } else {
            account.credit -= old_amount.abs();
        }

        // Apply new amount
        if new_amount > 0.0 {
            account.debit += new_amount;
        } else {
            account.credit += new_amount.abs();
        }

        account.balance = account.debit - account.credit;
        account.write_uid = Some(ctx.sender());
        account.write_date = Some(ctx.timestamp);

        ctx.db.account_analytic_account().id().update(account);
    }

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "account_analytic_line",
        line_id,
        "UPDATE",
        Some(serde_json::json!({ "amount": old_amount }).to_string()),
        Some(serde_json::json!({ "name": line.name }).to_string()),
        changed_fields,
    );

    Ok(())
}

/// Delete an analytic line
#[spacetimedb::reducer]
pub fn delete_analytic_line(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    line_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_analytic_line", "delete")?;

    let line = ctx
        .db
        .account_analytic_line()
        .id()
        .find(&line_id)
        .ok_or("Analytic line not found")?;

    if line.company_id != company_id {
        return Err("Analytic line does not belong to this company".to_string());
    }

    // Update account balance
    let mut account = ctx
        .db
        .account_analytic_account()
        .id()
        .find(&line.account_id)
        .ok_or("Analytic account not found")?;

    // Reverse the line's effect on balance
    if line.amount > 0.0 {
        account.debit -= line.amount;
    } else {
        account.credit -= line.amount.abs();
    }
    account.balance = account.debit - account.credit;

    // Remove line from account's line_ids
    account.line_ids.retain(|&id| id != line_id);
    account.write_uid = Some(ctx.sender());
    account.write_date = Some(ctx.timestamp);

    ctx.db.account_analytic_account().id().update(account);
    ctx.db.account_analytic_line().id().delete(&line_id);

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "account_analytic_line",
        line_id,
        "DELETE",
        Some(serde_json::json!({ "amount": line.amount }).to_string()),
        None,
        vec!["id".to_string()],
    );

    Ok(())
}

/// Create an analytic distribution model
#[spacetimedb::reducer]
pub fn create_analytic_distribution_model(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    name: Option<String>,
    partner_category_id: Option<u64>,
    product_id: Option<u64>,
    product_categ_id: Option<u64>,
    analytic_distribution: String,
    analytic_precision: u8,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(
        ctx,
        organization_id,
        "account_analytic_distribution_model",
        "create",
    )?;

    // Validate distribution JSON
    let parsed: Vec<serde_json::Value> = serde_json::from_str(&analytic_distribution)
        .map_err(|e| format!("Invalid analytic distribution JSON: {}", e))?;

    let mut total_percentage = 0.0f64;
    for item in &parsed {
        let percentage = item
            .get("percentage")
            .and_then(|p| p.as_f64())
            .ok_or("Each distribution item must have a percentage")?;
        if percentage < 0.0 || percentage > 100.0 {
            return Err("Percentage must be between 0 and 100".to_string());
        }
        total_percentage += percentage;
    }

    // Allow some floating point tolerance
    if (total_percentage - 100.0).abs() > 0.01 {
        return Err(format!(
            "Total percentage must equal 100%, got {}",
            total_percentage
        ));
    }

    let model =
        ctx.db
            .account_analytic_distribution_model()
            .insert(AccountAnalyticDistributionModel {
                id: 0,
                name: name.clone(),
                partner_category_id,
                product_id,
                product_categ_id,
                company_id,
                analytic_distribution,
                analytic_precision,
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
        Some(company_id),
        "account_analytic_distribution_model",
        model.id,
        "CREATE",
        None,
        Some(
            serde_json::json!({ "name": name, "analytic_precision": analytic_precision })
                .to_string(),
        ),
        vec!["name".to_string()],
    );

    Ok(())
}

/// Update an analytic distribution model
#[spacetimedb::reducer]
pub fn update_analytic_distribution_model(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    model_id: u64,
    name: Option<String>,
    partner_category_id: Option<u64>,
    product_id: Option<u64>,
    product_categ_id: Option<u64>,
    analytic_distribution: Option<String>,
    analytic_precision: Option<u8>,
    is_active: Option<bool>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(
        ctx,
        organization_id,
        "account_analytic_distribution_model",
        "write",
    )?;

    let mut model = ctx
        .db
        .account_analytic_distribution_model()
        .id()
        .find(&model_id)
        .ok_or("Distribution model not found")?;

    if model.company_id != company_id {
        return Err("Distribution model does not belong to this company".to_string());
    }

    let mut changed_fields = Vec::new();

    if name.is_some() {
        model.name = name;
        changed_fields.push("name".to_string());
    }

    if partner_category_id.is_some() {
        model.partner_category_id = partner_category_id;
        changed_fields.push("partner_category_id".to_string());
    }

    if product_id.is_some() {
        model.product_id = product_id;
        changed_fields.push("product_id".to_string());
    }

    if product_categ_id.is_some() {
        model.product_categ_id = product_categ_id;
        changed_fields.push("product_categ_id".to_string());
    }

    if let Some(dist) = analytic_distribution {
        // Validate distribution JSON
        let parsed: Vec<serde_json::Value> = serde_json::from_str(&dist)
            .map_err(|e| format!("Invalid analytic distribution JSON: {}", e))?;

        let mut total_percentage = 0.0f64;
        for item in &parsed {
            let percentage = item
                .get("percentage")
                .and_then(|p| p.as_f64())
                .ok_or("Each distribution item must have a percentage")?;
            if percentage < 0.0 || percentage > 100.0 {
                return Err("Percentage must be between 0 and 100".to_string());
            }
            total_percentage += percentage;
        }

        if (total_percentage - 100.0).abs() > 0.01 {
            return Err(format!(
                "Total percentage must equal 100%, got {}",
                total_percentage
            ));
        }

        model.analytic_distribution = dist;
        changed_fields.push("analytic_distribution".to_string());
    }

    if let Some(prec) = analytic_precision {
        model.analytic_precision = prec;
        changed_fields.push("analytic_precision".to_string());
    }

    if let Some(active) = is_active {
        model.is_active = active;
        changed_fields.push("is_active".to_string());
    }

    if let Some(m) = metadata {
        model.metadata = Some(m);
        changed_fields.push("metadata".to_string());
    }

    model.write_uid = Some(ctx.sender());
    model.write_date = Some(ctx.timestamp);

    ctx.db
        .account_analytic_distribution_model()
        .id()
        .update(model.clone());

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "account_analytic_distribution_model",
        model_id,
        "UPDATE",
        None,
        Some(serde_json::json!({ "name": model.name }).to_string()),
        changed_fields,
    );

    Ok(())
}

/// Set analytic account active/inactive
#[spacetimedb::reducer]
pub fn set_analytic_account_active(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    account_id: u64,
    active: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_analytic_account", "write")?;

    let mut account = ctx
        .db
        .account_analytic_account()
        .id()
        .find(&account_id)
        .ok_or("Analytic account not found")?;

    if account.company_id != company_id {
        return Err("Analytic account does not belong to this company".to_string());
    }

    account.active = active;
    account.write_uid = Some(ctx.sender());
    account.write_date = Some(ctx.timestamp);

    ctx.db
        .account_analytic_account()
        .id()
        .update(account.clone());

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "account_analytic_account",
        account_id,
        "SET_ACTIVE",
        None,
        Some(serde_json::json!({ "active": active }).to_string()),
        vec!["active".to_string()],
    );

    Ok(())
}

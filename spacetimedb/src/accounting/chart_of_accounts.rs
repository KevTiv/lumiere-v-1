/// Chart of Accounts — AccountAccount, AccountAccountType, AccountGroup, AccountJournal
///
/// # 7.1 Chart of Accounts
///
/// Tables for managing the chart of accounts, account types, groups, and journals.
use std::collections::HashSet;

use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::relations::{
    require_active_account, require_active_currency_id, require_active_journal,
    require_explicit_company_id,
};
use crate::accounting::tax_management::account_tax;
use crate::crm::activities::activity_type;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::{AccountInternalGroup, AccountTypeInternal, JournalType};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = account_account,
    public,
    index(accessor = account_account_by_org, btree(columns = [organization_id])),
    index(accessor = account_by_code, btree(columns = [company_id, code])),
    index(accessor = account_by_company, btree(columns = [company_id])),
    index(accessor = account_by_type, btree(columns = [user_type_id]))
)]
pub struct AccountAccount {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// Tenant isolation — always required
    pub organization_id: u64,
    pub code: String,
    pub name: String,
    pub deprecated: bool,
    pub used: bool,
    pub user_type_id: u64,
    pub company_id: u64,
    pub currency_id: Option<u64>,
    pub internal_type: Option<AccountTypeInternal>,
    pub internal_group: Option<AccountInternalGroup>,
    pub is_off_balance: bool,
    pub last_time_entries_checked: Option<Timestamp>,
    pub group_id: Option<u64>,
    pub root_id: Option<u64>,
    pub allowed_journal_ids: Vec<u64>,
    pub non_trade: bool,
    pub is_bank_account: bool,
    pub reconcile: bool,
    pub tax_ids: Vec<u64>,
    pub note: Option<String>,
    pub opening_debit: f64,
    pub opening_credit: f64,
    pub opening_balance: f64,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = account_account_type,
    public,
    index(accessor = account_account_type_by_org, btree(columns = [organization_id])),
    index(accessor = account_type_by_company, btree(columns = [company_id]))
)]
pub struct AccountAccountType {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// Tenant isolation — always required
    pub organization_id: u64,
    pub name: String,
    pub type_: String, // receivable, payable, liquidity, asset, etc.
    pub internal_group: AccountInternalGroup,
    pub include_initial_balance: bool,
    pub is_deprecated: bool,
    pub company_id: Option<u64>,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = account_group,
    public,
    index(accessor = account_group_by_org, btree(columns = [organization_id])),
    index(accessor = account_group_by_company, btree(columns = [company_id])),
    index(accessor = account_group_by_parent, btree(columns = [parent_id]))
)]
pub struct AccountGroup {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// Tenant isolation — always required
    pub organization_id: u64,
    pub name: String,
    pub code_prefix_start: Option<String>,
    pub code_prefix_end: Option<String>,
    pub level: u32,
    pub parent_id: Option<u64>,
    pub company_id: u64,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = account_journal,
    public,
    index(accessor = account_journal_by_org, btree(columns = [organization_id])),
    index(accessor = journal_by_code, btree(columns = [company_id, code])),
    index(accessor = journal_by_company, btree(columns = [company_id])),
    index(accessor = journal_by_type, btree(columns = [type_]))
)]
pub struct AccountJournal {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// Tenant isolation — always required
    pub organization_id: u64,
    pub name: String,
    pub code: String,
    pub active: bool,
    pub type_: JournalType,
    pub company_id: u64,
    pub currency_id: Option<u64>,
    pub default_account_id: Option<u64>,
    pub suspense_account_id: Option<u64>,
    pub loss_account_id: Option<u64>,
    pub profit_account_id: Option<u64>,
    pub bank_account_id: Option<u64>,
    pub invoice_reference_type: Option<String>,
    pub invoice_reference_model: Option<String>,
    pub payment_credit_account_id: Option<u64>,
    pub payment_debit_account_id: Option<u64>,
    pub sequence_id: Option<u64>,
    pub refund_sequence_id: Option<u64>,
    pub sequence_override_regex: Option<String>,
    pub secure_sequence_id: Option<u64>,
    pub alias_name: Option<String>,
    pub alias_domain: Option<String>,
    pub at_least_one_inbound: bool,
    pub at_least_one_outbound: bool,
    pub dedicated_payment_method_ids: Vec<u64>,
    pub sale_activity_type_id: Option<u64>,
    pub sale_activity_user_id: Option<u64>,
    pub sale_activity_note: Option<String>,
    pub sale_activity_date_deadline: Option<Timestamp>,
    pub sale_activity_done: bool,
    pub restrict_mode_hash_table: bool,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAccountAccountTypeParams {
    pub name: String,
    pub type_: String,
    pub internal_group: AccountInternalGroup,
    pub include_initial_balance: bool,
    pub company_id: Option<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateAccountAccountTypeParams {
    /// When set, must match the account type’s company; when omitted, default company for the org is used.
    pub company_id: Option<u64>,
    pub name: Option<String>,
    pub type_: Option<String>,
    pub internal_group: Option<AccountInternalGroup>,
    pub include_initial_balance: Option<bool>,
    pub is_deprecated: Option<bool>,
    pub metadata: Option<Option<String>>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAccountGroupParams {
    pub name: String,
    pub code_prefix_start: Option<String>,
    pub code_prefix_end: Option<String>,
    pub level: u32,
    pub parent_id: Option<u64>,
    /// Legal entity within the org; default when omitted.
    pub company_id: Option<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateAccountGroupParams {
    /// Company scope for the update (must match the group’s company).
    pub company_id: Option<u64>,
    pub name: Option<String>,
    pub code_prefix_start: Option<Option<String>>,
    pub code_prefix_end: Option<Option<String>>,
    pub level: Option<u32>,
    pub parent_id: Option<Option<u64>>,
    pub metadata: Option<Option<String>>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAccountAccountParams {
    /// Legal entity; default company for the org when omitted.
    pub company_id: Option<u64>,
    pub code: String,
    pub name: String,
    pub user_type_id: u64,
    pub currency_id: Option<u64>,
    pub internal_type: Option<AccountTypeInternal>,
    pub internal_group: Option<AccountInternalGroup>,
    pub group_id: Option<u64>,
    pub reconcile: bool,
    pub tax_ids: Vec<u64>,
    pub note: Option<String>,
    pub opening_debit: f64,
    pub opening_credit: f64,
    pub allowed_journal_ids: Vec<u64>,
    pub non_trade: bool,
    pub is_off_balance: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateAccountAccountParams {
    /// Company scope (must match the account’s company).
    pub company_id: Option<u64>,
    pub name: Option<String>,
    pub code: Option<String>,
    pub deprecated: Option<bool>,
    pub currency_id: Option<Option<u64>>,
    pub internal_type: Option<AccountTypeInternal>,
    pub internal_group: Option<AccountInternalGroup>,
    pub group_id: Option<Option<u64>>,
    pub reconcile: Option<bool>,
    pub tax_ids: Option<Vec<u64>>,
    pub note: Option<Option<String>>,
    pub allowed_journal_ids: Option<Vec<u64>>,
    pub non_trade: Option<bool>,
    pub metadata: Option<Option<String>>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAccountJournalParams {
    /// Legal entity; default company when omitted.
    pub company_id: Option<u64>,
    pub name: String,
    pub code: String,
    pub type_: JournalType,
    pub currency_id: Option<u64>,
    pub default_account_id: Option<u64>,
    pub suspense_account_id: Option<u64>,
    pub loss_account_id: Option<u64>,
    pub profit_account_id: Option<u64>,
    pub bank_account_id: Option<u64>,
    pub payment_credit_account_id: Option<u64>,
    pub payment_debit_account_id: Option<u64>,
    pub invoice_reference_type: Option<String>,
    pub invoice_reference_model: Option<String>,
    pub sequence_id: Option<u64>,
    pub refund_sequence_id: Option<u64>,
    pub sequence_override_regex: Option<String>,
    pub secure_sequence_id: Option<u64>,
    pub alias_name: Option<String>,
    pub alias_domain: Option<String>,
    pub sale_activity_type_id: Option<u64>,
    pub sale_activity_user_id: Option<u64>,
    pub sale_activity_note: Option<String>,
    pub sale_activity_date_deadline: Option<Timestamp>,
    pub restrict_mode_hash_table: bool,
    pub active: bool,
    pub at_least_one_inbound: bool,
    pub at_least_one_outbound: bool,
    pub dedicated_payment_method_ids: Vec<u64>,
    pub sale_activity_done: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateAccountJournalParams {
    pub company_id: Option<u64>,
    pub name: Option<String>,
    pub code: Option<String>,
    pub active: Option<bool>,
    pub currency_id: Option<Option<u64>>,
    pub default_account_id: Option<Option<u64>>,
    pub suspense_account_id: Option<Option<u64>>,
    pub loss_account_id: Option<Option<u64>>,
    pub profit_account_id: Option<Option<u64>>,
    pub bank_account_id: Option<Option<u64>>,
    pub payment_credit_account_id: Option<Option<u64>>,
    pub payment_debit_account_id: Option<Option<u64>>,
    pub alias_name: Option<Option<String>>,
    pub alias_domain: Option<Option<String>>,
    pub restrict_mode_hash_table: Option<bool>,
    pub metadata: Option<Option<String>>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct DeprecateAccountAccountParams {
    pub company_id: Option<u64>,
    pub deprecated: bool,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn create_account_account_type(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateAccountAccountTypeParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_account_type", "create")?;

    let company_id = Some(require_explicit_company_id(
        ctx,
        organization_id,
        params.company_id,
        "account-type creation",
    )?);

    let account_type = ctx.db.account_account_type().insert(AccountAccountType {
        id: 0,
        organization_id,
        name: params.name.clone(),
        type_: params.type_.clone(),
        internal_group: params.internal_group,
        include_initial_balance: params.include_initial_balance,
        is_deprecated: false,
        company_id,
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
            company_id,
            table_name: "account_account_type",
            record_id: account_type.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "name": params.name, "type_": params.type_ }).to_string(),
            ),
            changed_fields: vec!["name".to_string(), "type_".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_account_account_type(
    ctx: &ReducerContext,
    organization_id: u64,
    type_id: u64,
    params: UpdateAccountAccountTypeParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_account_type", "write")?;

    let scope_company = require_explicit_company_id(
        ctx,
        organization_id,
        params.company_id,
        "account-type update",
    )?;

    let account_type = ctx
        .db
        .account_account_type()
        .id()
        .find(&type_id)
        .ok_or("Account type not found")?;

    if let Some(cid) = account_type.company_id {
        if cid != scope_company {
            return Err("Account type does not belong to this company".to_string());
        }
    }

    ctx.db
        .account_account_type()
        .id()
        .update(AccountAccountType {
            name: params.name.unwrap_or(account_type.name),
            type_: params.type_.unwrap_or(account_type.type_),
            internal_group: params.internal_group.unwrap_or(account_type.internal_group),
            include_initial_balance: params
                .include_initial_balance
                .unwrap_or(account_type.include_initial_balance),
            is_deprecated: params.is_deprecated.unwrap_or(account_type.is_deprecated),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: params.metadata.unwrap_or(account_type.metadata),
            ..account_type
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: account_type.company_id,
            table_name: "account_account_type",
            record_id: type_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_account_group(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateAccountGroupParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_group", "create")?;

    let company_id = require_explicit_company_id(
        ctx,
        organization_id,
        params.company_id,
        "account-group creation",
    )?;

    validate_account_group_parent(ctx, organization_id, company_id, None, params.parent_id)?;

    let group = ctx.db.account_group().insert(AccountGroup {
        id: 0,
        organization_id,
        name: params.name.clone(),
        code_prefix_start: params.code_prefix_start,
        code_prefix_end: params.code_prefix_end,
        level: params.level,
        parent_id: params.parent_id,
        company_id,
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
            table_name: "account_group",
            record_id: group.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "name": params.name, "level": params.level }).to_string(),
            ),
            changed_fields: vec!["name".to_string(), "level".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_account_group(
    ctx: &ReducerContext,
    organization_id: u64,
    group_id: u64,
    params: UpdateAccountGroupParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_group", "write")?;

    let company_id = require_explicit_company_id(
        ctx,
        organization_id,
        params.company_id,
        "account-group update",
    )?;

    let group = ctx
        .db
        .account_group()
        .id()
        .find(&group_id)
        .ok_or("Account group not found")?;

    if group.organization_id != organization_id || group.company_id != company_id {
        return Err("account group does not belong to this organization and company".to_string());
    }

    if let Some(parent_id) = params.parent_id {
        validate_account_group_parent(ctx, organization_id, company_id, Some(group_id), parent_id)?;
    }

    ctx.db.account_group().id().update(AccountGroup {
        name: params.name.unwrap_or(group.name),
        code_prefix_start: params.code_prefix_start.unwrap_or(group.code_prefix_start),
        code_prefix_end: params.code_prefix_end.unwrap_or(group.code_prefix_end),
        level: params.level.unwrap_or(group.level),
        parent_id: params.parent_id.unwrap_or(group.parent_id),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata.unwrap_or(group.metadata),
        ..group
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(group.company_id),
            table_name: "account_group",
            record_id: group_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    Ok(())
}

fn validate_account_type_relation(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    account_type_id: u64,
) -> Result<(), String> {
    let account_type = ctx
        .db
        .account_account_type()
        .id()
        .find(&account_type_id)
        .ok_or("Account type not found")?;
    if account_type.organization_id != organization_id
        || account_type.company_id.is_some_and(|id| id != company_id)
    {
        return Err("Account type does not belong to this organization and company".to_string());
    }
    if account_type.is_deprecated {
        return Err("Account type is deprecated".to_string());
    }
    Ok(())
}

fn validate_account_group_relation(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    group_id: Option<u64>,
) -> Result<(), String> {
    let Some(group_id) = group_id else {
        return Ok(());
    };
    let group = ctx
        .db
        .account_group()
        .id()
        .find(&group_id)
        .ok_or("Account group not found")?;
    if group.organization_id != organization_id || group.company_id != company_id {
        return Err("Account group does not belong to this organization and company".to_string());
    }
    Ok(())
}

fn validate_account_group_parent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    group_id: Option<u64>,
    parent_id: Option<u64>,
) -> Result<(), String> {
    let Some(parent_id) = parent_id else {
        return Ok(());
    };
    if group_id == Some(parent_id) {
        return Err("account group cannot be its own parent".to_string());
    }
    let parent = ctx
        .db
        .account_group()
        .id()
        .find(&parent_id)
        .ok_or("parent group not found")?;
    if parent.organization_id != organization_id || parent.company_id != company_id {
        return Err("parent group does not belong to this organization and company".to_string());
    }
    Ok(())
}

fn validate_account_journal_ids(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    journal_ids: &[u64],
) -> Result<(), String> {
    let mut seen = HashSet::with_capacity(journal_ids.len());
    for journal_id in journal_ids {
        if !seen.insert(*journal_id) {
            return Err(format!("Allowed journal {journal_id} is duplicated"));
        }
        require_active_journal(ctx, organization_id, company_id, *journal_id, "allowed")?;
    }
    Ok(())
}

/// Validate account `tax_ids` (duplicates fail). Update semantics: `None` preserve,
/// `Some([])` clear, `Some(ids)` replace — see `relations` module docs (ACC-RI-017).
fn validate_account_tax_ids(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    tax_ids: &[u64],
) -> Result<(), String> {
    let mut seen = HashSet::with_capacity(tax_ids.len());
    for tax_id in tax_ids {
        if !seen.insert(*tax_id) {
            return Err(format!("Tax {tax_id} is duplicated"));
        }
        let tax = ctx
            .db
            .account_tax()
            .id()
            .find(tax_id)
            .ok_or_else(|| format!("Tax {tax_id} not found"))?;
        if tax.organization_id != organization_id || tax.company_id != company_id {
            return Err(format!(
                "Tax {tax_id} does not belong to this organization and company"
            ));
        }
        if !tax.active {
            return Err(format!("Tax {tax_id} is inactive"));
        }
    }
    Ok(())
}

fn validate_journal_auxiliary_relations(
    ctx: &ReducerContext,
    organization_id: u64,
    sequence_id: Option<u64>,
    refund_sequence_id: Option<u64>,
    secure_sequence_id: Option<u64>,
    dedicated_payment_method_ids: &[u64],
    sale_activity_type_id: Option<u64>,
    sale_activity_user_id: Option<u64>,
) -> Result<(), String> {
    if sequence_id.is_some() || refund_sequence_id.is_some() || secure_sequence_id.is_some() {
        return Err(
            "journal numeric sequence IDs are unsupported until a typed sequence relation exists"
                .to_string(),
        );
    }
    if !dedicated_payment_method_ids.is_empty() {
        return Err(
            "journal dedicated payment method IDs are unsupported until an accounting payment-method relation exists"
                .to_string(),
        );
    }
    if sale_activity_user_id.is_some() {
        return Err(
            "journal sale activity user IDs are unsupported; users are identified by Identity"
                .to_string(),
        );
    }
    if let Some(activity_type_id) = sale_activity_type_id {
        let activity_type = ctx
            .db
            .activity_type()
            .id()
            .find(&activity_type_id)
            .ok_or("journal sale activity type not found")?;
        if activity_type.organization_id != organization_id {
            return Err(
                "journal sale activity type does not belong to this organization".to_string(),
            );
        }
        if !activity_type.is_active {
            return Err("journal sale activity type is inactive".to_string());
        }
    }
    Ok(())
}

#[spacetimedb::reducer]
pub fn create_account_account(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateAccountAccountParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_account", "create")?;

    let company_id =
        require_explicit_company_id(ctx, organization_id, params.company_id, "account creation")?;

    validate_account_type_relation(ctx, organization_id, company_id, params.user_type_id)?;
    if let Some(currency_id) = params.currency_id {
        require_active_currency_id(ctx, currency_id, "account")?;
    }
    validate_account_group_relation(ctx, organization_id, company_id, params.group_id)?;
    validate_account_journal_ids(
        ctx,
        organization_id,
        company_id,
        &params.allowed_journal_ids,
    )?;
    validate_account_tax_ids(ctx, organization_id, company_id, &params.tax_ids)?;

    let opening_balance = params.opening_debit - params.opening_credit;

    let is_bank_account = params.internal_type == Some(AccountTypeInternal::Liquidity);

    let account = ctx.db.account_account().insert(AccountAccount {
        id: 0,
        organization_id,
        code: params.code.clone(),
        name: params.name.clone(),
        deprecated: false,
        used: false,
        user_type_id: params.user_type_id,
        company_id,
        currency_id: params.currency_id,
        internal_type: params.internal_type,
        internal_group: params.internal_group,
        is_off_balance: params.is_off_balance,
        last_time_entries_checked: None,
        group_id: params.group_id,
        root_id: None,
        allowed_journal_ids: params.allowed_journal_ids,
        non_trade: params.non_trade,
        is_bank_account,
        reconcile: params.reconcile,
        tax_ids: params.tax_ids,
        note: params.note,
        opening_debit: params.opening_debit,
        opening_credit: params.opening_credit,
        opening_balance,
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
            table_name: "account_account",
            record_id: account.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "code": params.code, "name": params.name }).to_string(),
            ),
            changed_fields: vec!["code".to_string(), "name".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_account_account(
    ctx: &ReducerContext,
    organization_id: u64,
    account_id: u64,
    params: UpdateAccountAccountParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_account", "write")?;

    let company_id =
        require_explicit_company_id(ctx, organization_id, params.company_id, "account update")?;

    let account = ctx
        .db
        .account_account()
        .id()
        .find(&account_id)
        .ok_or("Account not found")?;

    if account.organization_id != organization_id || account.company_id != company_id {
        return Err("Account does not belong to this organization and company".to_string());
    }
    if let Some(Some(currency_id)) = params.currency_id {
        require_active_currency_id(ctx, currency_id, "account")?;
    }
    if let Some(group_id) = params.group_id {
        validate_account_group_relation(ctx, organization_id, company_id, group_id)?;
    }
    if let Some(ref journal_ids) = params.allowed_journal_ids {
        validate_account_journal_ids(ctx, organization_id, company_id, journal_ids)?;
    }
    if let Some(ref tax_ids) = params.tax_ids {
        validate_account_tax_ids(ctx, organization_id, company_id, tax_ids)?;
    }

    let is_bank_account = if let Some(ref it) = params.internal_type {
        *it == AccountTypeInternal::Liquidity
    } else {
        account.is_bank_account
    };

    ctx.db.account_account().id().update(AccountAccount {
        name: params.name.unwrap_or(account.name),
        code: params.code.unwrap_or(account.code),
        deprecated: params.deprecated.unwrap_or(account.deprecated),
        currency_id: params.currency_id.unwrap_or(account.currency_id),
        internal_type: params.internal_type.or(account.internal_type),
        internal_group: params.internal_group.or(account.internal_group),
        group_id: params.group_id.unwrap_or(account.group_id),
        reconcile: params.reconcile.unwrap_or(account.reconcile),
        tax_ids: params.tax_ids.unwrap_or(account.tax_ids),
        note: params.note.unwrap_or(account.note),
        allowed_journal_ids: params
            .allowed_journal_ids
            .unwrap_or(account.allowed_journal_ids),
        non_trade: params.non_trade.unwrap_or(account.non_trade),
        is_bank_account,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata.unwrap_or(account.metadata),
        ..account
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(account.company_id),
            table_name: "account_account",
            record_id: account_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_account_journal(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateAccountJournalParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_journal", "create")?;

    let company_id =
        require_explicit_company_id(ctx, organization_id, params.company_id, "journal creation")?;

    if let Some(currency_id) = params.currency_id {
        require_active_currency_id(ctx, currency_id, "journal")?;
    }
    validate_journal_auxiliary_relations(
        ctx,
        organization_id,
        params.sequence_id,
        params.refund_sequence_id,
        params.secure_sequence_id,
        &params.dedicated_payment_method_ids,
        params.sale_activity_type_id,
        params.sale_activity_user_id,
    )?;
    for (maybe_id, role) in [
        (params.default_account_id, "journal default"),
        (params.suspense_account_id, "journal suspense"),
        (params.loss_account_id, "journal loss"),
        (params.profit_account_id, "journal profit"),
        (params.bank_account_id, "journal bank"),
        (params.payment_credit_account_id, "journal payment credit"),
        (params.payment_debit_account_id, "journal payment debit"),
    ] {
        if let Some(id) = maybe_id {
            require_active_account(ctx, organization_id, company_id, id, role)?;
        }
    }

    let journal = ctx.db.account_journal().insert(AccountJournal {
        id: 0,
        organization_id,
        name: params.name.clone(),
        code: params.code.clone(),
        active: params.active,
        type_: params.type_,
        company_id,
        currency_id: params.currency_id,
        default_account_id: params.default_account_id,
        suspense_account_id: params.suspense_account_id,
        loss_account_id: params.loss_account_id,
        profit_account_id: params.profit_account_id,
        bank_account_id: params.bank_account_id,
        invoice_reference_type: params.invoice_reference_type,
        invoice_reference_model: params.invoice_reference_model,
        payment_credit_account_id: params.payment_credit_account_id,
        payment_debit_account_id: params.payment_debit_account_id,
        sequence_id: params.sequence_id,
        refund_sequence_id: params.refund_sequence_id,
        sequence_override_regex: params.sequence_override_regex,
        secure_sequence_id: params.secure_sequence_id,
        alias_name: params.alias_name,
        alias_domain: params.alias_domain,
        at_least_one_inbound: params.at_least_one_inbound,
        at_least_one_outbound: params.at_least_one_outbound,
        dedicated_payment_method_ids: params.dedicated_payment_method_ids,
        sale_activity_type_id: params.sale_activity_type_id,
        sale_activity_user_id: params.sale_activity_user_id,
        sale_activity_note: params.sale_activity_note,
        sale_activity_date_deadline: params.sale_activity_date_deadline,
        sale_activity_done: params.sale_activity_done,
        restrict_mode_hash_table: params.restrict_mode_hash_table,
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
            table_name: "account_journal",
            record_id: journal.id,
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
pub fn update_account_journal(
    ctx: &ReducerContext,
    organization_id: u64,
    journal_id: u64,
    params: UpdateAccountJournalParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_journal", "write")?;

    let company_id =
        require_explicit_company_id(ctx, organization_id, params.company_id, "journal update")?;

    let journal = ctx
        .db
        .account_journal()
        .id()
        .find(&journal_id)
        .ok_or("Journal not found")?;

    if journal.organization_id != organization_id || journal.company_id != company_id {
        return Err("Journal does not belong to this organization and company".to_string());
    }
    if let Some(Some(currency_id)) = params.currency_id {
        require_active_currency_id(ctx, currency_id, "journal")?;
    }

    for (maybe_id, role) in [
        (params.default_account_id.flatten(), "journal default"),
        (params.suspense_account_id.flatten(), "journal suspense"),
        (params.loss_account_id.flatten(), "journal loss"),
        (params.profit_account_id.flatten(), "journal profit"),
        (params.bank_account_id.flatten(), "journal bank"),
        (
            params.payment_credit_account_id.flatten(),
            "journal payment credit",
        ),
        (
            params.payment_debit_account_id.flatten(),
            "journal payment debit",
        ),
    ] {
        if let Some(id) = maybe_id {
            require_active_account(ctx, organization_id, company_id, id, role)?;
        }
    }

    ctx.db.account_journal().id().update(AccountJournal {
        name: params.name.unwrap_or(journal.name),
        code: params.code.unwrap_or(journal.code),
        active: params.active.unwrap_or(journal.active),
        currency_id: params.currency_id.unwrap_or(journal.currency_id),
        default_account_id: params
            .default_account_id
            .unwrap_or(journal.default_account_id),
        suspense_account_id: params
            .suspense_account_id
            .unwrap_or(journal.suspense_account_id),
        loss_account_id: params.loss_account_id.unwrap_or(journal.loss_account_id),
        profit_account_id: params
            .profit_account_id
            .unwrap_or(journal.profit_account_id),
        bank_account_id: params.bank_account_id.unwrap_or(journal.bank_account_id),
        payment_credit_account_id: params
            .payment_credit_account_id
            .unwrap_or(journal.payment_credit_account_id),
        payment_debit_account_id: params
            .payment_debit_account_id
            .unwrap_or(journal.payment_debit_account_id),
        alias_name: params.alias_name.unwrap_or(journal.alias_name),
        alias_domain: params.alias_domain.unwrap_or(journal.alias_domain),
        restrict_mode_hash_table: params
            .restrict_mode_hash_table
            .unwrap_or(journal.restrict_mode_hash_table),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata.unwrap_or(journal.metadata),
        ..journal
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(journal.company_id),
            table_name: "account_journal",
            record_id: journal_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn deprecate_account_account(
    ctx: &ReducerContext,
    organization_id: u64,
    account_id: u64,
    params: DeprecateAccountAccountParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_account", "write")?;

    let company_id = require_explicit_company_id(
        ctx,
        organization_id,
        params.company_id,
        "account deprecation",
    )?;

    let account = ctx
        .db
        .account_account()
        .id()
        .find(&account_id)
        .ok_or("Account not found")?;

    if account.organization_id != organization_id || account.company_id != company_id {
        return Err("Account does not belong to this organization and company".to_string());
    }

    ctx.db.account_account().id().update(AccountAccount {
        deprecated: params.deprecated,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..account
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(account.company_id),
            table_name: "account_account",
            record_id: account_id,
            action: if params.deprecated {
                "SET_ACTIVE"
            } else {
                "SET_ACTIVE"
            },
            old_values: None,
            new_values: None,
            changed_fields: vec!["deprecated".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

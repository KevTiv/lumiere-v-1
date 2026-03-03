/// Chart of Accounts — AccountAccount, AccountAccountType, AccountGroup, AccountJournal
///
/// # 7.1 Chart of Accounts
///
/// Tables for managing the chart of accounts, account types, groups, and journals.
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};
use crate::types::{AccountInternalGroup, AccountTypeInternal, JournalType};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = account_account,
    public,
    index(accessor = account_by_code, btree(columns = [company_id, code])),
    index(accessor = account_by_company, btree(columns = [company_id])),
    index(accessor = account_by_type, btree(columns = [user_type_id]))
)]
pub struct AccountAccount {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
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
    index(accessor = account_type_by_company, btree(columns = [company_id]))
)]
pub struct AccountAccountType {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
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
    index(accessor = account_group_by_company, btree(columns = [company_id])),
    index(accessor = account_group_by_parent, btree(columns = [parent_id]))
)]
pub struct AccountGroup {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
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
    index(accessor = journal_by_code, btree(columns = [company_id, code])),
    index(accessor = journal_by_company, btree(columns = [company_id])),
    index(accessor = journal_by_type, btree(columns = [type_]))
)]
pub struct AccountJournal {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
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

// ── Reducers ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn create_account_account_type(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    type_: String,
    internal_group: AccountInternalGroup,
    include_initial_balance: bool,
    company_id: Option<u64>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_account_type", "create")?;

    let name_clone = name.clone();
    let type_clone = type_.clone();

    let account_type = ctx.db.account_account_type().insert(AccountAccountType {
        id: 0,
        name,
        type_,
        internal_group,
        include_initial_balance,
        is_deprecated: false,
        company_id,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        company_id,
        "account_account_type",
        account_type.id,
        "CREATE",
        None,
        Some(serde_json::json!({ "name": name_clone, "type_": type_clone }).to_string()),
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_account_account_type(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    type_id: u64,
    name: Option<String>,
    type_: Option<String>,
    internal_group: Option<AccountInternalGroup>,
    include_initial_balance: Option<bool>,
    is_deprecated: Option<bool>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_account_type", "write")?;

    let account_type = ctx
        .db
        .account_account_type()
        .id()
        .find(&type_id)
        .ok_or("Account type not found")?;

    // Validate company access if account type is company-specific
    if let Some(cid) = account_type.company_id {
        if Some(cid) != company_id {
            return Err("Cannot modify account type from another company".to_string());
        }
    }

    ctx.db
        .account_account_type()
        .id()
        .update(AccountAccountType {
            name: name.unwrap_or(account_type.name),
            type_: type_.unwrap_or(account_type.type_),
            internal_group: internal_group.unwrap_or(account_type.internal_group),
            include_initial_balance: include_initial_balance
                .unwrap_or(account_type.include_initial_balance),
            is_deprecated: is_deprecated.unwrap_or(account_type.is_deprecated),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: metadata.or(account_type.metadata),
            ..account_type
        });

    write_audit_log(
        ctx,
        organization_id,
        account_type.company_id,
        "account_account_type",
        type_id,
        "UPDATE",
        None,
        None,
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_account_group(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    code_prefix_start: Option<String>,
    code_prefix_end: Option<String>,
    level: u32,
    parent_id: Option<u64>,
    company_id: u64,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_group", "create")?;

    // Validate parent exists if provided
    if let Some(pid) = parent_id {
        ctx.db
            .account_group()
            .id()
            .find(&pid)
            .ok_or("Parent group not found")?;
    }

    let name_clone = name.clone();

    let group = ctx.db.account_group().insert(AccountGroup {
        id: 0,
        name,
        code_prefix_start,
        code_prefix_end,
        level,
        parent_id,
        company_id,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(group.company_id),
        "account_group",
        group.id,
        "CREATE",
        None,
        Some(serde_json::json!({ "name": name_clone, "level": level }).to_string()),
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_account_group(
    ctx: &ReducerContext,
    organization_id: u64,
    group_id: u64,
    name: Option<String>,
    code_prefix_start: Option<String>,
    code_prefix_end: Option<String>,
    level: Option<u32>,
    parent_id: Option<Option<u64>>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_group", "write")?;

    let group = ctx
        .db
        .account_group()
        .id()
        .find(&group_id)
        .ok_or("Account group not found")?;

    if let Some(pid) = parent_id.flatten() {
        ctx.db
            .account_group()
            .id()
            .find(&pid)
            .ok_or("Parent group not found")?;
    }

    ctx.db.account_group().id().update(AccountGroup {
        name: name.unwrap_or(group.name),
        code_prefix_start: code_prefix_start.or(group.code_prefix_start),
        code_prefix_end: code_prefix_end.or(group.code_prefix_end),
        level: level.unwrap_or(group.level),
        parent_id: parent_id.unwrap_or(group.parent_id),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: metadata.or(group.metadata),
        ..group
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(group.company_id),
        "account_group",
        group_id,
        "UPDATE",
        None,
        None,
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_account_account(
    ctx: &ReducerContext,
    organization_id: u64,
    code: String,
    name: String,
    user_type_id: u64,
    company_id: u64,
    currency_id: Option<u64>,
    internal_type: Option<AccountTypeInternal>,
    internal_group: Option<AccountInternalGroup>,
    group_id: Option<u64>,
    reconcile: bool,
    tax_ids: Vec<u64>,
    note: Option<String>,
    opening_debit: f64,
    opening_credit: f64,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_account", "create")?;

    // Validate account type exists
    ctx.db
        .account_account_type()
        .id()
        .find(&user_type_id)
        .ok_or("Account type not found")?;

    let opening_balance = opening_debit - opening_credit;

    let is_bank_account = internal_type == Some(AccountTypeInternal::Liquidity);

    let account = ctx.db.account_account().insert(AccountAccount {
        id: 0,
        code: code.clone(),
        name: name.clone(),
        deprecated: false,
        used: false,
        user_type_id,
        company_id,
        currency_id,
        internal_type,
        internal_group,
        is_off_balance: false,
        last_time_entries_checked: None,
        group_id,
        root_id: None,
        allowed_journal_ids: Vec::new(),
        non_trade: false,
        is_bank_account,
        reconcile,
        tax_ids,
        note,
        opening_debit,
        opening_credit,
        opening_balance,
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
        "account_account",
        account.id,
        "CREATE",
        None,
        Some(serde_json::json!({ "code": code.clone(), "name": name.clone() }).to_string()),
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_account_account(
    ctx: &ReducerContext,
    organization_id: u64,
    account_id: u64,
    name: Option<String>,
    deprecated: Option<bool>,
    currency_id: Option<u64>,
    internal_type: Option<AccountTypeInternal>,
    internal_group: Option<AccountInternalGroup>,
    group_id: Option<Option<u64>>,
    reconcile: Option<bool>,
    tax_ids: Option<Vec<u64>>,
    note: Option<Option<String>>,
    allowed_journal_ids: Option<Vec<u64>>,
    non_trade: Option<bool>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_account", "write")?;

    let account = ctx
        .db
        .account_account()
        .id()
        .find(&account_id)
        .ok_or("Account not found")?;

    let is_bank_account = if let Some(ref it) = internal_type {
        *it == AccountTypeInternal::Liquidity
    } else {
        account.is_bank_account
    };

    ctx.db.account_account().id().update(AccountAccount {
        name: name.unwrap_or(account.name),
        deprecated: deprecated.unwrap_or(account.deprecated),
        currency_id: currency_id.or(account.currency_id),
        internal_type: internal_type.or(account.internal_type),
        internal_group: internal_group.or(account.internal_group),
        group_id: group_id.unwrap_or(account.group_id),
        reconcile: reconcile.unwrap_or(account.reconcile),
        tax_ids: tax_ids.unwrap_or(account.tax_ids),
        note: note.unwrap_or(account.note),
        allowed_journal_ids: allowed_journal_ids.unwrap_or(account.allowed_journal_ids),
        non_trade: non_trade.unwrap_or(account.non_trade),
        is_bank_account,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: metadata.or(account.metadata),
        ..account
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(account.company_id),
        "account_account",
        account_id,
        "UPDATE",
        None,
        None,
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_account_journal(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    code: String,
    type_: JournalType,
    company_id: u64,
    currency_id: Option<u64>,
    default_account_id: Option<u64>,
    suspense_account_id: Option<u64>,
    loss_account_id: Option<u64>,
    profit_account_id: Option<u64>,
    bank_account_id: Option<u64>,
    payment_credit_account_id: Option<u64>,
    payment_debit_account_id: Option<u64>,
    invoice_reference_type: Option<String>,
    invoice_reference_model: Option<String>,
    sequence_id: Option<u64>,
    refund_sequence_id: Option<u64>,
    sequence_override_regex: Option<String>,
    secure_sequence_id: Option<u64>,
    alias_name: Option<String>,
    alias_domain: Option<String>,
    sale_activity_type_id: Option<u64>,
    sale_activity_user_id: Option<u64>,
    sale_activity_note: Option<String>,
    sale_activity_date_deadline: Option<Timestamp>,
    restrict_mode_hash_table: bool,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_journal", "create")?;

    // Validate accounts if provided
    for maybe_id in [
        default_account_id,
        suspense_account_id,
        loss_account_id,
        profit_account_id,
        bank_account_id,
    ] {
        if let Some(id) = maybe_id {
            ctx.db
                .account_account()
                .id()
                .find(&id)
                .ok_or("Referenced account not found")?;
        }
    }

    let journal = ctx.db.account_journal().insert(AccountJournal {
        id: 0,
        name: name.clone(),
        code: code.clone(),
        active: true,
        type_,
        company_id,
        currency_id,
        default_account_id,
        suspense_account_id,
        loss_account_id,
        profit_account_id,
        bank_account_id,
        invoice_reference_type,
        invoice_reference_model,
        payment_credit_account_id,
        payment_debit_account_id,
        sequence_id,
        refund_sequence_id,
        sequence_override_regex,
        secure_sequence_id,
        alias_name,
        alias_domain,
        at_least_one_inbound: false,
        at_least_one_outbound: false,
        dedicated_payment_method_ids: Vec::new(),
        sale_activity_type_id,
        sale_activity_user_id,
        sale_activity_note,
        sale_activity_date_deadline,
        sale_activity_done: false,
        restrict_mode_hash_table,
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
        "account_journal",
        journal.id,
        "CREATE",
        None,
        Some(serde_json::json!({ "name": name, "code": code }).to_string()),
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_account_journal(
    ctx: &ReducerContext,
    organization_id: u64,
    journal_id: u64,
    name: Option<String>,
    code: Option<String>,
    active: Option<bool>,
    currency_id: Option<u64>,
    default_account_id: Option<Option<u64>>,
    suspense_account_id: Option<Option<u64>>,
    loss_account_id: Option<Option<u64>>,
    profit_account_id: Option<Option<u64>>,
    bank_account_id: Option<Option<u64>>,
    payment_credit_account_id: Option<Option<u64>>,
    payment_debit_account_id: Option<Option<u64>>,
    alias_name: Option<Option<String>>,
    alias_domain: Option<Option<String>>,
    restrict_mode_hash_table: Option<bool>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_journal", "write")?;

    let journal = ctx
        .db
        .account_journal()
        .id()
        .find(&journal_id)
        .ok_or("Journal not found")?;

    // Validate accounts if provided
    for maybe_id in [
        default_account_id.flatten(),
        suspense_account_id.flatten(),
        loss_account_id.flatten(),
        profit_account_id.flatten(),
        bank_account_id.flatten(),
    ] {
        if let Some(id) = maybe_id {
            ctx.db
                .account_account()
                .id()
                .find(&id)
                .ok_or("Referenced account not found")?;
        }
    }

    ctx.db.account_journal().id().update(AccountJournal {
        name: name.unwrap_or(journal.name),
        code: code.unwrap_or(journal.code),
        active: active.unwrap_or(journal.active),
        currency_id: currency_id.or(journal.currency_id),
        default_account_id: default_account_id.unwrap_or(journal.default_account_id),
        suspense_account_id: suspense_account_id.unwrap_or(journal.suspense_account_id),
        loss_account_id: loss_account_id.unwrap_or(journal.loss_account_id),
        profit_account_id: profit_account_id.unwrap_or(journal.profit_account_id),
        bank_account_id: bank_account_id.unwrap_or(journal.bank_account_id),
        payment_credit_account_id: payment_credit_account_id
            .unwrap_or(journal.payment_credit_account_id),
        payment_debit_account_id: payment_debit_account_id
            .unwrap_or(journal.payment_debit_account_id),
        alias_name: alias_name.unwrap_or(journal.alias_name),
        alias_domain: alias_domain.unwrap_or(journal.alias_domain),
        restrict_mode_hash_table: restrict_mode_hash_table
            .unwrap_or(journal.restrict_mode_hash_table),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: metadata.or(journal.metadata),
        ..journal
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(journal.company_id),
        "account_journal",
        journal_id,
        "UPDATE",
        None,
        None,
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn deprecate_account_account(
    ctx: &ReducerContext,
    organization_id: u64,
    account_id: u64,
    deprecated: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_account", "write")?;

    let account = ctx
        .db
        .account_account()
        .id()
        .find(&account_id)
        .ok_or("Account not found")?;

    ctx.db.account_account().id().update(AccountAccount {
        deprecated,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..account
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(account.company_id),
        "account_account",
        account_id,
        if deprecated {
            "DEPRECATE"
        } else {
            "UNDEPRECATE"
        },
        None,
        None,
        vec![],
    );

    Ok(())
}

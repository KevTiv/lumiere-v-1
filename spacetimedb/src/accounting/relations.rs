//! Scoped relational loaders shared by accounting mutation reducers.

use spacetimedb::ReducerContext;

use crate::accounting::chart_of_accounts::{
    account_account, account_journal, AccountAccount, AccountJournal,
};
use crate::core::organization::require_company_in_organization;
use crate::core::reference::{legacy_currency_code_for_id, require_currency_row, Currency};
use crate::crm::contacts::{contact, Contact};

pub(crate) fn require_explicit_company_id(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    operation: &str,
) -> Result<u64, String> {
    let company_id =
        company_id.ok_or_else(|| format!("{operation} requires an explicit company_id"))?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    Ok(company_id)
}

pub(crate) fn require_active_account(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    account_id: u64,
    role: &str,
) -> Result<AccountAccount, String> {
    let account = ctx
        .db
        .account_account()
        .id()
        .find(&account_id)
        .ok_or_else(|| format!("{role} account not found"))?;
    if account.organization_id != organization_id || account.company_id != company_id {
        return Err(format!(
            "{role} account does not belong to this organization and company"
        ));
    }
    if account.deprecated {
        return Err(format!("{role} account is deprecated"));
    }
    Ok(account)
}

pub(crate) fn require_active_journal(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    journal_id: u64,
    role: &str,
) -> Result<AccountJournal, String> {
    let journal = ctx
        .db
        .account_journal()
        .id()
        .find(&journal_id)
        .ok_or_else(|| format!("{role} journal not found"))?;
    if journal.organization_id != organization_id || journal.company_id != company_id {
        return Err(format!(
            "{role} journal does not belong to this organization and company"
        ));
    }
    if !journal.active {
        return Err(format!("{role} journal is inactive"));
    }
    Ok(journal)
}

pub(crate) fn require_active_currency_id(
    ctx: &ReducerContext,
    currency_id: u64,
    role: &str,
) -> Result<Currency, String> {
    if !(1..=9).contains(&currency_id) {
        return Err(format!(
            "{role} currency_id does not map to a supported currency"
        ));
    }
    let currency = require_currency_row(ctx, legacy_currency_code_for_id(currency_id))?;
    if !currency.active {
        return Err(format!("{role} currency is inactive"));
    }
    Ok(currency)
}

pub(crate) fn require_contact_in_scope(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    contact_id: u64,
    role: &str,
) -> Result<Contact, String> {
    let contact = ctx
        .db
        .contact()
        .id()
        .find(&contact_id)
        .ok_or_else(|| format!("{role} contact not found"))?;
    if contact.organization_id != organization_id {
        return Err(format!(
            "{role} contact does not belong to this organization"
        ));
    }
    if contact.company_id.is_some_and(|id| id != company_id) {
        return Err(format!("{role} contact does not belong to this company"));
    }
    if contact.deleted_at.is_some() || contact.merge_target_id.is_some() {
        return Err(format!("{role} contact is inactive"));
    }
    Ok(contact)
}

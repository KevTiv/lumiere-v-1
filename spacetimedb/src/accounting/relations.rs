//! Scoped relational loaders shared by accounting mutation reducers.
//!
//! # `Option<Vec<…>>` many-to-many update semantics (ACC-RI-017)
//!
//! Accounting update params use `Option<Vec<T>>` for association fields
//! (`tax_ids`, `account_ids`, `company_ids`, `evidence_document_ids`,
//! `allowed_journal_ids`, filter ID lists, etc.):
//!
//! | Wire value | Meaning |
//! |---|---|
//! | `None` (field omitted) | Preserve the stored collection unchanged |
//! | `Some([])` | Clear — replace with an empty collection |
//! | `Some(ids)` | Replace with exactly `ids` (validated + deduped; duplicates fail) |
//!
//! Do not treat an empty `Vec` on a non-optional create/template field as
//! “preserve from another source”; that collides with explicit clear.

use spacetimedb::ReducerContext;

use crate::accounting::chart_of_accounts::{
    account_account, account_journal, AccountAccount, AccountJournal,
};
use crate::accounting::tax_management::{account_tax, AccountTax};
use crate::core::organization::require_company_in_organization;
use crate::core::reference::{require_currency_by_id, Currency};
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

pub(crate) fn require_active_tax(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    tax_id: u64,
    role: &str,
) -> Result<AccountTax, String> {
    let tax = ctx
        .db
        .account_tax()
        .id()
        .find(&tax_id)
        .ok_or_else(|| format!("{role} tax {tax_id} not found"))?;
    if tax.organization_id != organization_id || tax.company_id != company_id {
        return Err(format!(
            "{role} tax {tax_id} does not belong to this organization and company"
        ));
    }
    if !tax.active {
        return Err(format!("{role} tax {tax_id} is inactive"));
    }
    Ok(tax)
}

pub(crate) fn require_active_currency_id(
    ctx: &ReducerContext,
    currency_id: u64,
    role: &str,
) -> Result<Currency, String> {
    let currency =
        require_currency_by_id(ctx, currency_id).map_err(|error| format!("{role} {error}"))?;
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

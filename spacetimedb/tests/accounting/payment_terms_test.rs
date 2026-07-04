/// Payment term update/delete domain tests.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::payment_terms::{
    account_payment_term, create_payment_term, delete_payment_term, update_payment_term,
    CreatePaymentTermParams,
};
use crate::core::audit::audit_log;
use crate::test_harness::{ensure_test_superuser, OrgFixture};

pub fn test_payment_term_update_and_delete(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;

    create_payment_term(
        ctx,
        org_id,
        CreatePaymentTermParams {
            name: "Harness Payment Term".to_string(),
            note: Some("Initial note".to_string()),
        },
    )?;

    let term = ctx
        .db
        .account_payment_term()
        .iter()
        .find(|t| t.organization_id == org_id && t.name == "Harness Payment Term")
        .ok_or("Payment term not found after create")?;

    if !term.is_active {
        return Err("Expected is_active true after create".to_string());
    }

    update_payment_term(
        ctx,
        org_id,
        term.id,
        Some("Harness Updated Term".to_string()),
        None,
        Some(false),
    )?;

    let updated = ctx
        .db
        .account_payment_term()
        .id()
        .find(&term.id)
        .ok_or("Payment term not found after update")?;

    if updated.name != "Harness Updated Term" {
        return Err(format!(
            "Name not updated: expected Harness Updated Term, got {}",
            updated.name
        ));
    }
    if updated.is_active {
        return Err("Expected is_active false after update".to_string());
    }
    if updated.note != Some("Initial note".to_string()) {
        return Err("Note should be unchanged when update passes None".to_string());
    }

    let has_update_audit = ctx
        .db
        .audit_log()
        .audit_by_org()
        .filter(&org_id)
        .any(|entry| {
            entry.table_name == "account_payment_term"
                && entry.record_id == term.id
                && entry.action == "UPDATE"
        });
    if !has_update_audit {
        return Err("Expected UPDATE audit row for payment term".to_string());
    }

    delete_payment_term(ctx, org_id, term.id)?;

    if ctx
        .db
        .account_payment_term()
        .id()
        .find(&term.id)
        .is_some()
    {
        return Err("Payment term row should be deleted".to_string());
    }

    let has_delete_audit = ctx
        .db
        .audit_log()
        .audit_by_org()
        .filter(&org_id)
        .any(|entry| {
            entry.table_name == "account_payment_term"
                && entry.record_id == term.id
                && entry.action == "DELETE"
        });
    if !has_delete_audit {
        return Err("Expected DELETE audit row for payment term".to_string());
    }

    Ok(())
}

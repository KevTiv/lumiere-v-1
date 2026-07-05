use spacetimedb::ReducerContext;

use crate::accounting::journal_entries::{
    account_move_line, update_account_move_line, UpdateAccountMoveLineParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

use super::helpers::create_balanced_customer_invoice;

pub fn test_cannot_edit_posted_move_line(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let move_id = create_balanced_customer_invoice(ctx, &fixture, 75.0, true)?;

    let line = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .next()
        .ok_or("Expected at least one move line")?;

    let result = update_account_move_line(
        ctx,
        fixture.organization_id,
        line.id,
        UpdateAccountMoveLineParams {
            company_id: Some(fixture.company_id),
            name: Some("Edited after post".to_string()),
            debit: None,
            credit: None,
            partner_id: None,
            analytic_account_id: None,
            metadata: None,
        },
    );

    match result {
        Ok(()) => Err("Expected update_account_move_line to fail on posted move".to_string()),
        Err(msg) if msg.contains("posted") => Ok(()),
        Err(msg) => Err(format!("Unexpected error: {msg}")),
    }
}

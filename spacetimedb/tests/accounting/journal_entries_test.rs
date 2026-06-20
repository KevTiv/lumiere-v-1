/// Journal entry / customer invoice domain tests.
use spacetimedb::ReducerContext;

use crate::accounting::journal_entries::{account_move, account_move_line};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::AccountMoveState;

use super::helpers::create_balanced_customer_invoice;

pub fn test_post_customer_invoice_creates_move_lines(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let amount = 100.0;

    let move_id = create_balanced_customer_invoice(ctx, &fixture, amount, true)?;

    let move_record = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("Posted invoice move not found")?;

    if move_record.state != AccountMoveState::Posted {
        return Err(format!(
            "Expected Posted invoice state, got {:?}",
            move_record.state
        ));
    }

    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .collect();

    if lines.len() < 2 {
        return Err(format!(
            "Expected at least 2 move lines after post, got {}",
            lines.len()
        ));
    }

    let total_debit: f64 = lines.iter().map(|l| l.debit).sum();
    let total_credit: f64 = lines.iter().map(|l| l.credit).sum();

    if (total_debit - total_credit).abs() > 0.01 {
        return Err(format!(
            "Move lines not balanced: debit={total_debit} credit={total_credit}"
        ));
    }

    if (total_debit - amount).abs() > 0.01 {
        return Err(format!(
            "Expected total debit ~{amount}, got {total_debit}"
        ));
    }

    Ok(())
}

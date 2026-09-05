use spacetimedb::ReducerContext;

use crate::workflow::runtime::{workflow_command_receipt, WorkflowCommandReceipt};

/// Look up an existing command receipt by scope key and verify input-hash parity.
///
/// Returns `Ok(None)` when no receipt exists, `Ok(Some)` on exact retry, and
/// `Err` when the same scope key was used with different input (conflicting
/// replay). Error text is preserved exactly from the original inline copies.
pub(crate) fn replay_command_receipt(
    ctx: &ReducerContext,
    scope_key: &str,
    input_hash: &str,
) -> Result<Option<WorkflowCommandReceipt>, String> {
    let Some(receipt) = ctx
        .db
        .workflow_command_receipt()
        .scope_key()
        .find(scope_key.to_string())
    else {
        return Ok(None);
    };
    if receipt.input_hash != input_hash {
        return Err("idempotency key was already used with different input".to_string());
    }
    Ok(Some(receipt))
}

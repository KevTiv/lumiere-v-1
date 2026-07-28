//! Accounting command receipts used to make multi-row mutations retry-safe.

use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

#[spacetimedb::table(
    accessor = accounting_operation_receipt,
    index(accessor = accounting_operation_receipt_by_scope, btree(columns = [organization_id, company_id, action_kind]))
)]
#[derive(Clone)]
pub struct AccountingOperationReceipt {
    #[primary_key]
    pub id: String,
    pub organization_id: u64,
    pub company_id: u64,
    pub action_kind: String,
    pub idempotency_key: String,
    pub payload_fingerprint: String,
    pub result_table: String,
    pub result_id: u64,
    pub created_at: Timestamp,
    pub created_by: Identity,
}

fn receipt_id(
    organization_id: u64,
    company_id: u64,
    action_kind: &str,
    idempotency_key: &str,
) -> String {
    format!(
        "{organization_id}:{company_id}:{action_kind}:{}:{idempotency_key}",
        idempotency_key.len()
    )
}

pub(crate) fn replayed_result(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    action_kind: &str,
    idempotency_key: &str,
    payload_fingerprint: &str,
) -> Result<Option<u64>, String> {
    let key = idempotency_key.trim();
    if key.is_empty() {
        return Err("idempotency key is required".to_string());
    }
    if key != idempotency_key || key.len() > 256 {
        return Err("idempotency key must be trimmed and at most 256 bytes".to_string());
    }

    let id = receipt_id(organization_id, company_id, action_kind, key);
    let Some(receipt) = ctx.db.accounting_operation_receipt().id().find(&id) else {
        return Ok(None);
    };
    if receipt.payload_fingerprint != payload_fingerprint {
        return Err(format!(
            "idempotency key already used with different {action_kind} input"
        ));
    }
    Ok(Some(receipt.result_id))
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn record_result(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    action_kind: &str,
    idempotency_key: String,
    payload_fingerprint: String,
    result_table: &str,
    result_id: u64,
) {
    ctx.db
        .accounting_operation_receipt()
        .insert(AccountingOperationReceipt {
            id: receipt_id(organization_id, company_id, action_kind, &idempotency_key),
            organization_id,
            company_id,
            action_kind: action_kind.to_string(),
            idempotency_key,
            payload_fingerprint,
            result_table: result_table.to_string(),
            result_id,
            created_at: ctx.timestamp,
            created_by: ctx.sender(),
        });
}

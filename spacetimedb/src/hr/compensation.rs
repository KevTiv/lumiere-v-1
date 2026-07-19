/// HR Compensation — effective-dated wage history events.
use spacetimedb::{ReducerContext, Table, Timestamp};

use crate::helpers::{write_audit_log_v2, AuditLogParams};

// ── Tables ────────────────────────────────────────────────────────────────────

/// Append-only compensation change tied to a contract (wage history).
#[spacetimedb::table(
    accessor = hr_compensation_event,
    public,
    index(accessor = compensation_by_org, btree(columns = [organization_id])),
    index(accessor = compensation_by_employee, btree(columns = [employee_id])),
    index(accessor = compensation_by_contract, btree(columns = [contract_id]))
)]
pub struct HrCompensationEvent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub employee_id: u64,
    pub contract_id: u64,
    pub wage: f64,
    pub currency_id: u64,
    pub effective_from: Timestamp,
    pub reason: Option<String>,
    pub created_at: Timestamp,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

pub fn append_compensation_event(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
    contract_id: u64,
    wage: f64,
    currency_id: u64,
    effective_from: Timestamp,
    reason: Option<String>,
) -> HrCompensationEvent {
    let row = ctx.db.hr_compensation_event().insert(HrCompensationEvent {
        id: 0,
        organization_id,
        company_id,
        employee_id,
        contract_id,
        wage,
        currency_id,
        effective_from,
        reason: reason.clone(),
        created_at: ctx.timestamp,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_compensation_event",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "contract_id": contract_id,
                    "employee_id": employee_id,
                    "wage": wage,
                    "currency_id": currency_id,
                    "reason": reason,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "wage".to_string(),
                "effective_from".to_string(),
                "reason".to_string(),
            ],
            metadata: None,
        },
    );
    row
}

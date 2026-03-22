/// HR Contracts — HrContract
///
/// Employment contracts linking employees to their salary and terms.
use spacetimedb::{reducer, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::ContractState;

// ── Table ─────────────────────────────────────────────────────────────────────

/// HR Contract — An employment contract for a specific employee.
#[spacetimedb::table(
    accessor = hr_contract,
    public,
    index(accessor = contract_by_employee, btree(columns = [employee_id])),
    index(accessor = contract_by_org, btree(columns = [organization_id])),
    index(accessor = contract_by_state, btree(columns = [state]))
)]
pub struct HrContract {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,               // e.g. "Alice Smith - Employment Contract"
    pub employee_id: u64,           // FK → HrEmployee
    pub job_id: Option<u64>,        // FK → HrJobPosition
    pub department_id: Option<u64>, // FK → HrDepartment
    pub date_start: Timestamp,
    pub date_end: Option<Timestamp>,
    pub wage: f64, // Monthly gross salary
    pub currency_id: u64,
    pub state: ContractState,
    pub notes: Option<String>,
    pub created_at: Timestamp,
}

// ── Input Params ──────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateContractParams {
    pub employee_id: u64,
    pub name: String,
    pub date_start: Timestamp,
    pub wage: f64,
    pub currency_id: u64,
    pub job_id: Option<u64>,
    pub department_id: Option<u64>,
    pub date_end: Option<Timestamp>,
    pub notes: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateContractParams {
    pub name: Option<String>,
    pub wage: Option<f64>,
    pub date_end: Option<Timestamp>,
    pub job_id: Option<u64>,
    pub department_id: Option<u64>,
    pub notes: Option<String>,
}

// ── Reducers ──────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_contract(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateContractParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_contract", "create")?;
    if params.name.is_empty() {
        return Err("Contract name cannot be empty".to_string());
    }
    if params.wage < 0.0 {
        return Err("Wage cannot be negative".to_string());
    }
    let contract = ctx.db.hr_contract().insert(HrContract {
        id: 0,
        organization_id,
        company_id,
        name: params.name,
        employee_id: params.employee_id,
        job_id: params.job_id,
        department_id: params.department_id,
        date_start: params.date_start,
        date_end: params.date_end,
        wage: params.wage,
        currency_id: params.currency_id,
        state: ContractState::New,
        notes: params.notes,
        created_at: ctx.timestamp,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_contract",
            record_id: contract.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn update_contract(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    contract_id: u64,
    params: UpdateContractParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_contract", "update")?;
    let contract = ctx
        .db
        .hr_contract()
        .id()
        .find(&contract_id)
        .ok_or("Contract not found")?;
    if contract.organization_id != organization_id {
        return Err("Contract belongs to a different organization".to_string());
    }
    if contract.company_id != company_id {
        return Err("Contract does not belong to this company".to_string());
    }
    ctx.db.hr_contract().id().update(HrContract {
        name: params.name.unwrap_or(contract.name),
        wage: params.wage.unwrap_or(contract.wage),
        date_end: params.date_end.or(contract.date_end),
        job_id: params.job_id.or(contract.job_id),
        department_id: params.department_id.or(contract.department_id),
        notes: params.notes.or(contract.notes),
        ..contract
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_contract",
            record_id: contract_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn open_contract(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    contract_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_contract", "update")?;
    let contract = ctx
        .db
        .hr_contract()
        .id()
        .find(&contract_id)
        .ok_or("Contract not found")?;
    if contract.organization_id != organization_id {
        return Err("Contract belongs to a different organization".to_string());
    }
    if contract.company_id != company_id {
        return Err("Contract does not belong to this company".to_string());
    }
    ctx.db.hr_contract().id().update(HrContract {
        state: ContractState::Open,
        ..contract
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_contract",
            record_id: contract_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn expire_contract(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    contract_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_contract", "update")?;
    let contract = ctx
        .db
        .hr_contract()
        .id()
        .find(&contract_id)
        .ok_or("Contract not found")?;
    if contract.organization_id != organization_id {
        return Err("Contract belongs to a different organization".to_string());
    }
    if contract.company_id != company_id {
        return Err("Contract does not belong to this company".to_string());
    }
    ctx.db.hr_contract().id().update(HrContract {
        state: ContractState::Expired,
        ..contract
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_contract",
            record_id: contract_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn cancel_contract(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    contract_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_contract", "update")?;
    let contract = ctx
        .db
        .hr_contract()
        .id()
        .find(&contract_id)
        .ok_or("Contract not found")?;
    if contract.organization_id != organization_id {
        return Err("Contract belongs to a different organization".to_string());
    }
    if contract.company_id != company_id {
        return Err("Contract does not belong to this company".to_string());
    }
    ctx.db.hr_contract().id().update(HrContract {
        state: ContractState::Cancelled,
        ..contract
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_contract",
            record_id: contract_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

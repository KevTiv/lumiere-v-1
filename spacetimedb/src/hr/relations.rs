//! Scoped relational loaders shared by HR mutation reducers.

use spacetimedb::ReducerContext;

use crate::hr::employees::hr_employee;

/// Validate that an employee belongs to the given organization and company.
///
/// Error text matches the former per-module `assert_employee_scope` copies
/// exactly so existing reducers retain identical rejection messages.
pub(crate) fn require_employee_in_scope(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
) -> Result<(), String> {
    let emp = ctx
        .db
        .hr_employee()
        .id()
        .find(&employee_id)
        .ok_or("Employee not found")?;
    if emp.organization_id != organization_id {
        return Err("Employee belongs to a different organization".to_string());
    }
    if emp.company_id != company_id {
        return Err("Employee does not belong to this company".to_string());
    }
    Ok(())
}

pub mod contracts;
pub mod employees;
pub mod leaves;
pub mod payroll;

pub use contracts::HrContract;
pub use employees::{HrDepartment, HrEmployee, HrJobPosition, HrResource};
pub use leaves::{HrLeave, HrLeaveType};
pub use payroll::{HrPayrollStructure, HrPayslip, HrSalaryRule};

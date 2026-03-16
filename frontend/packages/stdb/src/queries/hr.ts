import HrEmployeeRow from "../generated/hr_employee_table";
import HrDepartmentRow from "../generated/hr_department_table";
import HrLeaveRow from "../generated/hr_leave_table";
import HrContractRow from "../generated/hr_contract_table";
import HrPayslipRow from "../generated/hr_payslip_table";
import type { Infer } from "spacetimedb";
import { getStdbConnection } from "../connection";

// ── Row types ─────────────────────────────────────────────────────────────────
export type HrEmployee = Infer<typeof HrEmployeeRow>;
export type HrDepartment = Infer<typeof HrDepartmentRow>;
export type HrLeave = Infer<typeof HrLeaveRow>;
export type HrContract = Infer<typeof HrContractRow>;
export type HrPayslip = Infer<typeof HrPayslipRow>;

// ── Subscription SQL ──────────────────────────────────────────────────────────
export function hrSubscriptions(organizationId: bigint, companyId: bigint): string[] {
  const cId = String(companyId);
  return [
    `SELECT * FROM hr_employee WHERE company_id = ${cId}`,
    `SELECT * FROM hr_department WHERE company_id = ${cId}`,
    `SELECT * FROM hr_leave WHERE company_id = ${cId}`,
    `SELECT * FROM hr_contract WHERE company_id = ${cId}`,
    `SELECT * FROM hr_payslip WHERE company_id = ${cId}`,
  ];
}

// ── Query functions ───────────────────────────────────────────────────────────
export function queryEmployees(): HrEmployee[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.hr_employee.iter()].sort((a, b) => a.name.localeCompare(b.name));
}

export function queryDepartments(): HrDepartment[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.hr_department.iter()].sort((a, b) => a.name.localeCompare(b.name));
}

export function queryLeaveRequests(): HrLeave[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.hr_leave.iter()].sort(
    (a, b) => Number(b.dateFrom) - Number(a.dateFrom),
  );
}

export function queryContracts(): HrContract[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.hr_contract.iter()].sort(
    (a, b) => Number(b.dateStart) - Number(a.dateStart),
  );
}

export function queryPayslips(): HrPayslip[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.hr_payslip.iter()].sort(
    (a, b) => Number(b.dateFrom) - Number(a.dateFrom),
  );
}

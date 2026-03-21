import HrExpenseRow from "../generated/hr_expense_table";
import ExpenseSheetRow from "../generated/expense_sheet_table";
import type { Infer } from "spacetimedb";
import { getStdbConnection } from "../connection";

// ── Row types ─────────────────────────────────────────────────────────────────
export type HrExpense = Infer<typeof HrExpenseRow>;
export type ExpenseSheet = Infer<typeof ExpenseSheetRow>;

// ── Subscription SQL ──────────────────────────────────────────────────────────
export function expensesSubscriptions(organizationId: bigint): string[] {
  const id = String(organizationId);
  return [
    `SELECT * FROM hr_expense WHERE organization_id = ${id}`,
    `SELECT * FROM expense_sheet WHERE organization_id = ${id}`,
  ];
}

// ── Query functions ───────────────────────────────────────────────────────────
export function queryExpenses(): HrExpense[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.hr_expense.iter()].sort(
    (a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0),
  );
}

export function queryExpenseSheets(): ExpenseSheet[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.expense_sheet.iter()].sort(
    (a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0),
  );
}

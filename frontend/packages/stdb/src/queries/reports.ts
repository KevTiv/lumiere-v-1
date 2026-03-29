import type FinancialReportRow from "../generated/financial_report_table";
import type TrialBalanceRow from "../generated/trial_balance_table";
import type { Infer } from "spacetimedb";
import { getStdbConnection } from "../connection";

// ── Row types ─────────────────────────────────────────────────────────────────
export type FinancialReport = Infer<typeof FinancialReportRow>;
export type TrialBalance = Infer<typeof TrialBalanceRow>;

// ── Subscription SQL ──────────────────────────────────────────────────────────
export function reportsSubscriptions(organizationId: bigint): string[] {
  const id = String(organizationId);
  return [
    `SELECT * FROM financial_report WHERE organization_id = ${id}`,
    `SELECT * FROM trial_balance WHERE organization_id = ${id}`,
  ];
}

// ── Query functions ───────────────────────────────────────────────────────────
export function queryFinancialReports(): FinancialReport[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.financial_report.iter()].sort(
    (a, b) => Number(b.createDate ?? 0) - Number(a.createDate ?? 0),
  );
}

export function queryTrialBalances(): TrialBalance[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.trial_balance.iter()].sort(
    (a, b) => String(a.accountCode ?? "").localeCompare(String(b.accountCode ?? "")),
  );
}

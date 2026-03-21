import FinancialReportRow from "../generated/financial_report_table";
import TrialBalanceRow from "../generated/trial_balance_table";
import type { Infer } from "spacetimedb";
import { getStdbConnection } from "../connection";

// ── Row types ─────────────────────────────────────────────────────────────────
export type FinancialReport = Infer<typeof FinancialReportRow>;
export type TrialBalance = Infer<typeof TrialBalanceRow>;

// ── Subscription SQL ──────────────────────────────────────────────────────────
// Note: financial_report and trial_balance are scoped by company_id
export function reportsSubscriptions(companyIds: bigint[]): string[] {
  if (!companyIds.length) return [];
  const ids = companyIds.map(String).join(", ");
  return [
    `SELECT * FROM financial_report WHERE company_id IN (${ids})`,
    `SELECT * FROM trial_balance WHERE company_id IN (${ids})`,
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

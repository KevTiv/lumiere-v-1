import AccountAccountRow from "../generated/account_account_table";
import AccountMoveRow from "../generated/account_move_table";
import AccountJournalRow from "../generated/account_journal_table";
import AccountTaxRow from "../generated/account_tax_table";
import CrossoveredBudgetRow from "../generated/crossovered_budget_table";
import AccountAnalyticAccountRow from "../generated/account_analytic_account_table";
import AccountBankStatementRow from "../generated/account_bank_statement_table";
import AccountAssetRow from "../generated/account_asset_table";
import type { Infer } from "spacetimedb";
import { getStdbConnection } from "../connection";

// ── Row types derived from generated schemas ──────────────────────────────────
export type AccountAccount = Infer<typeof AccountAccountRow>;
export type AccountMove = Infer<typeof AccountMoveRow>;
export type AccountJournal = Infer<typeof AccountJournalRow>;
export type AccountTax = Infer<typeof AccountTaxRow>;
export type CrossoveredBudget = Infer<typeof CrossoveredBudgetRow>;
export type AccountAnalyticAccount = Infer<typeof AccountAnalyticAccountRow>;
export type AccountBankStatement = Infer<typeof AccountBankStatementRow>;
export type AccountAsset = Infer<typeof AccountAssetRow>;

// ── Subscription SQL (server-side filtered by company) ────────────────────────
export function accountingSubscriptions(companyId: bigint): string[] {
  const id = String(companyId);
  return [
    `SELECT * FROM account_account WHERE company_id = ${id}`,
    `SELECT * FROM account_journal WHERE company_id = ${id}`,
    `SELECT * FROM account_move WHERE company_id = ${id}`,
    `SELECT * FROM account_move_line WHERE company_id = ${id}`,
    `SELECT * FROM account_tax WHERE company_id = ${id}`,
    `SELECT * FROM account_analytic_account WHERE company_id = ${id}`,
    `SELECT * FROM crossovered_budget WHERE company_id = ${id}`,
    `SELECT * FROM crossovered_budget_lines WHERE company_id = ${id}`,
    `SELECT * FROM account_bank_statement WHERE company_id = ${id}`,
    `SELECT * FROM account_bank_statement_line WHERE company_id = ${id}`,
    `SELECT * FROM account_asset WHERE company_id = ${id}`,
    `SELECT * FROM account_asset_depreciation_line WHERE company_id = ${id}`,
  ];
}

// ── Query functions (iter only — subscription already scoped to company) ──────

export function queryAccountAccounts(): AccountAccount[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.account_account.iter()].sort((a, b) =>
    a.code.localeCompare(b.code),
  );
}

/** Pass `moveType` to further filter by type (e.g. "out_invoice", "in_invoice"). */
export function queryAccountMoves(moveType?: string): AccountMove[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  const rows = [...conn.db.account_move.iter()];
  return moveType ? rows.filter((m) => String(m.moveType) === moveType) : rows;
}

export function queryAccountJournals(): AccountJournal[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.account_journal.iter()];
}

export function queryAccountTaxes(): AccountTax[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.account_tax.iter()];
}

export function queryBudgets(): CrossoveredBudget[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.crossovered_budget.iter()];
}

export function queryAnalyticAccounts(): AccountAnalyticAccount[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.account_analytic_account.iter()].sort((a, b) =>
    (a.code ?? "").localeCompare(b.code ?? ""),
  );
}

export function queryBankStatements(): AccountBankStatement[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.account_bank_statement.iter()].sort(
    (a, b) => Number(b.date ?? 0) - Number(a.date ?? 0),
  );
}

export function queryFixedAssets(): AccountAsset[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.account_asset.iter()].sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? ""),
  );
}

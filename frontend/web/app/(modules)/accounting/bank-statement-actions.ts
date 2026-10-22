import { toCreateAccountBankStatementParams } from '@lumiere/erp-shared/accounting-create-params';
import { optionalBigIntU64, unwrapSome } from '@lumiere/erp-shared/form-coercion';
import { stbTimestampFromDate } from '@lumiere/erp-shared/stb-timestamp';
import { compatNumberToDate, isoToDate, stdbTimestampToDate } from '@lumiere/erp-shared/timestamp-values';
import { variantTag } from '@lumiere/erp-workflows';
import type { CreateAccountBankStatementParams, UpdateAccountBankStatementParams } from '@lumiere/stdb/types';

type Row = Record<string, unknown>;

function text(value: unknown): string {
  const unwrapped = unwrapSome(value);
  return unwrapped == null ? '' : String(unwrapped).trim();
}

/** `update_account_bank_statement` does not check the state, but a posted statement is final. */
export function canEditBankStatement(statement: Row): boolean {
  return variantTag(statement.state) !== 'Posted';
}

/**
 * Statements are opened on bank journals only. `create_account_bank_statement` does not check the
 * journal type, so the picker and the submit both enforce it here.
 */
export function bankJournals(journals: readonly Row[]): Row[] {
  return journals.filter((journal) => variantTag(journal.type ?? journal.type_).toLowerCase() === 'bank');
}

/** `YYYY-MM-DD` for a date input; '' when the timestamp is absent or unreadable. */
export function statementDateInput(value: unknown): string {
  const raw = unwrapSome(value);
  const date =
    stdbTimestampToDate(raw) ??
    (typeof raw === 'string' && Number.isNaN(Number(raw)) ? isoToDate(raw) : compatNumberToDate(raw));
  return date == null ? '' : date.toISOString().slice(0, 10);
}

function finiteNumber(raw: unknown, fallback?: number): number | null {
  const s = text(raw);
  if (s === '') return fallback ?? null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Arguments for `create_account_bank_statement` (account_bank_statement:create). The statement
 * belongs to the chosen bank journal's company, which the reducer requires to match.
 */
export function toBankStatementCreateInput(
  values: Row | null | undefined,
  journals: readonly Row[],
): { companyId: bigint; journalId: bigint; params: CreateAccountBankStatementParams } | null {
  if (values == null) return null;
  const journalId = optionalBigIntU64(values.journalId);
  if (journalId == null || journalId <= 0n) return null;
  const journal = bankJournals(journals).find((j) => String(j.id) === String(journalId));
  if (journal == null) return null;
  const companyId = optionalBigIntU64(journal.companyId ?? journal.company_id);
  if (companyId == null || companyId <= 0n) return null;
  const currencyId = optionalBigIntU64(values.currencyId);
  if (currencyId == null || currencyId <= 0n) return null;
  const balanceStart = finiteNumber(values.balanceStart, 0);
  if (balanceStart == null) return null;
  const date = text(values.date);
  if (date !== '' && Number.isNaN(new Date(date).getTime())) return null;
  const params = toCreateAccountBankStatementParams({
    name: values.name,
    reference: values.reference,
    date,
    balanceStart,
    currencyId,
  });
  return params == null ? null : { companyId, journalId, params };
}

export type BankStatementEditResult =
  | { ok: true; params: UpdateAccountBankStatementParams }
  | { ok: false; reason: 'invalid' | 'unchanged' };

/**
 * Params for `update_account_bank_statement` (account_bank_statement:write). Only name, reference,
 * date, opening balance and expected closing balance are ever sent, and only those that changed;
 * state, line ids, totals and validity flags stay `none` (unchanged). `name`, `reference` and
 * `date` are `Option<Option<..>>` (the inner `none` clears), and a plain number option would drop
 * zero and negative balances, so every sent value is wrapped explicitly.
 */
export function toBankStatementUpdateParams(
  values: Row | null | undefined,
  statement: Row,
): BankStatementEditResult {
  if (values == null) return { ok: false, reason: 'invalid' };
  const wire: Row = { state: { none: [] } };
  let changed = false;

  for (const key of ['name', 'reference'] as const) {
    const next = text(values[key]);
    if (next !== text(statement[key])) {
      wire[key] = { some: next === '' ? { none: [] } : { some: next } };
      changed = true;
    }
  }

  const date = text(values.date);
  if (date !== statementDateInput(statement.date)) {
    if (date === '') {
      wire.date = { some: { none: [] } };
    } else {
      const parsed = new Date(date);
      if (Number.isNaN(parsed.getTime())) return { ok: false, reason: 'invalid' };
      wire.date = { some: { some: stbTimestampFromDate(parsed) } };
    }
    changed = true;
  }

  for (const [formKey, rowKey] of [
    ['balanceStart', 'balanceStart'],
    ['balanceEndReal', 'balanceEndReal'],
  ] as const) {
    const next = finiteNumber(values[formKey]);
    if (next == null) return { ok: false, reason: 'invalid' };
    const current = Number(statement[rowKey] ?? statement[rowKey.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] ?? 0);
    if (next !== current) {
      wire[formKey] = { some: next };
      changed = true;
    }
  }

  if (!changed) return { ok: false, reason: 'unchanged' };
  return { ok: true, params: wire as unknown as UpdateAccountBankStatementParams };
}

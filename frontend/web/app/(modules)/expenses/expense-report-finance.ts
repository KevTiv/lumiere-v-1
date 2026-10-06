import { stbTimestampFromDate } from '@/lib/stb-timestamp';
import { expenseVariantTag } from '@/lib/expense-state';

type Row = Record<string, unknown>;
type FormData = Record<string, unknown>;

export type FinanceKind = 'postReport' | 'reimburseReport' | 'projectRebill';

/** Which accounting steps a report in this state offers (same gating the list uses). */
export function financeKindsFor(state: unknown): FinanceKind[] {
  const tag = expenseVariantTag(state);
  if (tag === 'Approved') return ['postReport'];
  if (tag === 'Posted') return ['reimburseReport', 'projectRebill'];
  if (tag === 'Done') return ['projectRebill'];
  return [];
}

const filled = (value: unknown): boolean => value != null && String(value).trim() !== '';
const big = (value: unknown) => BigInt(String(value));
const optBig = (value: unknown) => (filled(value) ? big(value) : undefined);
const date = (value: unknown) => stbTimestampFromDate(new Date(String(value)));

/** Post parameters, or undefined while a required field is missing. */
export function buildPostParams(sheetId: string, f: FormData) {
  if (!filled(f.accountingDate) || !f.journalId || !f.payableAccountId || !f.defaultExpenseAccountId) return undefined;
  const fxFeeAmount = filled(f.fxFeeAmount) ? Number(f.fxFeeAmount) : undefined;
  return {
    sheetId,
    params: {
      accountingDate: date(f.accountingDate),
      journalId: big(f.journalId),
      payableAccountId: big(f.payableAccountId),
      defaultExpenseAccountId: big(f.defaultExpenseAccountId),
      // Stable per sheet so retries are idempotent.
      clientRequestId: `exp-post-${sheetId}`,
      defaultTaxAccountId: optBig(f.defaultTaxAccountId),
      cardLiabilityAccountId: optBig(f.cardLiabilityAccountId),
      advanceAccountId: optBig(f.advanceAccountId),
      fxFeeAccountId: optBig(f.fxFeeAccountId),
      fxFeeAmount,
    },
  };
}

/** Reimbursement parameters, or undefined while a required field is missing. */
export function buildReimburseParams(sheetId: string, f: FormData) {
  if (!filled(f.paymentDate) || !f.journalId || !f.payableAccountId || !f.liquidityAccountId) return undefined;
  const amount = filled(f.amount) ? Number(f.amount) : undefined;
  return {
    sheetId,
    params: {
      paymentDate: date(f.paymentDate),
      journalId: big(f.journalId),
      payableAccountId: big(f.payableAccountId),
      liquidityAccountId: big(f.liquidityAccountId),
      ...(amount != null && Number.isFinite(amount) ? { amount } : {}),
      clientRequestId: `exp-reimburse-${sheetId}`,
    },
  };
}

/** Project rebill parameters, or undefined while a required field is missing. */
export function buildRebillParams(sheetId: string, f: FormData) {
  if (!filled(f.invoiceDate) || !f.journalId || !f.receivableAccountId || !f.incomeAccountId) return undefined;
  return {
    sheetId,
    params: {
      invoiceDate: date(f.invoiceDate),
      journalId: big(f.journalId),
      receivableAccountId: big(f.receivableAccountId),
      incomeAccountId: big(f.incomeAccountId),
    },
  };
}

export const sheetIdOf = (row: Row): string => String(row.id ?? '');

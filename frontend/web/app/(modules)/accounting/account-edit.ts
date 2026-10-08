import { optionalBigIntU64, unwrapSome } from '@lumiere/erp-shared/form-coercion';
import { variantTag } from '@lumiere/erp-workflows';
import type { UpdateAccountAccountParams } from '@lumiere/stdb/types';

type Row = Record<string, unknown>;

/** `AccountTypeInternal` variants, in the order the edit form lists them. */
export const ACCOUNT_INTERNAL_TYPES = [
  'Receivable',
  'Payable',
  'Liquidity',
  'Asset',
  'Equity',
  'Liability',
  'Income',
  'Expense',
  'Other',
] as const;

export type AccountEditResult =
  | { ok: true; params: UpdateAccountAccountParams }
  | { ok: false; reason: 'noCompany' | 'invalid' | 'unchanged' };

function text(value: unknown): string {
  const unwrapped = unwrapSome(value);
  return unwrapped == null ? '' : String(unwrapped).trim();
}

/** The reducer needs the account's own company, so prefer the row's and only then the operating one. */
export function accountEditCompanyId(account: Row, fallbackCompanyId: bigint): bigint | null {
  const own = optionalBigIntU64(account.companyId ?? account.company_id);
  if (own != null && own > 0n) return own;
  return fallbackCompanyId > 0n ? fallbackCompanyId : null;
}

/** Current values of the editable fields, as the edit form shows them. */
export function accountEditDefaults(account: Row): {
  name: string;
  code: string;
  deprecated: boolean;
  reconcile: boolean;
  note: string;
  internalType: string;
} {
  const tag = variantTag(unwrapSome(account.internalType ?? account.internal_type));
  return {
    name: text(account.name),
    code: text(account.code),
    deprecated: account.deprecated === true,
    reconcile: account.reconcile === true,
    note: text(account.note),
    internalType: (ACCOUNT_INTERNAL_TYPES as readonly string[]).includes(tag) ? tag : '',
  };
}

/**
 * Params for `update_account_account` (account_account:write) from the edit form. Only fields the
 * user changed are sent. `note` is an `Option<Option<String>>` (a second `some` clears it), and
 * `internal_type` / `internal_group` are enum options the generic encoder does not know, so those
 * are wrapped explicitly; the encoder fills every other absent option field with `none`.
 */
export function toAccountUpdateParams(
  values: Row | null | undefined,
  account: Row,
  fallbackCompanyId: bigint,
): AccountEditResult {
  const companyId = accountEditCompanyId(account, fallbackCompanyId);
  if (companyId == null) return { ok: false, reason: 'noCompany' };
  if (values == null) return { ok: false, reason: 'invalid' };
  const name = text(values.name);
  const code = text(values.code);
  if (name === '' || code === '') return { ok: false, reason: 'invalid' };

  const current = accountEditDefaults(account);
  const wire: Row = { companyId, internalGroup: { none: [] }, internalType: { none: [] } };
  let changed = false;
  if (name !== current.name) {
    wire.name = name;
    changed = true;
  }
  if (code !== current.code) {
    wire.code = code;
    changed = true;
  }
  if (Boolean(values.deprecated) !== current.deprecated) {
    wire.deprecated = Boolean(values.deprecated);
    changed = true;
  }
  if (Boolean(values.reconcile) !== current.reconcile) {
    wire.reconcile = Boolean(values.reconcile);
    changed = true;
  }
  const note = text(values.note);
  if (note !== current.note) {
    wire.note = { some: note === '' ? { none: [] } : { some: note } };
    changed = true;
  }
  const internalType = String(values.internalType ?? '');
  if (internalType !== '' && internalType !== current.internalType) {
    if (!(ACCOUNT_INTERNAL_TYPES as readonly string[]).includes(internalType)) return { ok: false, reason: 'invalid' };
    wire.internalType = { some: { [internalType.charAt(0).toLowerCase() + internalType.slice(1)]: [] } };
    changed = true;
  }
  if (!changed) return { ok: false, reason: 'unchanged' };
  return { ok: true, params: wire as unknown as UpdateAccountAccountParams };
}

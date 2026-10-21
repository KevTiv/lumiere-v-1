import { unwrapSome } from '@lumiere/erp-shared/form-coercion';
import { variantTag } from '@lumiere/erp-workflows';

import { NONE, cellId, cellText, change, optId, optText, set, type Opt, type Row } from './tax-setup-wire';

/** Largest `sequence` (u32) the reducer accepts. */
const MAX_SEQUENCE = 4294967295;

/** The group role each optional account must have (`validate_tax_group_accounts`). */
export type TaxGroupAccountRole = 'payable' | 'receivable' | 'advance';
const ROLE_GROUP: Record<TaxGroupAccountRole, 'Liability' | 'Asset'> = {
  payable: 'Liability',
  receivable: 'Asset',
  advance: 'Asset',
};

/** Reducer body of `create_account_tax_group` (`CreateAccountTaxGroupParams`). */
export type TaxGroupCreateParams = {
  name: string;
  sequence: number;
  precedingSubtotal: Opt<string>;
  taxPayableAccountId: Opt<bigint>;
  taxReceivableAccountId: Opt<bigint>;
  advanceTaxPaymentAccountId: Opt<bigint>;
  metadata: { none: [] };
};

/** Reducer body of `update_account_tax_group` (`UpdateAccountTaxGroupParams`); `none` leaves a field alone. */
export type TaxGroupUpdateParams = {
  name: Opt<string>;
  sequence: Opt<number>;
  precedingSubtotal: Opt<Opt<string>>;
  taxPayableAccountId: Opt<Opt<bigint>>;
  taxReceivableAccountId: Opt<Opt<bigint>>;
  advanceTaxPaymentAccountId: Opt<Opt<bigint>>;
  metadata: { none: [] };
};

export type TaxGroupUpdateResult =
  | { ok: true; params: TaxGroupUpdateParams }
  | { ok: false; reason: 'invalid' | 'unchanged' };

/** Whole number in 0..u32 max, else null (a blank or fractional value is invalid). */
export function parseTaxGroupSequence(raw: unknown): number | null {
  const text = String(raw ?? '').trim();
  if (text === '' || !/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n <= MAX_SEQUENCE ? n : null;
}

/**
 * `create_account_tax_group` (account_tax_group:create) body from the form; null without a name or
 * with a sequence that is not a whole number. The company is the hook's, not part of the body.
 */
export function toTaxGroupCreateParams(values: Row | null | undefined): TaxGroupCreateParams | null {
  if (values == null) return null;
  const name = cellText(values.name);
  const sequence = parseTaxGroupSequence(values.sequence);
  if (name === '' || sequence == null) return null;
  return {
    name,
    sequence,
    precedingSubtotal: optText(values.precedingSubtotal),
    taxPayableAccountId: optId(values.taxPayableAccountId),
    taxReceivableAccountId: optId(values.taxReceivableAccountId),
    advanceTaxPaymentAccountId: optId(values.advanceTaxPaymentAccountId),
    metadata: NONE,
  };
}

/** Current values of the editable fields, as the edit form shows them. */
export function taxGroupEditDefaults(group: Row): {
  name: string;
  sequence: number;
  precedingSubtotal: string;
  taxPayableAccountId: string;
  taxReceivableAccountId: string;
  advanceTaxPaymentAccountId: string;
} {
  const sequence = Number(cellText(group.sequence));
  const idText = (v: unknown) => cellId(v)?.toString() ?? '';
  return {
    name: cellText(group.name),
    sequence: Number.isFinite(sequence) ? sequence : 0,
    precedingSubtotal: cellText(group.precedingSubtotal ?? group.preceding_subtotal),
    taxPayableAccountId: idText(group.taxPayableAccountId ?? group.tax_payable_account_id),
    taxReceivableAccountId: idText(group.taxReceivableAccountId ?? group.tax_receivable_account_id),
    advanceTaxPaymentAccountId: idText(group.advanceTaxPaymentAccountId ?? group.advance_tax_payment_account_id),
  };
}

/**
 * `update_account_tax_group` (account_tax_group:write) body: only fields that differ from the row are
 * sent. A cleared subtotal or account is sent as `some(none)` (the reducer's "clear" form).
 */
export function toTaxGroupUpdateParams(values: Row | null | undefined, group: Row): TaxGroupUpdateResult {
  if (values == null) return { ok: false, reason: 'invalid' };
  const name = cellText(values.name);
  const sequence = parseTaxGroupSequence(values.sequence);
  if (name === '' || sequence == null) return { ok: false, reason: 'invalid' };

  const current = taxGroupEditDefaults(group);
  let changed = false;
  const params: TaxGroupUpdateParams = {
    name: NONE,
    sequence: NONE,
    precedingSubtotal: NONE,
    taxPayableAccountId: NONE,
    taxReceivableAccountId: NONE,
    advanceTaxPaymentAccountId: NONE,
    metadata: NONE,
  };
  if (name !== current.name) {
    params.name = set(name);
    changed = true;
  }
  if (sequence !== current.sequence) {
    params.sequence = set(sequence);
    changed = true;
  }
  const subtotal = cellText(values.precedingSubtotal);
  if (subtotal !== current.precedingSubtotal) {
    params.precedingSubtotal = change(optText(subtotal));
    changed = true;
  }
  for (const key of ['taxPayableAccountId', 'taxReceivableAccountId', 'advanceTaxPaymentAccountId'] as const) {
    const next = cellId(values[key])?.toString() ?? '';
    if (next !== current[key]) {
      params[key] = change(optId(values[key]));
      changed = true;
    }
  }
  return changed ? { ok: true, params } : { ok: false, reason: 'unchanged' };
}

/**
 * Select options for one account role: active accounts of the company in the group the reducer
 * requires (liability for tax payable, asset for receivable and advance payment).
 */
export function taxGroupAccountOptions(
  accounts: readonly Row[],
  role: TaxGroupAccountRole,
  companyId: bigint,
): { value: string; label: string }[] {
  const wanted = ROLE_GROUP[role];
  const out: { value: string; label: string }[] = [];
  for (const account of accounts) {
    const id = cellId(account.id);
    if (id == null || account.deprecated === true) continue;
    const own = cellId(account.companyId ?? account.company_id);
    if (own != null && own !== companyId) continue;
    if (variantTag(unwrapSome(account.internalGroup ?? account.internal_group)) !== wanted) continue;
    const code = cellText(account.code);
    const name = cellText(account.name);
    out.push({ value: id.toString(), label: code === '' ? name : `${code} ${name}` });
  }
  return out;
}

/** Edit applies only to groups of the company the hook is bound to (the reducer checks the group's company). */
export function canEditTaxGroup(group: Row, companyId: bigint): boolean {
  const own = cellId(group.companyId ?? group.company_id);
  return own != null && own === companyId;
}

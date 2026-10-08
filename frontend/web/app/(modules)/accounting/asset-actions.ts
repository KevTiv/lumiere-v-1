import { stbTimestampFromDate } from '@lumiere/erp-shared/stb-timestamp';
import { variantTag } from '@lumiere/erp-workflows';
import type { CreateAccountAssetParams, UpdateAccountAssetParams } from '@lumiere/stdb/types';
import type { Timestamp } from 'spacetimedb';

import { statementDateInput } from './bank-statement-actions';
import { NONE, cellId, cellText, change, optId, set, type Opt, type Row } from './tax-setup-wire';

/**
 * Fixed asset create / edit. `CreateAccountAssetParams` / `UpdateAccountAssetParams` are only
 * partly in the encoder's option-field table (`method` is missing, and it turns numbers <= 0 into
 * `none`), so every `Option` field is spelled out here as SATS `{some}` / `{none: []}`
 * (`Option<Option<T>>` is a `some` around either). Rules mirror `create_account_asset` /
 * `update_account_asset` in `spacetimedb/src/accounting/fixed_assets.rs`.
 */

/** `AssetType` variants, in the order the form lists them. */
export const ASSET_TYPES = ['Purchase', 'Sale'] as const;
/** `DepreciationMethod` variants, in the order the form lists them. */
export const DEPRECIATION_METHODS = ['Linear', 'Degressive', 'DegressiveThenLinear'] as const;

export type AssetTypeTag = (typeof ASSET_TYPES)[number];
export type DepreciationMethodTag = (typeof DEPRECIATION_METHODS)[number];

/** Account groups the reducer requires for each asset account role. */
export const ASSET_ACCOUNT_GROUPS = {
  asset: ['Asset'],
  depreciation: ['Asset'],
  expense: ['Expense'],
  gain: ['Income'],
  loss: ['Expense'],
  disposal: ['Asset'],
} as const;

export type AssetAccountRole = keyof typeof ASSET_ACCOUNT_GROUPS;

export type AssetFailure =
  | 'name'
  | 'code'
  | 'assetType'
  | 'currency'
  | 'originalValue'
  | 'salvageValue'
  | 'method'
  | 'methodNumber'
  | 'methodPeriod'
  | 'progressFactor'
  | 'acquisitionDate'
  | 'firstDepreciationDate'
  | 'journal'
  | 'assetAccount'
  | 'depreciationAccount'
  | 'expenseAccount'
  | 'gainAccount'
  | 'lossAccount'
  | 'disposalAccount';

export type AssetLookups = {
  companyId: bigint;
  accounts: readonly Row[];
  journals: readonly Row[];
};

export type AssetCreateResult = { ok: true; params: CreateAccountAssetParams } | { ok: false; reason: AssetFailure };
export type AssetUpdateResult =
  | { ok: true; params: UpdateAccountAssetParams }
  | { ok: false; reason: AssetFailure | 'unchanged' };

/** Only a Draft asset can be edited (`update_account_asset`). */
export function canEditAsset(asset: Row): boolean {
  return variantTag(asset.state) === 'Draft';
}

function ownCompany(row: Row): bigint | null {
  return cellId(row.companyId ?? row.company_id);
}

/** The asset's own company (the reducer scopes by it), else the operating company; null if neither is usable. */
export function assetCompanyId(asset: Row, fallbackCompanyId: bigint): bigint | null {
  return ownCompany(asset) ?? (fallbackCompanyId > 0n ? fallbackCompanyId : null);
}

/** Active (not deprecated) accounts of the company in the groups the role needs; `keep` stays listed even if no longer valid. */
export function assetAccountOptions(
  accounts: readonly Row[],
  companyId: bigint,
  role: AssetAccountRole,
  keep = '',
  staleSuffix = '(unavailable)',
): { value: string; label: string }[] {
  const groups: readonly string[] = ASSET_ACCOUNT_GROUPS[role];
  const out: { value: string; label: string }[] = [];
  for (const account of accounts) {
    const id = cellId(account.id);
    if (id == null) continue;
    const label = [cellText(account.code), cellText(account.name)].filter(Boolean).join(' ') || String(id);
    const valid =
      ownCompany(account) === companyId &&
      account.deprecated !== true &&
      groups.includes(variantTag(account.internalGroup ?? account.internal_group));
    if (valid) out.push({ value: String(id), label });
    else if (keep !== '' && String(id) === keep) out.push({ value: String(id), label: `${label} ${staleSuffix}` });
  }
  return out;
}

/** Active General journals of the company (asset depreciation postings need a general journal). */
export function assetJournalOptions(
  journals: readonly Row[],
  companyId: bigint,
  keep = '',
  staleSuffix = '(unavailable)',
): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (const journal of journals) {
    const id = cellId(journal.id);
    if (id == null) continue;
    const label = [cellText(journal.code), cellText(journal.name)].filter(Boolean).join(' ') || String(id);
    const valid =
      ownCompany(journal) === companyId &&
      journal.active !== false &&
      variantTag(journal.type ?? journal.type_) === 'General';
    if (valid) out.push({ value: String(id), label });
    else if (keep !== '' && String(id) === keep) out.push({ value: String(id), label: `${label} ${staleSuffix}` });
  }
  return out;
}

function pick<T extends string>(raw: unknown, allowed: readonly T[]): T | null {
  const s = String(raw ?? '').trim();
  return (allowed as readonly string[]).includes(s) ? (s as T) : null;
}

function finite(raw: unknown, fallback?: number): number | null {
  const s = cellText(raw);
  if (s === '') return fallback ?? null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function wholeAtLeast(raw: unknown, min: number, fallback?: number): number | null {
  const n = finite(raw, fallback);
  return n != null && Number.isInteger(n) && n >= min && n <= 4_294_967_295 ? n : null;
}

/** A `YYYY-MM-DD` input as a timestamp; '' is absent (null), anything unreadable is invalid (undefined). */
function dateInput(raw: unknown): Timestamp | null | undefined {
  const s = cellText(raw);
  if (s === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const date = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? undefined : stbTimestampFromDate(date);
}

/** A required-account select as an id that is one of the offered options. */
function chosenAccount(
  raw: unknown,
  accounts: readonly Row[],
  companyId: bigint,
  role: AssetAccountRole,
): bigint | null {
  const id = cellId(raw);
  if (id == null) return null;
  return assetAccountOptions(accounts, companyId, role).some((o) => o.value === String(id)) ? id : null;
}

/** An optional-account select: '' is none, a value must be one of the offered options. */
function chosenOptionalAccount(
  raw: unknown,
  accounts: readonly Row[],
  companyId: bigint,
  role: AssetAccountRole,
): bigint | null | undefined {
  if (cellText(raw) === '') return null;
  return chosenAccount(raw, accounts, companyId, role) ?? undefined;
}

function chosenJournal(raw: unknown, journals: readonly Row[], companyId: bigint): bigint | null {
  const id = cellId(raw);
  if (id == null) return null;
  return assetJournalOptions(journals, companyId).some((o) => o.value === String(id)) ? id : null;
}

/** Degressive methods need a percentage factor in (0, 100]; a linear asset sends 0. */
function progressFactor(method: DepreciationMethodTag, raw: unknown): number | null {
  if (method === 'Linear') return 0;
  const n = finite(raw);
  return n != null && n > 0 && n <= 100 ? n : null;
}

/** Current values of the editable fields, as the edit form shows them. */
export function assetEditDefaults(asset: Row) {
  const method = pick(variantTag(asset.method), DEPRECIATION_METHODS) ?? 'Linear';
  return {
    name: cellText(asset.name),
    originalValue: Number(cellText(asset.originalValue ?? asset.original_value)) || 0,
    salvageValue: Number(cellText(asset.salvageValue ?? asset.salvage_value)) || 0,
    method,
    methodNumber: Number(cellText(asset.methodNumber ?? asset.method_number)) || 5,
    methodPeriod: Number(cellText(asset.methodPeriod ?? asset.method_period)) || 12,
    methodProgressFactor: Number(cellText(asset.methodProgressFactor ?? asset.method_progress_factor)) || 0,
    prorata: (asset.prorata ?? false) === true,
    accountAssetId: String(cellId(asset.accountAssetId ?? asset.account_asset_id) ?? ''),
    accountDepreciationId: String(cellId(asset.accountDepreciationId ?? asset.account_depreciation_id) ?? ''),
    accountDepreciationExpenseId: String(
      cellId(asset.accountDepreciationExpenseId ?? asset.account_depreciation_expense_id) ?? '',
    ),
    journalId: String(cellId(asset.journalId ?? asset.journal_id) ?? ''),
    gainAccountId: String(cellId(asset.gainAccountId ?? asset.gain_account_id) ?? ''),
    lossAccountId: String(cellId(asset.lossAccountId ?? asset.loss_account_id) ?? ''),
    accountDisposalId: String(cellId(asset.accountDisposalId ?? asset.account_disposal_id) ?? ''),
    firstDepreciationDate: statementDateInput(asset.firstDepreciationDate ?? asset.first_depreciation_date),
  };
}

/**
 * Params for `create_account_asset` (account_asset:create). `idempotencyKey` is generated once per
 * dialog by the caller so a resubmit of the same dialog replays instead of duplicating. Asset and
 * depreciation accounts must be in the Asset group, the expense account in the Expense group, the
 * journal a General one, and the optional gain / loss / disposal accounts in the Income / Expense /
 * Asset groups. The reducer does not compare salvage to the original value; this does (0 <= salvage
 * < original) so the asset can later be edited.
 */
export function toAssetCreateParams(
  values: Row | null | undefined,
  lookups: AssetLookups,
  idempotencyKey: string,
): AssetCreateResult {
  const fail = (reason: AssetFailure): AssetCreateResult => ({ ok: false, reason });
  if (values == null) return fail('name');
  const { accounts, journals, companyId } = lookups;
  const code = cellText(values.code);
  if (code === '') return fail('code');
  const name = cellText(values.name);
  if (name === '') return fail('name');
  const assetType = pick(values.assetType, ASSET_TYPES);
  if (assetType == null) return fail('assetType');
  const currencyId = cellId(values.currencyId);
  if (currencyId == null) return fail('currency');
  const originalValue = finite(values.originalValue);
  if (originalValue == null || originalValue <= 0) return fail('originalValue');
  const salvageValue = finite(values.salvageValue, 0);
  if (salvageValue == null || salvageValue < 0 || salvageValue >= originalValue) return fail('salvageValue');
  const method = pick(values.method, DEPRECIATION_METHODS);
  if (method == null) return fail('method');
  const methodNumber = wholeAtLeast(values.methodNumber, 1);
  if (methodNumber == null) return fail('methodNumber');
  const methodPeriod = wholeAtLeast(values.methodPeriod, 1);
  if (methodPeriod == null) return fail('methodPeriod');
  const factor = progressFactor(method, values.methodProgressFactor);
  if (factor == null) return fail('progressFactor');
  const acquisition = dateInput(values.acquisitionDate);
  if (acquisition == null) return fail('acquisitionDate');
  const firstDepreciation = dateInput(values.firstDepreciationDate);
  if (firstDepreciation === undefined) return fail('firstDepreciationDate');
  const journalId = chosenJournal(values.journalId, journals, companyId);
  if (journalId == null) return fail('journal');
  const accountAssetId = chosenAccount(values.accountAssetId, accounts, companyId, 'asset');
  if (accountAssetId == null) return fail('assetAccount');
  const accountDepreciationId = chosenAccount(values.accountDepreciationId, accounts, companyId, 'depreciation');
  if (accountDepreciationId == null) return fail('depreciationAccount');
  const accountDepreciationExpenseId = chosenAccount(
    values.accountDepreciationExpenseId,
    accounts,
    companyId,
    'expense',
  );
  if (accountDepreciationExpenseId == null) return fail('expenseAccount');
  const gain = chosenOptionalAccount(values.gainAccountId, accounts, companyId, 'gain');
  if (gain === undefined) return fail('gainAccount');
  const loss = chosenOptionalAccount(values.lossAccountId, accounts, companyId, 'loss');
  if (loss === undefined) return fail('lossAccount');
  const disposal = chosenOptionalAccount(values.accountDisposalId, accounts, companyId, 'disposal');
  if (disposal === undefined) return fail('disposalAccount');

  const wire = {
    idempotencyKey,
    code,
    name,
    active: true,
    assetType: { tag: assetType },
    currencyId,
    originalValue,
    salvageValue,
    method: { tag: method },
    methodNumber,
    methodPeriod,
    methodProgressFactor: factor,
    prorata: Boolean(values.prorata),
    prorataDate: NONE,
    accountAssetId,
    accountDepreciationId,
    accountDepreciationExpenseId,
    journalId,
    acquisitionDate: acquisition,
    accountAnalyticId: NONE,
    parentId: NONE,
    gainAccountId: optId(gain),
    lossAccountId: optId(loss),
    accountDisposalId: optId(disposal),
    firstDepreciationDate: firstDepreciation == null ? NONE : set(firstDepreciation),
    firstDepreciationDateManual: NONE,
    alreadyDepreciatedAmountImport: 0,
    isImported: false,
    accountAnalyticTagIds: [] as bigint[],
    assetLifetimeDays: 0,
    assetPausedDays: 0,
    depreciationSchedule: NONE,
    metadata: NONE,
  };
  return { ok: true, params: wire as unknown as CreateAccountAssetParams };
}

/**
 * Params for `update_account_asset` (account_asset:write, Draft assets only). Only changed fields
 * are `some`; every other field is `none` and keeps its value. Optional accounts and the first
 * depreciation date are `Option<Option<T>>`, so clearing one is `some(none)`. The reducer only
 * checks salvage when salvage itself is sent, so the effective original / salvage pair is checked
 * here (original > 0, 0 <= salvage < original).
 */
export function toAssetUpdateParams(
  values: Row | null | undefined,
  asset: Row,
  lookups: AssetLookups,
): AssetUpdateResult {
  const fail = (reason: AssetFailure): AssetUpdateResult => ({ ok: false, reason });
  if (values == null) return fail('name');
  if (!canEditAsset(asset)) return fail('name');
  const { accounts, journals, companyId } = lookups;
  const current = assetEditDefaults(asset);
  const wire = {
    name: NONE as Opt<string>,
    originalValue: NONE as Opt<number>,
    salvageValue: NONE as Opt<number>,
    method: NONE as Opt<{ tag: DepreciationMethodTag }>,
    methodNumber: NONE as Opt<number>,
    methodPeriod: NONE as Opt<number>,
    methodProgressFactor: NONE as Opt<number>,
    prorata: NONE as Opt<boolean>,
    prorataDate: NONE as Opt<Opt<Timestamp>>,
    accountAnalyticId: NONE as Opt<Opt<bigint>>,
    accountAssetId: NONE as Opt<bigint>,
    accountDepreciationId: NONE as Opt<bigint>,
    accountDepreciationExpenseId: NONE as Opt<bigint>,
    journalId: NONE as Opt<bigint>,
    gainAccountId: NONE as Opt<Opt<bigint>>,
    lossAccountId: NONE as Opt<Opt<bigint>>,
    accountDisposalId: NONE as Opt<Opt<bigint>>,
    firstDepreciationDate: NONE as Opt<Opt<Timestamp>>,
    firstDepreciationDateManual: NONE as Opt<Opt<Timestamp>>,
    accountAnalyticTagIds: NONE as Opt<bigint[]>,
    metadata: NONE as Opt<Opt<string>>,
  };
  let changed = false;

  const name = cellText(values.name);
  if (name === '') return fail('name');
  if (name !== current.name) {
    wire.name = set(name);
    changed = true;
  }

  const originalValue = finite(values.originalValue);
  if (originalValue == null || originalValue <= 0) return fail('originalValue');
  const salvageValue = finite(values.salvageValue, 0);
  if (salvageValue == null || salvageValue < 0 || salvageValue >= originalValue) return fail('salvageValue');
  if (originalValue !== current.originalValue) {
    wire.originalValue = set(originalValue);
    changed = true;
  }
  if (salvageValue !== current.salvageValue) {
    wire.salvageValue = set(salvageValue);
    changed = true;
  }

  const method = pick(values.method, DEPRECIATION_METHODS);
  if (method == null) return fail('method');
  if (method !== current.method) {
    wire.method = set({ tag: method });
    changed = true;
  }
  const methodNumber = wholeAtLeast(values.methodNumber, 1);
  if (methodNumber == null) return fail('methodNumber');
  if (methodNumber !== current.methodNumber) {
    wire.methodNumber = set(methodNumber);
    changed = true;
  }
  const methodPeriod = wholeAtLeast(values.methodPeriod, 1);
  if (methodPeriod == null) return fail('methodPeriod');
  if (methodPeriod !== current.methodPeriod) {
    wire.methodPeriod = set(methodPeriod);
    changed = true;
  }
  const factor = progressFactor(method, values.methodProgressFactor);
  if (factor == null) return fail('progressFactor');
  if (factor !== current.methodProgressFactor) {
    wire.methodProgressFactor = set(factor);
    changed = true;
  }
  const prorata = Boolean(values.prorata);
  if (prorata !== current.prorata) {
    wire.prorata = set(prorata);
    changed = true;
  }

  const journalId = chosenJournalOrCurrent(values.journalId, current.journalId, journals, companyId);
  if (journalId == null) return fail('journal');
  if (String(journalId) !== current.journalId) {
    wire.journalId = set(journalId);
    changed = true;
  }

  const required: [AssetAccountRole, unknown, string, AssetFailure][] = [
    ['asset', values.accountAssetId, current.accountAssetId, 'assetAccount'],
    ['depreciation', values.accountDepreciationId, current.accountDepreciationId, 'depreciationAccount'],
    ['expense', values.accountDepreciationExpenseId, current.accountDepreciationExpenseId, 'expenseAccount'],
  ];
  const requiredKeys = ['accountAssetId', 'accountDepreciationId', 'accountDepreciationExpenseId'] as const;
  for (const [index, [role, raw, was, reason]] of required.entries()) {
    // An unchanged value is always accepted; the reducer re-validates the effective account anyway.
    const id = cellText(raw) === was ? cellId(was) : chosenAccount(raw, accounts, companyId, role);
    if (id == null) return fail(reason);
    if (String(id) !== was) {
      wire[requiredKeys[index]!] = set(id);
      changed = true;
    }
  }

  const optional: [AssetAccountRole, unknown, string, AssetFailure, 'gainAccountId' | 'lossAccountId' | 'accountDisposalId'][] = [
    ['gain', values.gainAccountId, current.gainAccountId, 'gainAccount', 'gainAccountId'],
    ['loss', values.lossAccountId, current.lossAccountId, 'lossAccount', 'lossAccountId'],
    ['disposal', values.accountDisposalId, current.accountDisposalId, 'disposalAccount', 'accountDisposalId'],
  ];
  for (const [role, raw, was, reason, key] of optional) {
    if (cellText(raw) === was) continue;
    const id = chosenOptionalAccount(raw, accounts, companyId, role);
    if (id === undefined) return fail(reason);
    wire[key] = change(optId(id));
    changed = true;
  }

  const firstDepreciation = dateInput(values.firstDepreciationDate);
  if (firstDepreciation === undefined) return fail('firstDepreciationDate');
  if (cellText(values.firstDepreciationDate) !== current.firstDepreciationDate) {
    wire.firstDepreciationDate = change(firstDepreciation == null ? NONE : set(firstDepreciation));
    changed = true;
  }

  if (!changed) return { ok: false, reason: 'unchanged' };
  return { ok: true, params: wire as unknown as UpdateAccountAssetParams };
}

/** Unchanged journal passes; a different one must be an active General journal of the company. */
function chosenJournalOrCurrent(
  raw: unknown,
  was: string,
  journals: readonly Row[],
  companyId: bigint,
): bigint | null {
  if (cellText(raw) === was) return cellId(was);
  return chosenJournal(raw, journals, companyId);
}

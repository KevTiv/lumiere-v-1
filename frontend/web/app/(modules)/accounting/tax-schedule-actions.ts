import { unwrapSome } from '@lumiere/erp-shared/form-coercion';
import { stbTimestampFromDate } from '@lumiere/erp-shared/stb-timestamp';
import type { Timestamp } from 'spacetimedb';

import { deadlineDateInput } from './tax-deadline-actions';
import { NONE, cellId, cellText, change, optId, optText, set, type Opt, type Row } from './tax-setup-wire';

/** Reducer body of `create_tax_schedule` (`CreateTaxScheduleParams`). The company is the hook's. */
export type TaxScheduleCreateParams = {
  name: string;
  description: Opt<string>;
  jurisdictionId: Opt<bigint>;
  taxIds: bigint[];
  isActive: boolean;
  effectiveFrom: Opt<Timestamp>;
  effectiveTo: Opt<Timestamp>;
  metadata: { none: [] };
};

/** Reducer body of `update_tax_schedule` (`UpdateTaxScheduleParams`); `none` leaves a field alone. */
export type TaxScheduleUpdateParams = {
  name: Opt<string>;
  description: Opt<Opt<string>>;
  jurisdictionId: Opt<Opt<bigint>>;
  taxIds: Opt<bigint[]>;
  isActive: Opt<boolean>;
  effectiveFrom: Opt<Opt<Timestamp>>;
  effectiveTo: Opt<Opt<Timestamp>>;
  metadata: { none: [] };
};

export type TaxScheduleUpdateResult =
  | { ok: true; params: TaxScheduleUpdateParams }
  | { ok: false; reason: 'invalid' | 'unchanged' };

/** Distinct positive tax ids, in order (the reducer rejects a duplicated tax). Accepts the multi-select array. */
export function scheduleTaxIds(raw: unknown): bigint[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: bigint[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const id = cellId(item);
    if (id == null || seen.has(id.toString())) continue;
    seen.add(id.toString());
    out.push(id);
  }
  return out;
}

/** An optional date input as an `Option<Timestamp>`; `undefined` when the text is not a real date. */
function optDate(raw: unknown): Opt<Timestamp> | undefined {
  const text = cellText(raw);
  if (text === '') return NONE;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : { some: stbTimestampFromDate(date) };
}

/**
 * `create_tax_schedule` (tax_schedule:create) body; null without a name or with an unreadable date.
 * The reducer accepts a schedule without taxes, so an empty selection is allowed.
 */
export function toTaxScheduleCreateParams(values: Row | null | undefined): TaxScheduleCreateParams | null {
  if (values == null) return null;
  const name = cellText(values.name);
  const effectiveFrom = optDate(values.effectiveFrom);
  const effectiveTo = optDate(values.effectiveTo);
  if (name === '' || effectiveFrom === undefined || effectiveTo === undefined) return null;
  return {
    name,
    description: optText(values.description),
    jurisdictionId: optId(values.jurisdictionId),
    taxIds: scheduleTaxIds(values.taxIds),
    isActive: values.isActive !== false,
    effectiveFrom,
    effectiveTo,
    metadata: NONE,
  };
}

/** Current values of the editable fields, as the edit form shows them. */
export function taxScheduleEditDefaults(schedule: Row): {
  name: string;
  description: string;
  jurisdictionId: string;
  taxIds: string[];
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string;
} {
  const rawIds = schedule.taxIds ?? schedule.tax_ids;
  return {
    name: cellText(schedule.name),
    description: cellText(schedule.description),
    jurisdictionId: cellId(schedule.jurisdictionId ?? schedule.jurisdiction_id)?.toString() ?? '',
    taxIds: scheduleTaxIds(rawIds).map(String),
    isActive: (schedule.isActive ?? schedule.is_active) !== false,
    effectiveFrom: deadlineDateInput(unwrapSome(schedule.effectiveFrom ?? schedule.effective_from)),
    effectiveTo: deadlineDateInput(unwrapSome(schedule.effectiveTo ?? schedule.effective_to)),
  };
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');
}

/**
 * `update_tax_schedule` (tax_schedule:write) body: only fields that differ from the row are sent.
 * A blanked description, jurisdiction or date is sent as `some(none)`; the tax list is replaced
 * as a whole, and only when the selection changed.
 */
export function toTaxScheduleUpdateParams(values: Row | null | undefined, schedule: Row): TaxScheduleUpdateResult {
  if (values == null) return { ok: false, reason: 'invalid' };
  const name = cellText(values.name);
  const effectiveFrom = optDate(values.effectiveFrom);
  const effectiveTo = optDate(values.effectiveTo);
  if (name === '' || effectiveFrom === undefined || effectiveTo === undefined) return { ok: false, reason: 'invalid' };

  const current = taxScheduleEditDefaults(schedule);
  let changed = false;
  const params: TaxScheduleUpdateParams = {
    name: NONE,
    description: NONE,
    jurisdictionId: NONE,
    taxIds: NONE,
    isActive: NONE,
    effectiveFrom: NONE,
    effectiveTo: NONE,
    metadata: NONE,
  };
  if (name !== current.name) {
    params.name = set(name);
    changed = true;
  }
  if (cellText(values.description) !== current.description) {
    params.description = change(optText(values.description));
    changed = true;
  }
  const jurisdiction = cellId(values.jurisdictionId)?.toString() ?? '';
  if (jurisdiction !== current.jurisdictionId) {
    params.jurisdictionId = change(optId(values.jurisdictionId));
    changed = true;
  }
  const taxIds = scheduleTaxIds(values.taxIds);
  if (!sameIds(taxIds.map(String), current.taxIds)) {
    params.taxIds = set(taxIds);
    changed = true;
  }
  const isActive = values.isActive !== false;
  if (isActive !== current.isActive) {
    params.isActive = set(isActive);
    changed = true;
  }
  if (cellText(values.effectiveFrom) !== current.effectiveFrom) {
    params.effectiveFrom = change(effectiveFrom);
    changed = true;
  }
  if (cellText(values.effectiveTo) !== current.effectiveTo) {
    params.effectiveTo = change(effectiveTo);
    changed = true;
  }
  return changed ? { ok: true, params } : { ok: false, reason: 'unchanged' };
}

/**
 * Taxes the schedule form can pick: active taxes of the company (`require_active_tax_ids`), plus any
 * already selected tax that has since been deactivated, labelled so it stays visible and removable.
 */
export function scheduleTaxOptions(
  taxes: readonly Row[],
  companyId: bigint,
  selected: readonly string[],
  inactiveSuffix: string,
): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (const tax of taxes) {
    const id = cellId(tax.id);
    if (id == null) continue;
    const own = cellId(tax.companyId ?? tax.company_id);
    if (own != null && own !== companyId) continue;
    const active = tax.active !== false;
    if (!active && !selected.includes(id.toString())) continue;
    const name = cellText(tax.name);
    out.push({ value: id.toString(), label: active ? name : `${name} ${inactiveSuffix}` });
  }
  return out;
}

/** Jurisdictions a schedule may link to: active ones (`validate_tax_jurisdiction`) plus the current link. */
export function scheduleJurisdictionOptions(
  jurisdictions: readonly Row[],
  currentId: string,
  inactiveSuffix: string,
): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (const j of jurisdictions) {
    const id = cellId(j.id);
    if (id == null) continue;
    const active = (j.isActive ?? j.is_active) !== false;
    if (!active && id.toString() !== currentId) continue;
    const name = cellText(j.name);
    const code = cellText(j.code);
    const label = code === '' ? name : `${name} (${code})`;
    out.push({ value: id.toString(), label: active ? label : `${label} ${inactiveSuffix}` });
  }
  return out;
}

/** Edit applies only to schedules of the company the hook is bound to (the reducer checks the schedule's company). */
export function canEditTaxSchedule(schedule: Row, companyId: bigint): boolean {
  const own = cellId(schedule.companyId ?? schedule.company_id);
  return own != null && own === companyId;
}

import { optionalBigIntU64 } from '@lumiere/erp-shared/form-coercion';
import { stbTimestampFromDate } from '@lumiere/erp-shared/stb-timestamp';
import type { Timestamp } from 'spacetimedb';

type Row = Record<string, unknown>;

/** Rate types `set_consolidation_company_rate` accepts. */
export const CONSOLIDATION_RATE_TYPES = ['average', 'spot', 'historical'] as const;
export type ConsolidationRateType = (typeof CONSOLIDATION_RATE_TYPES)[number];

/**
 * Body of `set_consolidation_company_rate` (`SetConsolidationCompanyRateParams`). The hook encodes
 * it without a struct name, so the one `Option` field, `metadata`, is spelled as SATS `none`.
 * The reducer upserts by company and period: an existing rate keeps its currency and takes the
 * new rate, type and effective date.
 */
export type ConsolidationRateParams = {
  companyId: bigint;
  periodId: bigint;
  currencyId: bigint;
  exchangeRate: number;
  rateType: ConsolidationRateType;
  effectiveDate: Timestamp;
  metadata: { none: [] };
};

function positiveId(raw: unknown): bigint | null {
  const id = optionalBigIntU64(raw);
  return id != null && id > 0n ? id : null;
}

/** Null unless every field is valid: ids chosen, rate a finite number above zero, a real date. */
export function toConsolidationRateParams(values: Row | null | undefined): ConsolidationRateParams | null {
  if (values == null) return null;
  const companyId = positiveId(values.companyId);
  const periodId = positiveId(values.periodId);
  const currencyId = positiveId(values.currencyId);
  if (companyId == null || periodId == null || currencyId == null) return null;

  const rateText = String(values.exchangeRate ?? '').trim();
  const exchangeRate = rateText === '' ? Number.NaN : Number(rateText);
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) return null;

  const rateType = String(values.rateType ?? '');
  if (!(CONSOLIDATION_RATE_TYPES as readonly string[]).includes(rateType)) return null;

  const dateText = String(values.effectiveDate ?? '').trim();
  const date = dateText === '' ? null : new Date(dateText);
  if (date == null || Number.isNaN(date.getTime())) return null;

  return {
    companyId,
    periodId,
    currencyId,
    exchangeRate,
    rateType: rateType as ConsolidationRateType,
    effectiveDate: stbTimestampFromDate(date),
    metadata: { none: [] },
  };
}

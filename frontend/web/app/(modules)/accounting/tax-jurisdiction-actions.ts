import { NONE, cellText, change, optText, set, type Opt, type Row } from './tax-setup-wire';

/** The optional location fields, in the order the form and table list them. */
export const JURISDICTION_LOCATION_KEYS = ['stateCode', 'countyCode', 'city', 'zipFrom', 'zipTo'] as const;

/** Reducer body of `create_tax_jurisdiction` (`CreateTaxJurisdictionParams`). */
export type TaxJurisdictionCreateParams = {
  name: string;
  code: string;
  countryCode: string;
  stateCode: Opt<string>;
  countyCode: Opt<string>;
  city: Opt<string>;
  zipFrom: Opt<string>;
  zipTo: Opt<string>;
  isActive: boolean;
  metadata: { none: [] };
};

/** Reducer body of `update_tax_jurisdiction` (`UpdateTaxJurisdictionParams`); `none` leaves a field alone. */
export type TaxJurisdictionUpdateParams = {
  name: Opt<string>;
  code: Opt<string>;
  stateCode: Opt<Opt<string>>;
  countyCode: Opt<Opt<string>>;
  city: Opt<Opt<string>>;
  zipFrom: Opt<Opt<string>>;
  zipTo: Opt<Opt<string>>;
  isActive: Opt<boolean>;
  metadata: { none: [] };
};

export type TaxJurisdictionUpdateResult =
  | { ok: true; params: TaxJurisdictionUpdateParams }
  | { ok: false; reason: 'invalid' | 'unchanged' };

/**
 * `create_tax_jurisdiction` (tax_jurisdiction:create) body; null without a name, code and country
 * code. The country code is matched against the country list exactly, and those are upper case.
 */
export function toTaxJurisdictionCreateParams(values: Row | null | undefined): TaxJurisdictionCreateParams | null {
  if (values == null) return null;
  const name = cellText(values.name);
  const code = cellText(values.code);
  const countryCode = cellText(values.countryCode).toUpperCase();
  if (name === '' || code === '' || countryCode === '') return null;
  return {
    name,
    code,
    countryCode,
    stateCode: optText(values.stateCode),
    countyCode: optText(values.countyCode),
    city: optText(values.city),
    zipFrom: optText(values.zipFrom),
    zipTo: optText(values.zipTo),
    isActive: values.isActive !== false,
    metadata: NONE,
  };
}

/** Current values of the editable fields, as the edit form shows them. */
export function taxJurisdictionEditDefaults(row: Row): {
  name: string;
  code: string;
  countryCode: string;
  stateCode: string;
  countyCode: string;
  city: string;
  zipFrom: string;
  zipTo: string;
  isActive: boolean;
} {
  const pick = (camel: string, snake: string) => cellText(row[camel] ?? row[snake]);
  return {
    name: cellText(row.name),
    code: cellText(row.code),
    countryCode: pick('countryCode', 'country_code'),
    stateCode: pick('stateCode', 'state_code'),
    countyCode: pick('countyCode', 'county_code'),
    city: cellText(row.city),
    zipFrom: pick('zipFrom', 'zip_from'),
    zipTo: pick('zipTo', 'zip_to'),
    isActive: (row.isActive ?? row.is_active) !== false,
  };
}

/**
 * `update_tax_jurisdiction` (tax_jurisdiction:write) body: only fields that differ from the row are
 * sent; a blanked location field is sent as `some(none)` so the reducer clears it. The country
 * cannot be changed by the reducer, so it is not part of the edit.
 */
export function toTaxJurisdictionUpdateParams(
  values: Row | null | undefined,
  row: Row,
): TaxJurisdictionUpdateResult {
  if (values == null) return { ok: false, reason: 'invalid' };
  const name = cellText(values.name);
  const code = cellText(values.code);
  if (name === '' || code === '') return { ok: false, reason: 'invalid' };

  const current = taxJurisdictionEditDefaults(row);
  let changed = false;
  const params: TaxJurisdictionUpdateParams = {
    name: NONE,
    code: NONE,
    stateCode: NONE,
    countyCode: NONE,
    city: NONE,
    zipFrom: NONE,
    zipTo: NONE,
    isActive: NONE,
    metadata: NONE,
  };
  if (name !== current.name) {
    params.name = set(name);
    changed = true;
  }
  if (code !== current.code) {
    params.code = set(code);
    changed = true;
  }
  for (const key of JURISDICTION_LOCATION_KEYS) {
    const next = cellText(values[key]);
    if (next !== current[key]) {
      params[key] = change(optText(next));
      changed = true;
    }
  }
  const isActive = values.isActive !== false;
  if (isActive !== current.isActive) {
    params.isActive = set(isActive);
    changed = true;
  }
  return changed ? { ok: true, params } : { ok: false, reason: 'unchanged' };
}

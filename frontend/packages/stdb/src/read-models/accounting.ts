import { primaryLabel } from "./primary-label";

/** Fields used by accounting labels; generated projection rows may omit any display field. */
export type AccountingQueryRow = {
  id?: unknown
  code?: unknown
  name?: unknown
  displayName?: unknown
  partnerName?: unknown
  companyName?: unknown
  contactName?: unknown
  symbol?: unknown
  currencyName?: unknown
  currency_name?: unknown
  legalName?: unknown
  ref?: unknown
  reference?: unknown
  number?: unknown
  invoiceNumber?: unknown
  invoice_number?: unknown
  clientOrderRef?: unknown
  client_order_ref?: unknown
}

export type AccountingAccountQueryRow = AccountingQueryRow;

function trimScalar(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "bigint") return String(value).trim();
  return String(value).trim();
}

function fallbackIdLabel(id: unknown): string {
  if (typeof id === "number" || typeof id === "bigint") return `#${id}`;
  if (typeof id === "string" && id.trim() !== "") return `#${id.trim()}`;
  return "";
}

/** Stable string key for u64 / string / bigint FK cells. */
export function accountingRelationIdKey(id: unknown): string {
  if (id == null) return "";
  if (typeof id === "object" && !Array.isArray(id)) {
    const o = id as Record<string, unknown>;
    if ("some" in o) return accountingRelationIdKey(o.some);
    if ("none" in o) return "";
  }
  return String(id).trim();
}

/**
 * Resolve a foreign-key cell through a prebuilt ID→label map.
 * Missing/empty IDs render as "—"; unknown IDs fall back to `#id`.
 */
export function resolveAccountingRelationLabel(
  id: unknown,
  labelMap?: ReadonlyMap<string, string>,
): string {
  const key = accountingRelationIdKey(id);
  if (!key) return "—";
  const mapped = labelMap?.get(key)?.trim();
  if (mapped) return mapped;
  return `#${key}`;
}

/** Build one Map from already-subscribed rows (call once per entity type — avoid N+1). */
export function buildAccountingLabelMap(
  rows: readonly AccountingQueryRow[],
  labelOf: (row: AccountingQueryRow) => string,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const key = accountingRelationIdKey(row.id);
    if (!key) continue;
    const label = labelOf(row).trim();
    if (label) map.set(key, label);
  }
  return map;
}

/** Single-cell label for chart-of-accounts rows (code + name). */
export function chartAccountPrimaryLabel(row: AccountingAccountQueryRow): string {
  const code = trimScalar(row.code);
  const name = trimScalar(row.name);
  const combined = [code, name].filter((s) => s.length > 0).join(" ");
  if (combined) return combined;
  return fallbackIdLabel(row.id);
}

/** Journal picker / list label (code + name). */
export function accountJournalPrimaryLabel(row: AccountingQueryRow): string {
  const code = trimScalar(row.code);
  const name = trimScalar(row.name);
  const combined = [code, name].filter((s) => s.length > 0).join(" ");
  if (combined) return combined;
  return fallbackIdLabel(row.id);
}

/** Partner / contact label for accounting FK columns (live map; not invoice snapshots). */
export function accountingPartnerPrimaryLabel(row: AccountingQueryRow): string {
  return primaryLabel(
    [row.displayName, row.name, row.partnerName, row.companyName, row.contactName],
    row.id,
  );
}

/** Currency label (name / code / symbol). */
export function accountingCurrencyPrimaryLabel(row: AccountingQueryRow): string {
  return primaryLabel([row.name, row.code, row.symbol, row.currencyName, row.currency_name], row.id);
}

/** Company label for IC destination / company-scoped FKs. */
export function accountingCompanyPrimaryLabel(row: AccountingQueryRow): string {
  return primaryLabel([row.name, row.companyName, row.legalName], row.id);
}

/** Parent account label — same presentation as chart accounts. */
export function accountParentPrimaryLabel(row: AccountingQueryRow): string {
  return chartAccountPrimaryLabel(row);
}

/** Source document (move / sale order) label for IC originDocumentId. */
export function accountingSourceDocumentPrimaryLabel(row: AccountingQueryRow): string {
  return primaryLabel(
    [
      row.name,
      row.ref,
      row.reference,
      row.number,
      row.invoiceNumber,
      row.invoice_number,
      row.clientOrderRef,
      row.client_order_ref,
    ],
    row.id,
  );
}

/** Analytic account label (name / code) for analytic-line accountId FKs. */
export function analyticAccountPrimaryLabel(row: AccountingQueryRow): string {
  return primaryLabel([row.name, row.code, row.displayName], row.id);
}

export function buildAnalyticAccountLabelMap(
  rows: readonly AccountingQueryRow[],
): Map<string, string> {
  return buildAccountingLabelMap(rows, analyticAccountPrimaryLabel);
}

export function buildPartnerLabelMap(
  rows: readonly AccountingQueryRow[],
): Map<string, string> {
  return buildAccountingLabelMap(rows, accountingPartnerPrimaryLabel);
}

export function buildJournalLabelMap(
  rows: readonly AccountingQueryRow[],
): Map<string, string> {
  return buildAccountingLabelMap(rows, accountJournalPrimaryLabel);
}

export function buildAccountLabelMap(
  rows: readonly AccountingQueryRow[],
): Map<string, string> {
  return buildAccountingLabelMap(rows, chartAccountPrimaryLabel);
}

export function buildCurrencyLabelMap(
  rows: readonly AccountingQueryRow[],
): Map<string, string> {
  return buildAccountingLabelMap(rows, accountingCurrencyPrimaryLabel);
}

export function buildCompanyLabelMap(
  rows: readonly AccountingQueryRow[],
): Map<string, string> {
  return buildAccountingLabelMap(rows, accountingCompanyPrimaryLabel);
}

/** Parent account IDs resolve against the chart-of-accounts row set. */
export function buildParentAccountLabelMap(
  rows: readonly AccountingQueryRow[],
): Map<string, string> {
  return buildAccountingLabelMap(rows, accountParentPrimaryLabel);
}

export function buildSourceDocumentLabelMap(
  rows: readonly AccountingQueryRow[],
): Map<string, string> {
  return buildAccountingLabelMap(rows, accountingSourceDocumentPrimaryLabel);
}

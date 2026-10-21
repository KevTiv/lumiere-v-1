/**
 * Pure model behind the list-view KPI strip: tiles whose figures come from rows the module has
 * already loaded, and whose click narrows the list below to the rows behind the figure.
 */

export type KpiTone = "default" | "info" | "success" | "warning" | "destructive"

type KpiRow = Record<string, unknown>

export interface KpiTileDef {
  key: string
  label: string
  value: string | number
  hint?: string
  tone?: KpiTone
  /** Rows the figure counts; the tile filters the list to these. No predicate, no click. */
  matches?: (row: KpiRow) => boolean
}

/** Clicking the active tile clears the selection; any other tile takes it over. */
export function toggleKpiKey(current: string | null, key: string): string | null {
  return current === key ? null : key
}

/** The selection only counts while its tile still exists and can filter. */
export function activeKpiTile(tiles: readonly KpiTileDef[], activeKey: string | null): KpiTileDef | null {
  if (!activeKey) return null
  const tile = tiles.find((candidate) => candidate.key === activeKey)
  return tile?.matches ? tile : null
}

/** Rows behind the selected tile; every row when nothing (valid) is selected. */
export function filterRowsByKpi<T extends KpiRow>(
  rows: T[],
  tiles: readonly KpiTileDef[],
  activeKey: string | null,
): T[] {
  const tile = activeKpiTile(tiles, activeKey)
  return tile?.matches ? rows.filter((row) => tile.matches!(row)) : rows
}

/** Currency code of a row's amount, "" when the row names none. */
export type CurrencyOf = (row: KpiRow) => string

/** Totals per currency, never mixed: a row with no currency lands under "". */
export function sumByCurrency(
  rows: readonly KpiRow[],
  amountOf: (row: KpiRow) => number,
  currencyOf: CurrencyOf,
): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const row of rows) {
    const amount = amountOf(row)
    if (!Number.isFinite(amount)) continue
    const code = currencyOf(row)
    totals[code] = (totals[code] ?? 0) + amount
  }
  return totals
}

/** "$1,200.00" for one currency, "$1,200.00 · €300.00" for several, "—" for none. */
export function formatMoneyTotals(
  totals: Readonly<Record<string, number>>,
  format: (amount: number, currencyCode: string) => string,
): string {
  const codes = Object.keys(totals).sort()
  if (codes.length === 0) return "—"
  return codes.map((code) => format(totals[code]!, code)).join(" · ")
}

/** Looks a row's numeric currency id up in a code-by-id map; "" when unknown. */
export function currencyCodeOfRow(
  codeById: ReadonlyMap<string, string>,
  ...idKeys: string[]
): CurrencyOf {
  return (row) => {
    for (const key of idKeys) {
      let id = row[key]
      // An optional id arrives as `{ some: id }` (or null when absent).
      if (id != null && typeof id === "object" && "some" in id) id = (id as { some: unknown }).some
      if (id != null && id !== "") return codeById.get(String(id)) ?? ""
    }
    return ""
  }
}

/**
 * A timestamp cell as a Date: a Date, a `{ microsSinceUnixEpoch }` object, a number (micros or
 * milliseconds since the epoch) or an ISO string. Anything else, and non-positive numbers, is null.
 */
export function kpiDate(value: unknown): Date | null {
  if (value == null || value === "") return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  let raw: unknown = value
  if (typeof value === "object") {
    const obj = value as { microsSinceUnixEpoch?: unknown; micros_since_unix_epoch?: unknown }
    raw = obj.microsSinceUnixEpoch ?? obj.micros_since_unix_epoch
    if (raw == null) return null
  }
  if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "bigint") return null
  if (typeof raw === "string" && Number.isNaN(Number(raw))) {
    const date = new Date(raw)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return new Date(n > 1e14 ? n / 1000 : n)
}

/** True when the date is in the same calendar month (local time) as `now`. */
export function isInMonthOf(date: Date | null, now: Date): boolean {
  return date != null && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
}

export type KpiTranslate = (key: string, options?: Record<string, unknown>) => string

/** What a module's KPI helper needs besides its rows. */
export interface KpiContext {
  t: KpiTranslate
  now: Date
  /** Currency code by numeric currency id, for money figures. */
  currencyCodeById: ReadonlyMap<string, string>
}

/** An amount in its currency; a plain number when the currency is unknown (no guessed symbol). */
export function formatKpiMoney(amount: number, currencyCode: string): string {
  if (/^[A-Za-z]{3}$/.test(currencyCode)) {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode.toUpperCase() }).format(amount)
    } catch {
      // unknown ISO code: fall through to the plain number
    }
  }
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
}

/** Currency code by id from the currency rows (`{ id, code }`), inactive or code-less rows skipped. */
export function currencyCodeMap(currencies: readonly KpiRow[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of currencies) {
    const code = String(row.code ?? "").trim().toUpperCase()
    if (row.id != null && code) map.set(String(row.id), code)
  }
  return map
}

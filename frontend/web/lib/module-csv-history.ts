import type { HistoryRow } from './history-data'

/** A module view reads reviewed values and retains their original decimal text. */
export function csvFact(row: HistoryRow, keys: readonly string[]) {
  if (row.state !== 'confirmed') return undefined
  for (const key of keys) {
    const value = row.values[key]?.trim()
    if (value)
      return {
        value,
        label: row.fields.find((field) => field.key === key)?.label,
      }
  }
}

export function csvMoney(row: HistoryRow, keys: readonly string[]) {
  const fact = csvFact(row, keys)
  if (!fact) return undefined
  const currency =
    csvFact(row, ['currency_code', 'currency'])?.value ??
    fact.label?.match(/\b(RWF|USD|EUR|UGX|KES|TZS|BIF)\b/i)?.[0]
  return currency ? `${fact.value} ${currency.toUpperCase()}` : fact.value
}

export function csvQuantity(row: HistoryRow, keys: readonly string[]) {
  const fact = csvFact(row, keys)
  if (!fact) return undefined
  const unit =
    csvFact(row, ['source_unit', 'unit', 'uom'])?.value ??
    fact.label?.match(/\((kg|kgs|pcs|pieces)\)/i)?.[1]
  return unit ? `${fact.value} ${unit}` : fact.value
}

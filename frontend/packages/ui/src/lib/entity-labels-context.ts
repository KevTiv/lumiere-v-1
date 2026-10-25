import { createContext, createElement, useContext, useMemo, type ReactNode } from "react"

/** Row field name (e.g. `partnerId`) → id → display name, for tables that show a related record. */
export type EntityLabels = Readonly<Record<string, ReadonlyMap<string, string>>>

const EntityLabelsReactContext = createContext<EntityLabels | undefined>(undefined)

/** ID→name map from a select's `{ value, label }` options; blank and placeholder entries are skipped. */
export function labelsFromOptions(
  options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }> | undefined,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>()
  for (const option of options ?? []) {
    if (option.disabled || option.value === "" || option.label.trim() === "") continue
    map.set(option.value, option.label)
  }
  return map
}

/** ID→name map from rows that have an `id` and a `name` (or `code`); rows without either are skipped. */
export function labelsFromRows(
  rows: ReadonlyArray<{ id?: unknown; name?: unknown; code?: unknown }> | undefined,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>()
  for (const row of rows ?? []) {
    const label = String(row.name ?? row.code ?? "").trim()
    if (row.id != null && label) map.set(String(row.id), label)
  }
  return map
}

/**
 * Names for the related-record columns of every table beneath it. Providers nest: an inner one
 * adds to, and for the same field overrides, an outer one.
 */
export function EntityLabelsProvider({ value, children }: { value: EntityLabels; children: ReactNode }) {
  const parent = useContext(EntityLabelsReactContext)
  const merged = useMemo(() => (parent ? { ...parent, ...value } : value), [parent, value])
  return createElement(EntityLabelsReactContext.Provider, { value: merged }, children)
}

export function useEntityLabels(): EntityLabels | undefined {
  return useContext(EntityLabelsReactContext)
}

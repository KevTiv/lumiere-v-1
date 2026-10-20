"use client"

import { useEffect, useState } from "react"
export type TableDensity = "comfortable" | "compact"

/** Browser-local presentation preference; never changes row selection, queries, or filters. */
export function useTableDensity(listKey?: string) {
  const [density, setDensity] = useState<TableDensity>("comfortable")
  const [loadedKey, setLoadedKey] = useState<string | undefined>()
  useEffect(() => {
    let next: TableDensity = "comfortable"
    try {
      if (listKey && localStorage.getItem(`${listKey}:density`) === "compact") next = "compact"
    } catch { /* Storage can be unavailable. */ }
    setDensity(next)
    setLoadedKey(listKey)
  }, [listKey])
  useEffect(() => {
    if (!listKey || loadedKey !== listKey) return
    try { localStorage.setItem(`${listKey}:density`, density) } catch { /* Keep the in-memory choice. */ }
  }, [density, listKey, loadedKey])
  return [density, setDensity] as const
}

"use client"

import { useEffect, useState } from "react"
export type TableDensity = "comfortable" | "compact"

/** Browser-local presentation preference; never changes row selection, queries, or filters. */
export function useTableDensity(listKey?: string) {
  const [density, setDensity] = useState<TableDensity>("comfortable")
  const [loadedKey, setLoadedKey] = useState<string | undefined>()
  useEffect(() => {
    let next: TableDensity = "comfortable"
    let readableKey: string | undefined
    try {
      if (listKey) {
        if (localStorage.getItem(`${listKey}:density`) === "compact") next = "compact"
        readableKey = listKey
      }
    } catch { /* Storage can be unavailable. */ }
    setDensity(next)
    setLoadedKey(readableKey)
  }, [listKey])
  const updateDensity = (next: TableDensity) => {
    setDensity(next)
    if (!listKey || loadedKey !== listKey) return
    try { localStorage.setItem(`${listKey}:density`, next) }
    catch { setLoadedKey(undefined) /* Keep the in-memory choice. */ }
  }
  return [density, updateDensity] as const
}

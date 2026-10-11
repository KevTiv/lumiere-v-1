"use client"

import { useEffect } from "react"

/**
 * While `active`, ask the browser to confirm before the tab is reloaded or
 * closed. The listener exists only while there is something to lose.
 */
export function useUnsavedChangesGuard(active: boolean): void {
  useEffect(() => {
    if (!active || typeof window === "undefined") return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Legacy browsers need a returnValue to show the prompt.
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [active])
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a == null && b == null) return true
  if (typeof FileList !== "undefined" && (a instanceof FileList || b instanceof FileList)) {
    return (a as FileList | null)?.length === (b as FileList | null)?.length && ((a as FileList | null)?.length ?? 0) === 0
  }
  if (typeof a === "object" && typeof b === "object" && a && b) {
    try {
      return JSON.stringify(a) === JSON.stringify(b)
    } catch {
      return false
    }
  }
  return false
}

/** True when any field differs from its baseline value. */
export function formValuesDiffer(
  current: Record<string, unknown>,
  baseline: Record<string, unknown>,
): boolean {
  const keys = new Set([...Object.keys(current), ...Object.keys(baseline)])
  for (const key of keys) {
    if (!sameValue(current[key], baseline[key])) return true
  }
  return false
}

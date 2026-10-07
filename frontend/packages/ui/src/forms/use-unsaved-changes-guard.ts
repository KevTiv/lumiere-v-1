"use client"

import { useEffect, useRef, type ReactNode } from "react"
import { useTranslation } from "@lumiere/i18n"
import { useConfirmDialog } from "../hooks/use-confirm-dialog"

/**
 * Protect reload/close and ordinary link navigation while there are unsaved edits.
 * Render the returned dialog. Modified clicks and new-tab links leave the editor intact.
 * Imperative router calls and browser history navigation need a router-level guard.
 */
export function useUnsavedChangesGuard(active: boolean): ReactNode {
  const { t } = useTranslation()
  const { confirm, dismiss, dialog } = useConfirmDialog()
  const activeRef = useRef(active)
  activeRef.current = active
  const resumingRef = useRef(false)
  useEffect(() => {
    if (!active) dismiss()
  }, [active, dismiss])
  useEffect(() => {
    if (!active || typeof window === "undefined") return
    const handler = (event: BeforeUnloadEvent) => {
      if (resumingRef.current) return
      event.preventDefault()
      // Legacy browsers need a returnValue to show the prompt.
      event.returnValue = ""
    }
    const navigate = (event: MouseEvent) => {
      if (resumingRef.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null
      if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return
      const target = new URL(link.href, window.location.href)
      if (!["http:", "https:"].includes(target.protocol)) return
      // An in-page anchor does not discard the editor.
      if (target.origin === window.location.origin && target.pathname === window.location.pathname && target.search === window.location.search) return
      event.preventDefault()
      event.stopImmediatePropagation()
      void confirm({
        title: t("common.discardChanges.title", { defaultValue: "Discard changes?" }),
        description: t("common.discardChanges.navigate", { defaultValue: "You have edits that were not saved. They will be lost if you leave this page." }),
        confirmLabel: t("common.discardChanges.discard", { defaultValue: "Discard" }),
        cancelLabel: t("common.discardChanges.keep", { defaultValue: "Keep editing" }),
      }).then((discard) => {
        if (!discard || !activeRef.current || !link.isConnected) return
        // Replay through the original link so Next Link keeps its routing behavior.
        resumingRef.current = true
        try {
          link.click()
        } finally {
          resumingRef.current = false
        }
      })
    }
    window.addEventListener("beforeunload", handler)
    document.addEventListener("click", navigate, true)
    return () => {
      window.removeEventListener("beforeunload", handler)
      document.removeEventListener("click", navigate, true)
    }
  }, [active, confirm, t])
  return dialog
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

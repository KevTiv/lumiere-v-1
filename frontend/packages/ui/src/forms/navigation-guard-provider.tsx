"use client"

import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react"
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime"
import { useTranslation } from "@lumiere/i18n"
import { toast } from "sonner"
import { useConfirmDialog } from "../hooks/use-confirm-dialog"
import { installNavigationHistoryGuard } from "../lib/navigation-history"
import { NavigationEditorContext, type NavigationEditorState } from "./navigation-guard-context"

/** One prompt for all active editors, with Next.js 16 App Router interception.
 * Keep this provider in the persistent root layout, outside route content.
 */
export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const router = useContext(AppRouterContext)
  const { t } = useTranslation()
  const { confirm, dismiss, dialog } = useConfirmDialog()
  const editors = useRef(new Set<() => NavigationEditorState>())
  const bypass = useRef(false)
  const hasEdits = useCallback(() => [...editors.current].some((read) => {
    const state = read()
    return state.dirty || state.pending
  }), [])
  const isSaving = useCallback(() => [...editors.current].some((read) => read().pending), [])
  const allow = useCallback(async () => {
    if (isSaving()) {
      toast.warning(t("common.formSubmit.busy"))
      return false
    }
    if (!hasEdits()) return true
    const accepted = await confirm({
      title: t("common.discardChanges.title"),
      description: t("common.discardChanges.navigate"),
      confirmLabel: t("common.discardChanges.discard"),
      cancelLabel: t("common.discardChanges.keep"),
    })
    return accepted && !isSaving()
  }, [confirm, hasEdits, isSaving, t])
  // Navigations the app itself requests while a form is still saving (for example the record
  // page opened by a workflow once its transition succeeds) wait for the save to settle instead
  // of being dropped; user-initiated link clicks and history moves stay blocked while saving.
  const afterSave = useRef<Array<() => void>>([])
  const flushAfterSave = useCallback(() => {
    const ready = afterSave.current
    afterSave.current = []
    ready.forEach((resume) => resume())
  }, [])
  const run = useCallback((action: () => void, deferWhileSaving = false) => {
    if (bypass.current || !hasEdits()) { action(); return }
    if (deferWhileSaving && isSaving()) {
      afterSave.current.push(() => run(action))
      return
    }
    void allow().then((accepted) => {
      if (!accepted) return
      bypass.current = true
      try { action() } finally { bypass.current = false }
    })
  }, [allow, hasEdits, isSaving])
  const value = useMemo(() => ({
    register: (read: () => NavigationEditorState) => {
      editors.current.add(read)
      return () => {
        editors.current.delete(read)
        if (!hasEdits()) dismiss()
        if (!isSaving()) flushAfterSave()
      }
    },
    changed: () => {
      if (!hasEdits()) dismiss()
      if (!isSaving()) flushAfterSave()
    },
  }), [dismiss, hasEdits, isSaving, flushAfterSave])
  const guardedRouter = useMemo(() => router ? {
    ...router,
    push: (...args: Parameters<typeof router.push>) => run(() => router.push(...args), true),
    replace: (...args: Parameters<typeof router.replace>) => run(() => router.replace(...args), true),
    // History traversal is guarded by the popstate handler, once, including browser controls.
    back: () => router.back(),
    forward: () => router.forward(),
    refresh: () => run(() => router.refresh()),
  } : null, [router, run])

  const latestAllow = useRef(allow)
  latestAllow.current = allow
  useLayoutEffect(() => installNavigationHistoryGuard(hasEdits, () => latestAllow.current()), [hasEdits])
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (bypass.current || !hasEdits()) return
      event.preventDefault()
      event.returnValue = ""
    }
    const navigate = (event: MouseEvent) => {
      if (bypass.current || !hasEdits() || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null
      if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return
      const target = new URL(link.href, location.href)
      if (!["http:", "https:"].includes(target.protocol)) return
      if (target.origin === location.origin && target.pathname === location.pathname && target.search === location.search) return
      event.preventDefault()
      event.stopImmediatePropagation()
      run(() => { if (link.isConnected) link.click() })
    }
    window.addEventListener("beforeunload", unload)
    document.addEventListener("click", navigate, true)
    return () => {
      window.removeEventListener("beforeunload", unload)
      document.removeEventListener("click", navigate, true)
    }
  }, [hasEdits, run])

  return <NavigationEditorContext.Provider value={value}>
    <AppRouterContext.Provider value={guardedRouter}>{children}</AppRouterContext.Provider>
    {dialog}
  </NavigationEditorContext.Provider>
}

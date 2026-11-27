"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { useTranslation } from "@lumiere/i18n"
import { quickCreateTarget, type QUICK_CREATE_TARGETS } from "../lib/quick-create"

type QuickCreateTarget = (typeof QUICK_CREATE_TARGETS)[keyof typeof QUICK_CREATE_TARGETS]
type QuickCreateBlock = "company" | "denied" | "busy" | "unavailable"
type QuickCreateResult = QuickCreateBlock | "opened" | "loading"

export function useModuleQuickCreate(
  moduleId: string | undefined,
  open: (target: QuickCreateTarget) => QuickCreateResult,
) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [blocked, setBlocked] = useState<{ tab: string; reason: QuickCreateBlock } | null>(null)
  const tab = searchParams?.get("tab")
  const target = quickCreateTarget(pathname, searchParams)
  useEffect(() => {
    if (blocked && blocked.tab !== tab) setBlocked(null)
  }, [blocked, tab])

  useEffect(() => {
    if (!target || target.module !== moduleId) return

    // Check the live URL as well as the router snapshot. This makes the
    // intent one-shot even if React reruns effects before Next updates.
    const url = new URL(window.location.href)
    if (quickCreateTarget(url.pathname, url.searchParams) !== target) return
    const result = open(target)
    if (result === "loading") {
      setBlocked(null)
      return
    }

    url.searchParams.delete("create")
    window.history.replaceState(null, "", url)
    setBlocked(result === "opened" ? null : { tab: target.tab, reason: result })
  }, [moduleId, open, target])

  return blocked && blocked.tab === tab ? blocked.reason : null
}

export function QuickCreateNotice({ blocked }: { blocked: QuickCreateBlock | null }) {
  const { t } = useTranslation()
  const alert = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (blocked) alert.current?.focus() }, [blocked])

  if (!blocked) return null
  const messages = {
    company: t("commandPalette.quickCreate.companyRequired", { defaultValue: "Select an active company before creating a record." }),
    denied: t("commandPalette.quickCreate.denied", { defaultValue: "You do not have permission to create this record." }),
    busy: t("commandPalette.quickCreate.busy", { defaultValue: "Close the current form or finish the pending operation, then try Quick Create again." }),
    unavailable: t("commandPalette.quickCreate.unavailable", { defaultValue: "The create form is unavailable. Check the workspace for required data or setup, then try again." }),
  }
  return <p ref={alert} role="alert" tabIndex={-1} className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{messages[blocked]}</p>
}

export function QuickCreateCompanyNotice({ moduleId, ready }: { moduleId: string; ready: boolean }) {
  const blocked = useModuleQuickCreate(moduleId, () => ready ? "company" : "loading")
  return <QuickCreateNotice blocked={blocked} />
}

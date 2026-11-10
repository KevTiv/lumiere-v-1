"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useState } from "react"
import { History } from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import { useErpSession } from "@lumiere/erp-session"
import { Button } from "@lumiere/ui/components/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@lumiere/ui/components/sheet"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { ModuleBusinessHistory, RecordBusinessHistory } from "@lumiere/ui/entity-views/record-business-history"
import { historyActivityHref, historyActivityModule } from "../lib/history-activity-navigation"
import { historyRecordHref } from "../lib/history-record-href"

/** A URL-backed activity drawer uses the existing route's admission and history's own read authority. */
export function ModuleActivity() {
  const pathname = usePathname()
  const search = useSearchParams()
  const router = useRouter()
  const { t } = useTranslation()
  const session = useErpSession()
  const { permissionsReady, checkPermission } = useRBAC()
  const moduleId = historyActivityModule(pathname)
  const scopeKey = `${session.organizationId}:${session.activeCompanyId}:${session.identity}:${moduleId}`
  const [selected, setSelected] = useState<{ scopeKey: string; resource: string; recordId: string } | null>(null)
  if (!moduleId || !permissionsReady || !session.activeCompanyReady || !session.identity
    || !checkPermission("business_history", "read").allowed) return null
  const open = search.get("history") === "activity"
  const navigate = (next: boolean) => {
    if (!next) setSelected(null)
    const href = historyActivityHref(pathname, search.toString(), next)
    if (next) router.push(href, { scroll: false })
    else router.replace(href, { scroll: false })
  }
  const title = t("businessHistory.activity", { defaultValue: "Activity" })
  return <>
    <Button variant="ghost" size="icon" onClick={() => navigate(true)} aria-label={title} title={title} data-testid="module-history-open">
      <History aria-hidden="true" className="size-4" />
    </Button>
    <Sheet open={open} onOpenChange={navigate}>
      <SheetContent size="record">
        <SheetHeader>
          <SheetTitle>{t("businessHistory.activity", { defaultValue: "Activity" })}</SheetTitle>
          <SheetDescription>{t("businessHistory.activityDescription", { defaultValue: "Inspect recorded changes and follow their business records." })}</SheetDescription>
        </SheetHeader>
        {open ? <div className="min-w-0 px-4 pb-6"><ModuleBusinessHistory
          key={scopeKey}
          moduleId={moduleId}
          renderRecordLink={(entry) => {
            const href = historyRecordHref(entry.resource, entry.recordId)
            return <div className="flex flex-wrap items-center gap-3">
              {href ? <Link className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4" href={href}>
                {t("businessHistory.openRecord", { defaultValue: "Open record" })}
              </Link> : null}
              {entry.resource && entry.recordId ? <Button variant="outline" size="sm" onClick={() => setSelected({ scopeKey, resource: entry.resource!, recordId: entry.recordId! })}>
                {t("businessHistory.title", { defaultValue: "History & sources" })}
              </Button> : null}
            </div>
          }}
        /></div> : null}
      </SheetContent>
    </Sheet>
    <Sheet open={open && selected?.scopeKey === scopeKey} onOpenChange={(next) => { if (!next) setSelected(null) }}>
      <SheetContent size="record">
        <SheetHeader>
          <SheetTitle>{t("businessHistory.title", { defaultValue: "History & sources" })}</SheetTitle>
          <SheetDescription>{t("businessHistory.activityDescription", { defaultValue: "Inspect recorded changes and follow their business records." })}</SheetDescription>
        </SheetHeader>
        {open && selected?.scopeKey === scopeKey ? <div className="min-w-0 px-4 pb-6">
          <RecordBusinessHistory key={`${scopeKey}:${selected.resource}:${selected.recordId}`} tableName={selected.resource} recordId={selected.recordId} />
        </div> : null}
      </SheetContent>
    </Sheet>
  </>
}

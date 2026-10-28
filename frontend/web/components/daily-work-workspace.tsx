"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useTranslation } from "@lumiere/i18n"
import { useRBAC } from "@lumiere/ui"
import { WorkBoardWorkspace } from "./work-board/work-board-workspace"
import { dailyWorkHref } from "./daily-work-navigation"

/** Both entry points render the same authorized work adapters and command review. */
export function DailyWorkWorkspace({ organizationId, summary = false }: {
  organizationId: number
  summary?: boolean
}) {
  const { t } = useTranslation()
  const { checkPermission, permissionsReady } = useRBAC()
  const params = useSearchParams()
  const canReadCrm = permissionsReady !== false && checkPermission("module:crm", "read").allowed
  const canReadProjects = permissionsReady !== false && checkPermission("module:projects", "read").allowed
  const Heading = summary ? "h2" : "h1"
  return (
    <section className="min-w-0 space-y-4" data-testid={summary ? "overview-finance-work" : "daily-work"}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl space-y-1">
          <Heading className="text-2xl font-semibold tracking-tight">{t("workBoard.title")}</Heading>
          <p className="text-sm text-muted-foreground">
            {t("workspace.dailyWork.description", { defaultValue: "Review assigned Finance workflow work, or switch to record follow-ups. Completing a follow-up does not approve its business record." })}
          </p>
        </div>
        {summary && <Link href={dailyWorkHref(params)} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          {t("workspace.actions.openMyWork", { defaultValue: "Open my work" })}
        </Link>}
      </header>
      <p className="text-xs text-muted-foreground">
        {t("workspace.dailyWork.viewsHint", { defaultValue: "Mine shows your assignments. Eligible includes work available to your role; Available shows unclaimed workflow work or unassigned follow-ups. Counts describe only loaded records." })}
      </p>
      <WorkBoardWorkspace organizationId={organizationId} initialView="mine" defaultLayout="list" embedded />
      {(canReadCrm || canReadProjects) && <nav className="flex flex-wrap gap-x-5 gap-y-2 border-t pt-3 text-sm" aria-label={t("workspace.dailyWork.otherWork", { defaultValue: "Other workspaces" })}>
        {canReadCrm && <Link href="/crm?tab=my-activities" className="font-medium text-primary underline-offset-4 hover:underline">
          {t("workspace.dailyWork.crmWork", { defaultValue: "CRM daily work" })}
        </Link>}
        {canReadProjects && <Link href="/tasks?source=projects" className="font-medium text-primary underline-offset-4 hover:underline">
          {t("workBoard.projectTasks")}
        </Link>}
      </nav>}
    </section>
  )
}

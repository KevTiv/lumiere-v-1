"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useTranslation } from "@lumiere/i18n"
import { DashboardHeader, useRBAC } from "@lumiere/ui"
import { usePageCompositionActionSlot } from "@lumiere/ui/pages/page-composition-host"
import { OperationalPageComposition } from "./operational-page-composition"
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
  const { target: compositionTarget, slot: compositionSlot } = usePageCompositionActionSlot()
  const canReadCrm = permissionsReady !== false && checkPermission("module:crm", "read").allowed
  const canReadProjects = permissionsReady !== false && checkPermission("module:projects", "read").allowed
  const canReadSubscriptions = permissionsReady !== false && checkPermission("module:subscriptions", "read").allowed
  const canReadReports = permissionsReady !== false && checkPermission("module:reports", "read").allowed
  return (
    <section className="min-w-0 space-y-4" data-testid={summary ? "overview-finance-work" : "daily-work"}>
      {summary ? <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">{t("workBoard.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("workspace.dailyWork.description", { defaultValue: "Review assigned Finance workflow work, or switch to record follow-ups. Completing a follow-up does not approve its business record." })}
          </p>
        </div>
        {summary && <Link href={dailyWorkHref(params)} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          {t("workspace.actions.openMyWork", { defaultValue: "Open my work" })}
        </Link>}
      </header> : <DashboardHeader
        title={t("workBoard.title")}
        secondaryAction={compositionSlot}
        description={t("workspace.dailyWork.shortDescription", { defaultValue: "Review your assignments and record follow-ups." })}
      />}
      <WorkBoardWorkspace organizationId={organizationId} initialView="mine" defaultLayout="list" embedded />
      <details className="text-sm text-muted-foreground">
        <summary className="w-fit cursor-pointer rounded-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("workspace.dailyWork.help", { defaultValue: "How this inbox works" })}
        </summary>
        <div className="mt-3 max-w-3xl space-y-2">
          {!summary && <p>{t("workspace.dailyWork.description")}</p>}
      <p className="text-xs text-muted-foreground">
        {t("workspace.dailyWork.viewsHint", { defaultValue: "Mine shows your assignments. Eligible includes work available to your role; Available shows unclaimed workflow work or unassigned follow-ups. Counts describe only loaded records." })}
      </p>
      <p className="text-xs text-muted-foreground">{t("workspace.dailyWork.coverage", { defaultValue: "This inbox covers Accounting, Sales, Purchasing and Expenses. CRM follow-ups, subscription billing and report schedules remain in their own workspaces." })}</p>
        </div>
      </details>
      {(canReadCrm || canReadProjects || canReadSubscriptions || canReadReports) && <nav className="flex flex-wrap gap-x-5 gap-y-2 border-t pt-3 text-sm" aria-label={t("workspace.dailyWork.otherWork", { defaultValue: "Other workspaces" })}>
        {canReadCrm && <Link href="/crm?tab=my-activities" className="font-medium text-primary underline-offset-4 hover:underline">
          {t("workspace.dailyWork.crmWork", { defaultValue: "CRM daily work" })}
        </Link>}
        {canReadProjects && <Link href="/tasks?source=projects" className="font-medium text-primary underline-offset-4 hover:underline">
          {t("workBoard.projectTasks")}
        </Link>}
        {canReadSubscriptions && <Link href="/subscriptions?tab=due-to-bill" className="font-medium text-primary underline-offset-4 hover:underline">{t("workspace.dailyWork.subscriptionBilling", { defaultValue: "Subscriptions due to bill" })}</Link>}
        {canReadReports && <Link href="/reports?tab=scheduled-reports" className="font-medium text-primary underline-offset-4 hover:underline">{t("workspace.dailyWork.reportSchedules", { defaultValue: "Report schedules" })}</Link>}
      </nav>}
      {!summary && <OperationalPageComposition moduleId="tasks" title={t("workBoard.title")} actionTarget={compositionTarget} />}
    </section>
  )
}

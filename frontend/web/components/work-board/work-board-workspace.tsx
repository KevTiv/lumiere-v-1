"use client"

import { useEffect, useState, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTranslation } from "@lumiere/i18n"
import { useErpSession } from "@lumiere/erp-session"
import { Button } from "@lumiere/ui/components/button"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { buildNavGroups } from "@lumiere/ui/lib/navigation-catalog"
import { useWorkspaceProfile } from "@lumiere/ui/lib/workspace-profile-context"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import {
  WORK_MODULES,
  isWorkScope,
  isWorkTeamKey,
  isWorkView,
  type WorkBoardScope,
  type WorkScope,
  type WorkView,
} from "@lumiere/query-hooks/hooks/work-board-model"
import {
  canReadRecordFollowups,
  canReadWorkflowWork,
} from "./work-board-permissions"
import { WorkActivitiesContent } from "./work-activities-content"
import { WorkflowWorkContent } from "./workflow-work-content"
import { useWorkBoardAuthority } from "./work-board-authority"

const selectClass =
  "h-9 max-w-full rounded-md border bg-background px-2 text-sm"

function useOnline() {
  const [state, setState] = useState({ online: true, reconnect: 0 })
  useEffect(() => {
    const update = () =>
      setState((previous) => {
        const online = navigator.onLine
        if (online === previous.online) return previous
        return { online, reconnect: previous.reconnect + (online ? 1 : 0) }
      })
    update()
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => {
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    }
  }, [])
  return state
}

export interface WorkBoardWorkspaceProps {
  organizationId: number
  scope?: WorkScope
  initialView?: WorkView
  embedded?: boolean
}

/** A module view over canonical assignments. It never owns a second task lifecycle. */
export function WorkBoardWorkspace({
  organizationId,
  scope: fixedScope,
  initialView = "eligible",
  embedded = false,
}: WorkBoardWorkspaceProps) {
  const { t } = useTranslation()
  const session = useErpSession()
  const companyId = useOperatingCompanyId(organizationId)
  const { currentUser, roles, policies, permissionsReady, checkPermission } =
    useRBAC()
  const profile = useWorkspaceProfile()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [navigationPending, startNavigation] = useTransition()
  const { online, reconnect } = useOnline()
  const authorizationKey = JSON.stringify({ currentUser, roles, policies })
  const requestedScope = params.get("workScope")
  const scope =
    fixedScope ?? (isWorkScope(requestedScope) ? requestedScope : "finance")
  const requestedView = params.get("workView")
  const view = isWorkView(requestedView) ? requestedView : initialView
  const workflowRead = canReadWorkflowWork(checkPermission)
  const activitiesRead =
    scope !== "expenses" && canReadRecordFollowups(checkPermission)
  const source =
    scope !== "expenses" &&
    (params.get("workSource") === "activities" ||
      (!params.has("workSource") && !workflowRead && activitiesRead))
      ? "activities"
      : "workflow"
  const requestedTeam = params.get("workTeam")
  const team =
    requestedTeam && isWorkTeamKey(requestedTeam) ? requestedTeam : undefined
  const layout = params.get("workLayout") === "list" ? "list" : "board"
  const scopeOptions = buildNavGroups((key) => t(key), {
    workspaceProfile: profile,
  })
    .flatMap((group) => group.items)
    .filter(
      (item) =>
        WORK_MODULES.some((module) => item.href === `/${module}`) &&
        checkPermission(item.resource, "read").allowed,
    )
  // Let the current URL update commit before deriving the next filter from it.
  const updateParams = (values: Record<string, string | null>) => {
    if (navigationPending) return
    const next = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    startNavigation(() => {
      router.replace(`${pathname}?${next}`, { scroll: false })
    })
  }
  const ready =
    permissionsReady !== false &&
    !!currentUser &&
    !!session.identity &&
    session.organizationId === organizationId &&
    session.activeCompanyReady !== false &&
    companyId != null
  const allowed =
    ready && (source === "activities" ? activitiesRead : workflowRead)
  const boardScope: WorkBoardScope = {
    organizationId,
    companyId: companyId ?? 0,
    actorIdentity: session.identity ?? "",
    authorizationKey,
    scope,
    view,
    team,
  }
  const authority = useWorkBoardAuthority(boardScope, source, online, reconnect)
  return (
    <section className="min-w-0 space-y-4" aria-label={t("workBoard.title")}>
      {!embedded && (
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("workBoard.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("workBoard.description")}
          </p>
        </header>
      )}
      <div className="flex flex-wrap items-end gap-3">
        {scope !== "expenses" && (
          <label className="grid gap-1 text-xs font-medium">
            {t("workBoard.source")}
            <select
              className={selectClass}
              value={source}
              disabled={navigationPending}
              onChange={(event) =>
                updateParams({ workSource: event.target.value, workTeam: null })
              }
            >
              <option value="workflow" disabled={!workflowRead}>
                {t("workBoard.workflowWork")}
              </option>
              <option value="activities" disabled={!activitiesRead}>
                {t("workBoard.followUps")}
              </option>
            </select>
          </label>
        )}
        {!fixedScope && (
          <label className="grid gap-1 text-xs font-medium">
            {t("workBoard.scope")}
            <select
              className={selectClass}
              value={scope}
              disabled={navigationPending}
              onChange={(event) =>
                updateParams({ workScope: event.target.value, workTeam: null })
              }
            >
              <option value="finance">{t("workBoard.finance")}</option>
              {scopeOptions.map((item) => (
                <option key={item.href} value={item.href.slice(1)}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="grid gap-1 text-xs font-medium">
          {t("workBoard.show")}
          <select
            className={selectClass}
            value={view}
            disabled={navigationPending}
            onChange={(event) => updateParams({ workView: event.target.value })}
          >
            <option value="eligible">{t("workBoard.eligible")}</option>
            <option value="mine">{t("workBoard.mine")}</option>
            <option value="available">{t("workBoard.available")}</option>
          </select>
        </label>
        <div
          className="flex gap-1"
          role="group"
          aria-label={t("workBoard.layout")}
        >
          <Button
            size="sm"
            variant={layout === "board" ? "default" : "outline"}
            aria-pressed={layout === "board"}
            disabled={navigationPending}
            onClick={() => updateParams({ workLayout: "board" })}
          >
            {t("workBoard.board")}
          </Button>
          <Button
            size="sm"
            variant={layout === "list" ? "default" : "outline"}
            aria-pressed={layout === "list"}
            disabled={navigationPending}
            onClick={() => updateParams({ workLayout: "list" })}
          >
            {t("workBoard.list")}
          </Button>
        </div>
      </div>
      {online && authority.blocked && (
        <div
          role={authority.failed ? "alert" : "status"}
          className="space-y-2 text-sm"
        >
          <p>
            {t(
              authority.failed
                ? "workBoard.readFailed"
                : "workBoard.refreshing",
            )}
          </p>
          {authority.failed && (
            <Button variant="outline" size="sm" onClick={authority.retry}>
              {t("workBoard.refresh")}
            </Button>
          )}
        </div>
      )}
      {!ready ? (
        <p role="status">{t("workBoard.contextLoading")}</p>
      ) : !allowed ? (
        <p role="alert">{t("workBoard.denied")}</p>
      ) : source === "activities" ? (
        <WorkActivitiesContent
          key={JSON.stringify(boardScope)}
          scope={boardScope}
          online={online}
          layout={layout}
          navigationPending={navigationPending}
          authorityRefreshing={authority.blocked}
          onTeamChange={(value) => updateParams({ workTeam: value })}
        />
      ) : (
        <WorkflowWorkContent
          key={JSON.stringify(boardScope)}
          scope={boardScope}
          online={online}
          layout={layout}
          navigationPending={navigationPending}
          authorityRefreshing={authority.blocked}
          onTeamChange={(value) => updateParams({ workTeam: value })}
        />
      )}
    </section>
  )
}

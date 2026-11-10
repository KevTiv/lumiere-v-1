"use client"

import { useTranslation } from "@lumiere/i18n"
import type { ModuleDataState } from "@lumiere/ui/lib/module-data-state"
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice"
import { Skeleton } from "@lumiere/ui/components/skeleton"
import { TASK_BOARD_STATES } from "../projects/project-record"
import type { TaskSummaryCompleteness } from "./task-board-items"

interface SummaryTask {
  columnId: string
  isClosed?: boolean
  dueAt?: number | null
  summaryCompleteness?: TaskSummaryCompleteness
}

/** Loaded task counts before board filters; unavailable sources never assert zero. */
export function TaskSummary({ items, state, nowMs = Date.now() }: { items: readonly SummaryTask[]; state: ModuleDataState; nowMs?: number }) {
  const { t } = useTranslation()
  const statesKnown = items.every((item) => item.summaryCompleteness?.state ?? (TASK_BOARD_STATES as readonly string[]).includes(item.columnId))
  const overdueKnown = items.every((item) => {
    const closureKnown = item.summaryCompleteness?.closure ?? typeof item.isClosed === "boolean"
    const deadlineKnown = item.summaryCompleteness?.deadline ?? (item.dueAt === null || typeof item.dueAt === "number" && Number.isFinite(item.dueAt))
    return closureKnown && deadlineKnown
  })
  const stats = state.status === "ready" ? {
    total: items.length,
    inProgress: statesKnown ? items.filter((item) => item.columnId === "InProgress").length : null,
    done: statesKnown ? items.filter((item) => item.columnId === "Done").length : null,
    overdue: overdueKnown ? items.filter((item) => !item.isClosed && item.dueAt != null && item.dueAt < nowMs).length : null,
  } : null

  return <details className="border-t pt-3" data-testid="task-summary" aria-busy={state.status === "loading"}>
    <summary className="w-fit cursor-pointer rounded-sm text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
      {t("tasks.board.stats.summary", { defaultValue: "Project task summary" })}
    </summary>
    <p className="mt-2 text-sm text-muted-foreground">{t("tasks.board.stats.scope", { defaultValue: "Counts cover loaded project tasks, before board filters." })}</p>
    <ModuleDataNotice state={state} />
    {stats && Object.values(stats).some((value) => value === null) && <p role="status" className="mt-2 text-sm text-muted-foreground">
      {t("tasks.board.stats.incompleteFields", { defaultValue: "Some required task fields are unavailable." })}
    </p>}
    {(stats || state.status === "loading") && <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {(["total", "inProgress", "done", "overdue"] as const).map((key) => <div key={key} className="min-w-0">
        <dt className="text-sm text-muted-foreground">{t(`tasks.board.stats.${key}`)}</dt>
        <dd className="mt-1 text-xl font-semibold tabular-nums" data-testid={`task-summary-${key}`}>
          {stats ? stats[key] ?? <span className="text-sm font-normal text-muted-foreground">{t("tasks.board.stats.unavailable", { defaultValue: "Unavailable" })}</span> : <Skeleton className="h-6 w-12" />}
        </dd>
      </div>)}
    </dl>}
  </details>
}

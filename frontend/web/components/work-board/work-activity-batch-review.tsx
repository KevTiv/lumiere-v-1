"use client"

import { useTranslation } from "@lumiere/i18n"
import type { WorkActivityRow } from "@lumiere/query-hooks/hooks/work-activities"
import { Button } from "@lumiere/ui/components/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@lumiere/ui/components/sheet"

export type ActivityBatchEntry = { activity: WorkActivityRow } & (
  | { status: "ready" }
  | { status: "completed" }
  | { status: "failed"; error: string }
)

export function WorkActivityBatchReview({
  entries,
  runningId,
  busy,
  disabled,
  title,
  details,
  currentActivity,
  onClose,
  onSubmit,
}: {
  entries: readonly ActivityBatchEntry[] | null
  runningId: number | null
  busy: boolean
  disabled: boolean
  title: (activity: WorkActivityRow) => string
  details: (activity: WorkActivityRow) => string
  currentActivity: (id: number) => WorkActivityRow | undefined
  onClose: () => void
  onSubmit: (entries: readonly ActivityBatchEntry[]) => void
}) {
  const { t } = useTranslation()
  const completed =
    entries?.filter((entry) => entry.status === "completed").length ?? 0
  const failed =
    entries?.filter((entry) => entry.status === "failed").length ?? 0

  return (
    <Sheet
      open={entries != null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <SheetContent size="record">
        <SheetHeader>
          <SheetTitle>{t("workBoard.batch.title")}</SheetTitle>
          <SheetDescription>
            {t("workBoard.batch.description")}
          </SheetDescription>
        </SheetHeader>
        {entries && (
          <div className="space-y-4 p-4">
            <p className="text-sm text-muted-foreground" role="status">
              {busy
                ? t("workBoard.batch.inProgress")
                : completed > 0 || failed > 0
                  ? t("workBoard.batch.result", { completed, failed })
                  : t("workBoard.batch.selected", { total: entries.length })}
            </p>
            <ul className="divide-y border-y">
              {entries.map((entry, index) => {
                const current = currentActivity(entry.activity.id)
                const label = current ? title(current) : undefined
                return (
                  <li
                    className="space-y-1 py-3 text-sm [overflow-wrap:anywhere]"
                    key={entry.activity.id}
                  >
                    <p className="font-medium">
                      {label ??
                        t("workBoard.batch.unavailableItem", {
                          number: index + 1,
                        })}
                    </p>
                    {current && (
                      <p className="text-muted-foreground">
                        {details(current)}
                      </p>
                    )}
                    {runningId === entry.activity.id ? (
                      <p>{t("workBoard.saving")}</p>
                    ) : entry.status === "completed" ? (
                      <p>{t("workBoard.followUpCompleted")}</p>
                    ) : entry.status === "failed" ? (
                      <>
                        {current && (
                          <p className="text-destructive">{entry.error}</p>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy || disabled}
                          aria-label={
                            label
                              ? t("workBoard.batch.retryItem", {
                                  title: label,
                                })
                              : t("workBoard.batch.retryUnavailableItem", {
                                  number: index + 1,
                                })
                          }
                          onClick={() => onSubmit([entry])}
                        >
                          {t("workBoard.batch.retry")}
                        </Button>
                      </>
                    ) : null}
                  </li>
                )
              })}
            </ul>
            <div className="flex flex-wrap gap-2">
              {completed === 0 && failed === 0 && (
                <Button
                  type="button"
                  disabled={busy || disabled}
                  onClick={() => onSubmit(entries)}
                >
                  {t("workBoard.batch.complete")}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onClose}
              >
                {t("workBoard.batch.close")}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

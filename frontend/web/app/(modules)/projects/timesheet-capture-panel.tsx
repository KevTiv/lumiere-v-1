"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { projectTimesheetsHref } from "@lumiere/erp-shared/record-links"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import { CaptureSyncBadge } from "../../../components/capture/capture-sync-badge"
import {
  getOrCreateTimesheetCaptureDeviceId,
  listTimesheetCaptures,
  writeTimesheetCapture,
} from "@/lib/timesheet-capture-outbox"
import type { CaptureOwner } from "@/lib/capture-sync-state"

export function TimesheetCapturePanel({ organizationId,
  owner,
  syncingId,
  onReview,
}: { organizationId: number
  owner: CaptureOwner
  syncingId: string | null
  onReview: () => void
}) {
  const { t } = useTranslation()
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [dismissed, setDismissed] = useState<string[]>([])
  useEffect(() => {
    try {
      setDeviceId(getOrCreateTimesheetCaptureDeviceId())
    } catch {
      // The create action reports unavailable recovery storage before dispatch.
    }
  }, [])

  const attempts = deviceId
    ? listTimesheetCaptures(organizationId, deviceId, owner).filter(
        (item) => !dismissed.includes(item.clientRequestId),
      )
    : []
  if (!attempts.length) return null

  return (
    <section
      aria-labelledby="timesheet-capture-title"
      className="space-y-2 rounded-lg border p-3 text-sm"
      data-testid="timesheet-capture-panel"
    >
      <h2 id="timesheet-capture-title" className="font-medium">
        {t("captureSync.timesheetTitle", {
          defaultValue: "Timesheet recovery",
        })}
      </h2>
      <ul className="divide-y">
        {attempts.map((item) => {
          const syncing = item.clientRequestId === syncingId
          const failed = item.syncState === "failed"
          return (
            <li
              key={item.clientRequestId}
              className="flex flex-wrap items-start justify-between gap-2 py-2"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {t("captureSync.timesheetEntry", {
                      defaultValue:
                        "{{date}} · {{hours}} h · Project {{project}}",
                      date: item.payload.date,
                      hours: item.payload.unitAmount,
                      project: item.payload.projectId,
                    })}
                  </span>
                  <CaptureSyncBadge
                    state={syncing ? "syncing" : failed ? "failed" : "conflict"}
                  />
                </div>
                {!syncing ? (
                  <p className="text-muted-foreground">
                    {failed
                      ? t("captureSync.timesheetRejected", {
                          defaultValue:
                            "The server rejected this entry. Correct the details in the form before trying again.",
                        })
                      : t("captureSync.timesheetReview", {
                          defaultValue:
                            "Check Timesheets for this entry before submitting it again.",
                        })}
                  </p>
                ) : null}
              </div>
              {!syncing ? (
                <div className="flex flex-wrap items-center gap-2">
                  {!failed ? (
                    <Button
                      variant="outline"
                      size="sm"
                      render={<Link href={projectTimesheetsHref(item.payload.projectId)} />}
                      nativeButton={false}
                      onClick={onReview}
                    >
                      {t("captureSync.openTimesheets", {
                        defaultValue: "Open Timesheets",
                      })}
                    </Button>
                  ) : null}
                  <Button
                type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (!deviceId) return
                      try {
                        writeTimesheetCapture(organizationId, deviceId, item, {
                          remove: true,
                        })
                        setDismissed((ids) => [...ids, item.clientRequestId])
                        setError(false)
                      } catch {
                        setError(true)
                      }
                    }}
                  >
                    {failed
                      ? t("captureSync.dismiss", { defaultValue: "Dismiss" })
                      : t("captureSync.markReviewed", {
                          defaultValue: "Mark reviewed",
                        })}
                  </Button>
              </div>
              ) : null}
            </li>
        )
        })}
      </ul>
      {error ? (
        <p role="alert">
          {t("captureSync.storageUnavailable", {
            defaultValue: "Recovery storage is unavailable on this device.",
          })}
        </p>
      ) : null}
    </section>
  )
}

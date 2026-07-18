"use client"

import { useMemo, useState } from "react"
import { Button } from "@lumiere/ui"
import {
  discardTimesheetCapture,
  getOrCreateTimesheetCaptureDeviceId,
  listQueuedTimesheetCaptures,
  requeueTimesheetCapture,
} from "@/lib/timesheet-capture-outbox"

/** Offline / delayed-sync timesheet outbox with conflict retry UI (Wave E). */
export function TimesheetCapturePanel({ organizationId }: { organizationId: number }) {
  const deviceId = useMemo(() => getOrCreateTimesheetCaptureDeviceId(), [])
  const [tick, setTick] = useState(0)
  const queued = useMemo(
    () => listQueuedTimesheetCaptures(organizationId, deviceId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [organizationId, deviceId, tick],
  )

  if (queued.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground" data-testid="timesheet-capture-empty">
        No queued offline timesheets. Failed log attempts appear here for retry.
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="timesheet-capture-panel">
      <h3 className="text-sm font-medium">Timesheet sync queue</h3>
      <ul className="space-y-2">
        {queued.map((item) => (
          <li
            key={item.clientRequestId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
            data-testid={`timesheet-capture-item-${item.syncState}`}
          >
            <div>
              <div className="font-medium">
                {item.payload.projectId} / {item.payload.taskId} — {item.payload.unitAmount}h
              </div>
              <div className="text-muted-foreground">
                {item.syncState}
                {item.lastError ? `: ${item.lastError}` : ""}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  requeueTimesheetCapture(organizationId, deviceId, item.clientRequestId)
                  setTick((n) => n + 1)
                }}
              >
                Retry
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  discardTimesheetCapture(organizationId, deviceId, item.clientRequestId)
                  setTick((n) => n + 1)
                }}
              >
                Discard
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

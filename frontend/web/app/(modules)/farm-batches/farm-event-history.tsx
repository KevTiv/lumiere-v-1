"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@lumiere/ui/components/button"
import { Skeleton } from "@lumiere/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@lumiere/ui/components/table"
import { workspaceStyles } from "@lumiere/ui/lib/workspace-styles"
import Link from "next/link"
import {
  eventSummary,
  farmApiPath,
  farmDateLabel,
  farmEventLabels,
  farmSourceReviewHref,
  farmRequest,
  type FarmEvent,
} from "./farm-batch-model"

interface Scope {
  scopeKey: string
  companyId: string
  batchId: string
  locale: string
}

interface Revision {
  event: FarmEvent
  reason: string | null
  recordedBy: string
  recordedAt: string
}

function Source({ source, companyId }: { source: FarmEvent["source"]; companyId: string }) {
  if (!source) return "Manual entry"
  const coordinates = [
    source.file,
    source.sheet,
    source.row == null ? null : `row ${source.row}`,
  ].filter(Boolean)
  const href = farmSourceReviewHref(companyId, source)
  return href ? (
    <Link
      className="font-medium text-primary underline-offset-4 hover:underline"
      href={href}
    >
      {coordinates.join(" · ") || "Open source review"}
    </Link>
  ) : (
    <span>{coordinates.join(" · ") || "Imported evidence"}</span>
  )
}

export function FarmEventHistory({ events, ...scope }: Scope & { events: FarmEvent[] }) {
  const [selected, setSelected] = useState<string | null>(null)
  if (events.length === 0)
    return (
      <p className="text-sm text-muted-foreground">No farm events are recorded for this date range.</p>
    )
  return (
    <div className="min-w-0 space-y-4">
      <div className={workspaceStyles.surface}>
        <Table viewportLabel="Farm event sources">
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Changes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...events].reverse().map((event) => (
              <TableRow key={event.id}>
                <TableCell>{farmDateLabel(event.businessDate, scope.locale)}</TableCell>
                <TableCell>{farmEventLabels[event.kind]}</TableCell>
                <TableCell className="max-w-64 whitespace-normal wrap-anywhere">
                  <Source source={event.source} companyId={scope.companyId} />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-expanded={selected === event.id}
                    aria-label={`Revisions for ${farmEventLabels[event.kind]} on ${event.businessDate}`}
                    onClick={() => setSelected(selected === event.id ? null : event.id)}
                  >
                    Revision {event.revision}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {selected && <Revisions {...scope} eventId={selected} />}
    </div>
  )
}

function Revisions({ scopeKey, companyId, batchId, eventId, locale }: Scope & { eventId: string }) {
  const result = useQuery({
    queryKey: ["farm-batch", scopeKey, batchId, "event-history", eventId],
    queryFn: ({ signal }) =>
      farmRequest<Revision[]>(farmApiPath(companyId, `/${batchId}/events/${eventId}/history`), {
        signal,
      }),
    retry: false,
  })
  if (result.isPending) return <Skeleton className="h-24 w-full" aria-label="Loading event revisions" />
  if (result.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        {result.error.message}
      </p>
    )
  return (
    <section className={`${workspaceStyles.surface} space-y-2 p-4`}>
      <h2 className={workspaceStyles.sectionTitle}>Event #{eventId} revisions</h2>
      <ol className="divide-y divide-border text-sm">
        {result.data.map(({ event, reason, recordedAt }) => (
          <li key={event.revision} className="space-y-1 py-3">
            <p className="font-medium">
              Revision {event.revision} · {farmEventLabels[event.kind]} ·{" "}
              {farmDateLabel(event.businessDate, locale)}
            </p>
            <p>{eventSummary(event, locale)}</p>
            {reason && <p>{reason}</p>}
            <p className="text-xs text-muted-foreground">
              <Source source={event.source} companyId={companyId} /> · {recordedAt}
            </p>
          </li>
        ))}
      </ol>
    </section>
  )
}

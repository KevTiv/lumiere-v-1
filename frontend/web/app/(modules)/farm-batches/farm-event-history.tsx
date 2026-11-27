"use client"

import { useTranslation } from "@lumiere/i18n"
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
  const { t } = useTranslation()
  if (!source) return t("farmBatches.manualEntry")
  const coordinates = [
    source.file,
    source.sheet,
    source.row == null ? null : t("farmBatches.rowLabel", { row: source.row }),
  ].filter(Boolean)
  const href = farmSourceReviewHref(companyId, source)
  return href ? (
    <Link
      className="font-medium text-primary underline-offset-4 hover:underline"
      href={href}
    >
      {coordinates.join(" · ") || t("farmBatches.openSourceReview")}
    </Link>
  ) : (
    <span>{coordinates.join(" · ") || t("farmBatches.importedEvidence")}</span>
  )
}

export function FarmEventHistory({ events, ...scope }: Scope & { events: FarmEvent[] }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string | null>(null)
  if (events.length === 0)
    return (
      <p className="text-sm text-muted-foreground">{t("farmBatches.noFarmEventsAreRecordedForThis")}</p>
    )
  return (
    <div className="min-w-0 space-y-4">
      <div className={workspaceStyles.surface}>
        <Table viewportLabel={t("farmBatches.farmEventSources")}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("farmBatches.date")}</TableHead>
              <TableHead>{t("farmBatches.event")}</TableHead>
              <TableHead>{t("farmBatches.source")}</TableHead>
              <TableHead className="text-right">{t("farmBatches.changes")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...events].reverse().map((event) => (
              <TableRow key={event.id}>
                <TableCell>{farmDateLabel(event.businessDate, scope.locale)}</TableCell>
                <TableCell>{t(farmEventLabels[event.kind])}</TableCell>
                <TableCell className="max-w-64 whitespace-normal wrap-anywhere">
                  <Source source={event.source} companyId={scope.companyId} />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-expanded={selected === event.id}
                    aria-label={t("farmBatches.revisionLabel", { event: t(farmEventLabels[event.kind]), date: farmDateLabel(event.businessDate, scope.locale) })}
                    onClick={() => setSelected(selected === event.id ? null : event.id)}
                  >
                    {t("farmBatches.revision")} {event.revision}
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
  const { t } = useTranslation()
  const result = useQuery({
    queryKey: ["farm-batch", scopeKey, batchId, "event-history", eventId],
    queryFn: ({ signal }) =>
      farmRequest<Revision[]>(farmApiPath(companyId, `/${batchId}/events/${eventId}/history`), {
        signal,
      }),
    retry: false,
  })
  if (result.isPending) return <Skeleton className="h-24 w-full" aria-label={t("farmBatches.loadingEventRevisions")} />
  if (result.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("farmBatches.loadRevisionsFailed")}
      </p>
    )
  return (
    <section className={`${workspaceStyles.surface} space-y-2 p-4`}>
      <h2 className={workspaceStyles.sectionTitle}>{t("farmBatches.eventRevisions", { id: eventId })}</h2>
      <ol className="divide-y divide-border text-sm">
        {result.data.map(({ event, reason, recordedAt }) => (
          <li key={event.revision} className="space-y-1 py-3">
            <p className="font-medium">
              {t("farmBatches.revision")} {event.revision} · {t(farmEventLabels[event.kind])} ·{" "}
              {farmDateLabel(event.businessDate, locale)}
            </p>
            <p>{eventSummary(event, locale, t)}</p>
            {reason && <p>{reason}</p>}
            <p className="text-xs text-muted-foreground">
              <Source source={event.source} companyId={companyId} /> · {new Date(recordedAt).toLocaleString(locale, { timeZone: "UTC" })}
            </p>
          </li>
        ))}
      </ol>
    </section>
  )
}

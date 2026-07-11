"use client"

import { useTranslation } from "@lumiere/i18n"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@lumiere/ui/components/card"
import { Badge } from "@lumiere/ui/components/badge"

import type { HarnessAuditTrail } from "@lumiere/erp-shared/ai-report-composer-schemas"

export function HarnessAuditTrailCard({ audit }: { audit: HarnessAuditTrail }) {
  const { t } = useTranslation()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t("aiHarness.auditTrail.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            {t("aiHarness.auditTrail.correlationId")}
          </span>
          <code className="rounded bg-muted px-2 py-0.5 text-xs">
            {audit.correlationId}
          </code>
        </div>
        <ol className="flex flex-col gap-2">
          {audit.events.map((event) => (
            <li
              key={event.sequence}
              className="flex flex-col gap-1 rounded-lg border p-3 text-sm"
            >
              <div className="flex items-center gap-2">
                <Badge variant="outline">#{event.sequence}</Badge>
                <span className="font-medium">{event.phase}</span>
              </div>
              <span className="text-muted-foreground">{event.message}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}

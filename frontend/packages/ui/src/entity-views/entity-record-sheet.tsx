"use client"

import Link from "next/link"
import { useRef } from "react"
import { cn } from "../lib/utils"
import { ExternalLink } from "lucide-react"
import { Badge } from "../components/badge"
import { Button } from "../components/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../components/sheet"
import { Tabs, TabsContent } from "../components/tabs"
import { ContextTabsList, ContextTabsTrigger } from "../components/context-tabs"
import { useErpSession } from "@lumiere/erp-session"
import { useTranslation } from "@lumiere/i18n"
import { RecordChatter } from "../crm-components/crm-record-chatter"
import { EntityDetail } from "./entity-detail"
import { RecordAuditTab } from "./record-audit-tab"
import { RecordPageOverview } from "./record-page-overview"
import type { EntityRecordSheetConfig } from "../lib/module-types"
import type { BadgeVariant } from "../lib/entity-view-types"
import { commitRecordListFor } from "../lib/record-list-context"
import {
  entityEnumTag,
  entityScalarText,
  getRowField,
  humanizeEnumValue,
  statusTone,
} from "../lib/entity-row-values"
import { firstOwnedKey } from "@lumiere/erp-shared/row-values"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"

interface EntityRecordSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: EntityRecordSheetConfig
  record: Record<string, unknown> | null
}

export function EntityRecordSheet({
  open,
  onOpenChange,
  config,
  record,
}: EntityRecordSheetProps) {
  const { t } = useTranslation()
  const evidenceTrigger = useRef<HTMLButtonElement>(null)
  const historyLabel = t("businessHistory.title", {
    defaultValue: "History & sources",
  })
  const recordId = record
    ? ((
        parseStrictU64(firstOwnedKey(record, "id", "Id")) || undefined
      )?.toString() ?? "")
    : ""
  const title = record
    ? (entityScalarText(getRowField(record, config.titleKey)) ??
      (recordId
        ? `#${recordId}`
        : t("common.entityView.record", { defaultValue: "Record" })))
    : ""
  const statusRaw =
    record && config.statusKey
      ? (entityEnumTag(getRowField(record, config.statusKey)) ?? "") : ""
  const statusVariant: BadgeVariant =
    statusTone(statusRaw) ??
    (config.statusBadgeVariants?.[statusRaw] as BadgeVariant | undefined) ??
    "secondary"
  const statusLabel = config.statusBadgeLabels?.[statusRaw] ?? humanizeEnumValue(statusRaw)
  const { organizationId } = useErpSession()
  const discussionModel = config.discussion ? (config.discussion.resModel ?? config.auditTableName) : undefined
  const showDiscussion = Boolean(discussionModel && organizationId && recordId)
  const openHref = record ? config.openHref?.(record) : undefined
  const actions = record ? typeof config.actions === "function" ? config.actions(record) : config.actions
    : null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size={config.wide ? "review" : "record"} className="gap-0 overflow-hidden">
        {record && (
          <>
            <SheetHeader className="shrink-0 border-b">
              <SheetTitle>{title}</SheetTitle>
            </SheetHeader>

            <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
              <RecordPageOverview
                testIdPrefix="entity-record-sheet"
                header={
                  statusRaw || actions || openHref ? (
                <div className="flex flex-wrap items-center gap-2">
                  {config.statusKey && statusRaw && (
                    <Badge variant={statusVariant} className="max-w-full whitespace-normal">{statusLabel}</Badge>
                  )}
                  {actions && (
                    <div className={cn("flex min-w-0 flex-wrap gap-2 [&_button]:h-auto [&_button]:min-h-8 [&_button]:max-w-full [&_button]:whitespace-normal", typeof config.actions === "function" && "w-full",
                          )}>{actions}</div>
                  )}
                  {openHref && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto"
                      nativeButton={false}
                      render={<Link href={openHref} onClick={() => commitRecordListFor(openHref)} />}
                      data-testid="entity-record-sheet-open"
                    >
                      <ExternalLink className="mr-1 h-3.5 w-3.5" />
                      Open
                    </Button>
                  )}
                </div>
              ) : null
                }
                responsibility={config.responsibility?.(record)}
                evidence={
                  config.auditTableName && recordId
                    ? {
                        label: historyLabel,
                        open: () => {
                          evidenceTrigger.current?.click()
                          evidenceTrigger.current?.focus()
                        },
                      }
                    : undefined
                }
              />

              <Tabs defaultValue="overview" className="min-w-0 flex flex-col">
                <ContextTabsList aria-label="Record views">
                  <ContextTabsTrigger value="overview">Overview</ContextTabsTrigger>
                  {config.customTabs?.map((tab) => (
                    <ContextTabsTrigger
                      key={tab.id}
                      className="flex-none"
                      value={tab.id}
                      data-testid={`entity-record-sheet-tab-${tab.id}`}
                    >
                      {tab.label}
                    </ContextTabsTrigger>
                  ))}
                  {showDiscussion && (
                    <ContextTabsTrigger value="discussion" data-testid="entity-record-sheet-tab-discussion">
                      Discussion
                    </ContextTabsTrigger>
                  )}
                  <ContextTabsTrigger ref={evidenceTrigger} value="audit">
                    {historyLabel}</ContextTabsTrigger>
                </ContextTabsList>

                <TabsContent value="overview" className="mt-4">
                  {config.overviewContent ? (
                    config.overviewContent(record)
                  ) : (
                    <EntityDetail config={config.detailConfig} data={record} />
                  )}
                </TabsContent>

                {config.customTabs?.map((tab) => (
                  <TabsContent key={tab.id} value={tab.id} className="mt-4">
                    {tab.content(record)}
                  </TabsContent>
                ))}

                {showDiscussion && discussionModel && organizationId ? (
                  <TabsContent value="discussion" className="mt-4 space-y-6">
                    <RecordChatter
                      organizationId={organizationId}
                      resModel={discussionModel}
                      resId={BigInt(recordId)}
                      recordTitle={title}
                    />
                    {config.discussion?.attachments?.(record)}
                  </TabsContent>
                ) : null}

                <TabsContent value="audit" className="mt-4">
                  {config.auditTableName ? (
                    <RecordAuditTab
                      tableName={config.auditTableName}
                      recordId={recordId}
                      companyId={
                        parseStrictU64(getRowField(record, "companyId")) ??
                        undefined}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t("businessHistory.notConfigured")}
                    </p>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

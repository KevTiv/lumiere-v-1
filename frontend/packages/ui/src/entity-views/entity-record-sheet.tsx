"use client"
import { i18n, useTranslation } from "@lumiere/i18n"


import Link from "next/link"
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
import { RecordChatter } from "../crm-components/crm-record-chatter"
import { EntityDetail } from "./entity-detail"
import { RecordAuditTab } from "./record-audit-tab"
import type { EntityRecordSheetConfig } from "../lib/module-types"
import type { BadgeVariant } from "../lib/entity-view-types"
import { commitRecordListFor } from "../lib/record-list-context"
import { humanizeEnumValue, statusTone } from "../lib/entity-row-values"

interface EntityRecordSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: EntityRecordSheetConfig
  record: Record<string, unknown> | null
}

function resolveStatusValue(record: Record<string, unknown>, statusKey: string): string {
  const value = record[statusKey]
  if (value != null && typeof value === "object" && "tag" in value) {
    return String((value as { tag: string }).tag)
  }
  return value != null ? String(value) : ""
}

export function EntityRecordSheet({
  open,
  onOpenChange,
  config,
  record,
}: EntityRecordSheetProps) {
  useTranslation()
  const title = record ? String(record[config.titleKey] ?? "") : ""
  const statusRaw =
    record && config.statusKey ? resolveStatusValue(record, config.statusKey) : ""
  const statusVariant: BadgeVariant =
    statusTone(statusRaw) ??
    (config.statusBadgeVariants?.[statusRaw] as BadgeVariant | undefined) ??
    "secondary"
  const statusLabel = config.statusBadgeLabels?.[statusRaw] ?? humanizeEnumValue(statusRaw)
  const { organizationId } = useErpSession()
  const discussionModel = config.discussion ? (config.discussion.resModel ?? config.auditTableName) : undefined
  const recordId = record ? String(record.id ?? record.Id ?? "") : ""
  const showDiscussion = Boolean(discussionModel && organizationId && /^\d+$/.test(recordId))
  const openHref = record ? config.openHref?.(record) : undefined
  const actions = record ? (typeof config.actions === "function" ? config.actions(record) : config.actions) : null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={cn("w-full overflow-y-auto", config.wide ? "sm:max-w-[min(1280px,calc(100vw-1rem))]" : "sm:max-w-lg")}>
        {record && (
          <>
            <SheetHeader>
              <SheetTitle>{title}</SheetTitle>
            </SheetHeader>

            <div className="mt-2 space-y-4 px-4 pb-6">
              {(config.statusKey || config.actions || openHref) && (
                <div className="flex flex-wrap items-center gap-2">
                  {config.statusKey && statusRaw && (
                    <Badge variant={statusVariant}>{statusLabel}</Badge>
                  )}
                  {actions && (
                    <div className={cn("flex flex-wrap gap-2", typeof config.actions === "function" && "w-full")}>{actions}</div>
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
                      {i18n.t("ui.entityViews.entityRecordSheet.open")}</Button>
                  )}
                </div>
              )}

              <Tabs defaultValue="overview" className="min-w-0 flex flex-col">
                <ContextTabsList aria-label={i18n.t("ui.entityViews.entityRecordSheet.recordViews")}>
                  <ContextTabsTrigger value="overview">{i18n.t("common.overview")}</ContextTabsTrigger>
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
                      {i18n.t("ui.entityViews.entityRecordSheet.discussion")}</ContextTabsTrigger>
                  )}
                  <ContextTabsTrigger value="audit">{i18n.t("common.audit")}</ContextTabsTrigger>
                </ContextTabsList>

                <TabsContent value="overview" className="mt-4">
                  {config.overviewContent ? config.overviewContent(record) : <EntityDetail config={config.detailConfig} data={record} />}
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
                      recordId={String(record.id ?? record.Id ?? "")}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {i18n.t("ui.entityViews.entityRecordSheet.auditHistoryIsNotConfiguredForThisRecordType")}</p>
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

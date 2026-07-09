"use client"

import { Badge } from "../components/badge"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../components/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/tabs"
import { EntityDetail } from "./entity-detail"
import { RecordAuditTab } from "./record-audit-tab"
import type { EntityRecordSheetConfig } from "../lib/module-types"
import type { BadgeVariant } from "../lib/entity-view-types"

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
  const title = record ? String(record[config.titleKey] ?? "") : ""
  const statusRaw =
    record && config.statusKey ? resolveStatusValue(record, config.statusKey) : ""
  const statusVariant: BadgeVariant =
    (config.statusBadgeVariants?.[statusRaw] as BadgeVariant | undefined) ?? "secondary"
  const statusLabel = config.statusBadgeLabels?.[statusRaw] ?? statusRaw

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        {record && (
          <>
            <SheetHeader>
              <SheetTitle>{title}</SheetTitle>
            </SheetHeader>

            <div className="mt-4 space-y-4">
              {(config.statusKey || config.actions) && (
                <div className="flex flex-wrap items-center gap-2">
                  {config.statusKey && statusRaw && (
                    <Badge variant={statusVariant}>{statusLabel}</Badge>
                  )}
                  {config.actions && (
                    <div className="flex flex-wrap gap-2">{config.actions}</div>
                  )}
                </div>
              )}

              <Tabs defaultValue="overview" className="flex flex-col">
                <TabsList variant="default" className="w-full flex flex-wrap justify-start gap-2">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  {config.customTabs?.map((tab) => (
                    <TabsTrigger key={tab.id} value={tab.id}>
                      {tab.label}
                    </TabsTrigger>
                  ))}
                  <TabsTrigger value="audit">Audit</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="mt-4">
                  <EntityDetail config={config.detailConfig} data={record} />
                </TabsContent>

                {config.customTabs?.map((tab) => (
                  <TabsContent key={tab.id} value={tab.id} className="mt-4">
                    {tab.content(record)}
                  </TabsContent>
                ))}

                <TabsContent value="audit" className="mt-4">
                  {config.auditTableName ? (
                    <RecordAuditTab
                      tableName={config.auditTableName}
                      recordId={String(record.id ?? record.Id ?? "")}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Audit history is not configured for this record type.
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

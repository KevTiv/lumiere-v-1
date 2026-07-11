"use client"

import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@lumiere/ui/components/tabs"

import { ReportComposerPanel } from "./report-composer-panel"
import { LowStockPanel } from "./low-stock-panel"
import { RedActionDraftPanel } from "./red-action-draft-panel"

interface AiHarnessClientProps {
  organizationId: bigint
  companies: Record<string, unknown>[]
}

export function AiHarnessClient({
  organizationId,
  companies,
}: AiHarnessClientProps) {
  const { t } = useTranslation()
  const [tab, setTab] = useState("report-composer")

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-6">
      <TabsList>
        <TabsTrigger value="report-composer">
          {t("aiHarness.tabs.reportComposer")}
        </TabsTrigger>
        <TabsTrigger value="low-stock">
          {t("aiHarness.tabs.lowStock")}
        </TabsTrigger>
        <TabsTrigger value="red-action-drafts">
          {t("aiHarness.tabs.redActionDrafts")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="report-composer">
        <ReportComposerPanel
          organizationId={organizationId}
          companies={companies}
        />
      </TabsContent>

      <TabsContent value="low-stock">
        <LowStockPanel
          organizationId={organizationId}
          companies={companies}
        />
      </TabsContent>

      <TabsContent value="red-action-drafts">
        <RedActionDraftPanel companies={companies} />
      </TabsContent>
    </Tabs>
  )
}

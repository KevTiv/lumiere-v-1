"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { useTranslation } from "@lumiere/i18n"
import { Tabs, TabsContent } from "@lumiere/ui/components/tabs"
import { WorkspaceTabsList as TabsList, WorkspaceTabsTrigger as TabsTrigger } from "@lumiere/ui/components/workspace-tabs"
import { DashboardHeader } from "@lumiere/ui"

import { ReportAnalysisPanel } from "./report-analysis-panel"
import { FinanceReviewPanel } from "./finance-review-panel"
import { ReportComposerPanel } from "./report-composer-panel"
import { LowStockPanel } from "./low-stock-panel"
import { RedActionDraftPanel } from "./red-action-draft-panel"
import { EvidenceReviewerPanel } from "./evidence-reviewer-panel"
import { RunLifecyclePanel } from "./run-lifecycle-panel"

interface AiHarnessClientProps {
  organizationId: bigint
  companies: Record<string, unknown>[]
}

export function AiHarnessClient({
  organizationId,
  companies,
}: AiHarnessClientProps) {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const savedRunId = Number(searchParams.get("runId"))
  const savedCompanyId = Number(searchParams.get("companyId"))
  const savedRun = Number.isSafeInteger(savedRunId) && savedRunId > 0
    && Number.isSafeInteger(savedCompanyId) && savedCompanyId > 0
    ? { companyId: savedCompanyId, runId: savedRunId } : undefined
  const [tab, setTab] = useState(() => {
    const requested = searchParams.get("tab")
    if (["finance-reviews", "report-analysis", "report-composer", "low-stock", "red-action-drafts", "evidence-reviewer", "run-lifecycle"].includes(requested ?? "")) return requested!
    return searchParams.has("runId") ? "evidence-reviewer" : "report-composer"
  })

  return (
    <div className="flex flex-col gap-2">
    <DashboardHeader title={t("aiHarness.title")} description={t("aiHarness.description")} />
    <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-6">
      <TabsList scrollable>
        <TabsTrigger value="finance-reviews">{t("aiHarness.finance.title")}</TabsTrigger>
        <TabsTrigger value="report-analysis">{t("aiHarness.reportAnalysis.title")}</TabsTrigger>
        <TabsTrigger value="report-composer">
          {t("aiHarness.tabs.reportComposer")}
        </TabsTrigger>
        <TabsTrigger value="low-stock">
          {t("aiHarness.tabs.lowStock")}
        </TabsTrigger>
        <TabsTrigger value="red-action-drafts">
          {t("aiHarness.tabs.redActionDrafts")}
        </TabsTrigger>
        <TabsTrigger value="evidence-reviewer">
          {t("aiHarness.tabs.evidenceReviewer")}
        </TabsTrigger>
        <TabsTrigger value="run-lifecycle">
          {t("aiHarness.tabs.runLifecycle")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="finance-reviews">
        <FinanceReviewPanel organizationId={organizationId} companies={companies} savedRun={savedRun} />
      </TabsContent>

      <TabsContent value="report-analysis">
        <ReportAnalysisPanel organizationId={organizationId} companies={companies} savedRun={savedRun} />
      </TabsContent>

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

      <TabsContent value="evidence-reviewer">
        <EvidenceReviewerPanel companies={companies} />
      </TabsContent>

      <TabsContent value="run-lifecycle">
        <RunLifecyclePanel companies={companies} />
      </TabsContent>
    </Tabs>
    </div>
  )
}

export function CompanyDataError({ status, message }: { status: string; message: string }) {
  const { t } = useTranslation()
  return (
    <main className="p-6" role="alert">
      {t("aiHarness.companyDataError", { status, message })}
    </main>
  )
}

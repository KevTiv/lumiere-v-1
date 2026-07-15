"use client"

import { useMemo, type ReactNode } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  CheckCircle2,
  Circle,
  AlertCircle,
  Calendar,
  Landmark,
  FileText,
  Receipt,
  Lock,
  ExternalLink,
} from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import { accountPeriodStateTag } from "@lumiere/erp-shared/accounting-create-params"

type StepStatus = "done" | "pending" | "blocked"

type CloseStep = {
  id: string
  title: string
  description: string
  status: StepStatus
  tabId?: string
  href?: string
  icon: ReactNode
}

function moveStateIsDraft(state: unknown): boolean {
  if (state != null && typeof state === "object" && "tag" in state) {
    return String((state as { tag: string }).tag) === "Draft"
  }
  return String(state ?? "").toLowerCase() === "draft"
}

function reportTypeIsVat(row: Record<string, unknown>): boolean {
  const raw = row.reportType ?? row.report_type
  const tag =
    raw != null && typeof raw === "object" && "tag" in raw
      ? String((raw as { tag?: string }).tag ?? "")
      : String(raw ?? "")
  return tag.toLowerCase().includes("vat")
}

function reportStateNormalized(row: Record<string, unknown>): string {
  const raw = row.state
  if (raw != null && typeof raw === "object" && "tag" in raw) {
    return String((raw as { tag: string }).tag).toLowerCase()
  }
  return String(raw ?? "").toLowerCase()
}

function statusBadge(status: StepStatus, t: (key: string) => string) {
  if (status === "done") {
    return (
      <Badge variant="default" className="gap-1">
        <CheckCircle2 className="h-3 w-3" />
        {t("accounting.periodClose.status.done")}
      </Badge>
    )
  }
  if (status === "blocked") {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertCircle className="h-3 w-3" />
        {t("accounting.periodClose.status.blocked")}
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <Circle className="h-3 w-3" />
      {t("accounting.periodClose.status.pending")}
    </Badge>
  )
}

export interface PeriodCloseChecklistProps {
  companyId: bigint
  fiscalYears: Record<string, unknown>[]
  accountPeriods: Record<string, unknown>[]
  moves: Record<string, unknown>[]
  bankStatementLines: Record<string, unknown>[]
  financialReports: Record<string, unknown>[]
  onNavigateToTab: (tabId: string) => void
}

export function PeriodCloseChecklist({
  companyId,
  fiscalYears,
  accountPeriods,
  moves,
  bankStatementLines,
  financialReports,
  onNavigateToTab,
}: PeriodCloseChecklistProps) {
  const { t } = useTranslation()

  const companyFiscalYears = useMemo(
    () =>
      fiscalYears.filter(
        (fy) => String(fy.companyId ?? fy.company_id ?? "") === String(companyId),
      ),
    [fiscalYears, companyId],
  )

  const companyPeriods = useMemo(
    () =>
      accountPeriods.filter(
        (p) => String(p.companyId ?? p.company_id ?? "") === String(companyId),
      ),
    [accountPeriods, companyId],
  )

  const fiscalConfigured = companyFiscalYears.length > 0 && companyPeriods.length > 0

  const draftMoveCount = useMemo(
    () => moves.filter((m) => moveStateIsDraft(m.state)).length,
    [moves],
  )

  const unreconciledBankLines = useMemo(
    () =>
      bankStatementLines.filter((line) => {
        const cid = String(line.companyId ?? line.company_id ?? "")
        if (cid !== String(companyId)) return false
        return !line.isReconciled
      }).length,
    [bankStatementLines, companyId],
  )

  const vatReady = useMemo(() => {
    return financialReports.some((r) => {
      if (!reportTypeIsVat(r)) return false
      const st = reportStateNormalized(r)
      return st === "generated" || st === "exported" || st === "archived"
    })
  }, [financialReports])

  const trialBalanceReady = useMemo(() => {
    return financialReports.some((r) => {
      const raw = r.reportType ?? r.report_type
      const tag =
        raw != null && typeof raw === "object" && "tag" in raw
          ? String((raw as { tag?: string }).tag ?? "")
          : String(raw ?? "")
      if (!tag.toLowerCase().includes("trial")) return false
      const st = reportStateNormalized(r)
      return st === "generated" || st === "exported" || st === "archived"
    })
  }, [financialReports])

  const openPeriodCount = useMemo(
    () =>
      companyPeriods.filter((p) => accountPeriodStateTag(p) === "Open").length,
    [companyPeriods],
  )

  const steps: CloseStep[] = useMemo(() => {
    const fiscalStatus: StepStatus = fiscalConfigured ? "done" : "pending"
    const bankStatus: StepStatus = !fiscalConfigured
      ? "blocked"
      : unreconciledBankLines === 0
        ? "done"
        : "pending"
    const draftStatus: StepStatus = !fiscalConfigured
      ? "blocked"
      : draftMoveCount === 0
        ? "done"
        : "pending"
    const tbStatus: StepStatus = !fiscalConfigured
      ? "blocked"
      : trialBalanceReady
        ? "done"
        : "pending"
    const vatStatus: StepStatus = !fiscalConfigured
      ? "blocked"
      : vatReady
        ? "done"
        : "pending"
    const closeStatus: StepStatus = !fiscalConfigured
      ? "blocked"
      : draftMoveCount > 0 || unreconciledBankLines > 0
        ? "blocked"
        : openPeriodCount === 0
          ? "done"
          : "pending"

    return [
      {
        id: "fiscal-calendar",
        title: t("accounting.periodClose.steps.fiscalCalendar.title"),
        description: t("accounting.periodClose.steps.fiscalCalendar.description"),
        status: fiscalStatus,
        tabId: "fiscal-years",
        icon: <Calendar className="h-5 w-5" />,
      },
      {
        id: "bank-recon",
        title: t("accounting.periodClose.steps.bankRecon.title"),
        description: t("accounting.periodClose.steps.bankRecon.description", {
          count: unreconciledBankLines,
        }),
        status: bankStatus,
        tabId: "bank-statements",
        icon: <Landmark className="h-5 w-5" />,
      },
      {
        id: "draft-moves",
        title: t("accounting.periodClose.steps.draftMoves.title"),
        description: t("accounting.periodClose.steps.draftMoves.description", {
          count: draftMoveCount,
        }),
        status: draftStatus,
        tabId: "journal-entries",
        icon: <FileText className="h-5 w-5" />,
      },
      {
        id: "trial-balance",
        title: t("accounting.periodClose.steps.trialBalance.title"),
        description: t("accounting.periodClose.steps.trialBalance.description"),
        status: tbStatus,
        href: "/reports",
        icon: <FileText className="h-5 w-5" />,
      },
      {
        id: "vat-report",
        title: t("accounting.periodClose.steps.vatReport.title"),
        description: t("accounting.periodClose.steps.vatReport.description"),
        status: vatStatus,
        href: "/reports",
        icon: <Receipt className="h-5 w-5" />,
      },
      {
        id: "close-period",
        title: t("accounting.periodClose.steps.closePeriod.title"),
        description: t("accounting.periodClose.steps.closePeriod.description", {
          count: openPeriodCount,
        }),
        status: closeStatus,
        tabId: "account-periods",
        icon: <Lock className="h-5 w-5" />,
      },
    ]
  }, [
    fiscalConfigured,
    unreconciledBankLines,
    draftMoveCount,
    trialBalanceReady,
    vatReady,
    openPeriodCount,
    t,
  ])

  const doneCount = steps.filter((s) => s.status === "done").length

  return (
    <div className="space-y-6 p-1" data-testid="period-close-checklist">
      <div>
        <h2 className="text-lg font-semibold">{t("accounting.periodClose.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("accounting.periodClose.description")}</p>
        <p className="text-sm text-muted-foreground mt-1">
          {t("accounting.periodClose.progress", { done: doneCount, total: steps.length })}
        </p>
      </div>

      <div className="grid gap-4">
        {steps.map((step) => (
          <Card key={step.id}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-muted p-2 text-muted-foreground">{step.icon}</div>
                  <div>
                    <CardTitle className="text-base">{step.title}</CardTitle>
                    <CardDescription>{step.description}</CardDescription>
                  </div>
                </div>
                {statusBadge(step.status, t)}
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {step.href ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    window.location.assign(step.href!)
                  }}
                >
                  {t("accounting.periodClose.goToStep")}
                  <ExternalLink className="ml-2 h-4 w-4" />
                </Button>
              ) : step.tabId ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onNavigateToTab(step.tabId!)}
                >
                  {t("accounting.periodClose.goToStep")}
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button, buttonVariants } from "@/components/ui/button"
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
import { kpiDate } from "@/lib/kpi-tiles"
import { stbEnumTag } from "../lib/accounting-move-utils"
import { mergeModuleStates, type ModuleDataState } from "../lib/module-data-state"
import { ModuleDataNotice } from "../pages/module-data-notice"
import { periodReportHref } from "../lib/period-report-context"
import { stbTimestampMicros, stbTimestampToExactIso } from "@lumiere/erp-shared/stb-timestamp"

type StepStatus = "done" | "pending" | "blocked"

type CloseStep = {
  id: string
  title: string
  description: string
  status: StepStatus
  tabId?: string
  href?: string
  icon: ReactNode
  sourceState?: ModuleDataState
}

type ScopedCount = {
  available: boolean
  count: number
}

type PeriodCloseLookupRow = {
  readonly id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly statementId?: unknown
  readonly statement_id?: unknown
  readonly date?: unknown
  readonly dateFrom?: unknown
  readonly date_from?: unknown
  readonly dateTo?: unknown
  readonly date_to?: unknown
  readonly isReconciled?: unknown
  readonly is_reconciled?: unknown
}

function rowCompanyId(row: PeriodCloseLookupRow): string | null {
  const raw = row.companyId ?? row.company_id
  return raw == null || raw === "" ? null : String(raw)
}

function rowId(row: PeriodCloseLookupRow, ...keys: (keyof PeriodCloseLookupRow)[]): string | null {
  for (const key of keys) {
    const raw = row[key]
    if (raw != null && raw !== "") return String(raw)
  }
  return null
}

function rowDate(row: PeriodCloseLookupRow, ...keys: (keyof PeriodCloseLookupRow)[]): Date | null {
  for (const key of keys) {
    const value = row[key]
    if (value != null) {
      const date = kpiDate(value)
      return date && Number.isFinite(date.getTime()) ? date : null
    }
  }
  return null
}

function rowIsReconciled(row: PeriodCloseLookupRow): boolean {
  return row.isReconciled === true || row.is_reconciled === true
}

function isInPeriod(date: Date, dateFrom: Date, dateTo: Date): boolean {
  const value = date.getTime()
  return value >= dateFrom.getTime() && value <= dateTo.getTime()
}

function reportCoversPeriod(
  row: PeriodCloseLookupRow,
  dateFrom: bigint,
  dateTo: bigint,
): boolean {
  const reportFrom = stbTimestampMicros(row.dateFrom ?? row.date_from)
  const reportTo = stbTimestampMicros(row.dateTo ?? row.date_to)
  return reportFrom === dateFrom && reportTo === dateTo
}

function moveStateIsDraft(state: unknown): boolean {
  return stbEnumTag(state).toLowerCase() === "draft"
}

function reportTypeIsVat(row: Record<string, unknown>): boolean {
  const tag = stbEnumTag(row.reportType ?? row.report_type)
  return tag.toLowerCase().includes("vat")
}

function reportStateNormalized(row: Record<string, unknown>): string {
  return stbEnumTag(row.state).toLowerCase()
}

export type PeriodCloseSource = "fiscalYears" | "accountPeriods" | "moves" | "bankStatements" | "bankStatementLines" | "financialReports"

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
  organizationId?: bigint
  companyId: bigint
  fiscalYears: Record<string, unknown>[]
  accountPeriods: Record<string, unknown>[]
  moves: Record<string, unknown>[]
  bankStatements: PeriodCloseLookupRow[]
  bankStatementLines: Record<string, unknown>[]
  financialReports: Record<string, unknown>[]
  sourceStates?: Partial<Record<PeriodCloseSource, ModuleDataState>>
  /** Only explicitly applicable report policies may block closing. VAT is not universal. */
  requiredReports?: readonly ("trial-balance" | "vat-report")[]
  onNavigateToTab: (tabId: string) => void
}

export function PeriodCloseChecklist({
  organizationId,
  companyId,
  fiscalYears,
  accountPeriods,
  moves,
  bankStatements,
  bankStatementLines,
  financialReports,
  sourceStates,
  requiredReports = [],
  onNavigateToTab,
}: PeriodCloseChecklistProps) {
  const { t } = useTranslation()
  const [targetPeriodId, setTargetPeriodId] = useState("")
  const [selectionCompany, setSelectionCompany] = useState(companyId)
  useEffect(() => { setTargetPeriodId(""); setSelectionCompany(companyId) }, [companyId])
  const stateFor = (...keys: PeriodCloseSource[]) => mergeModuleStates(keys.map((key) => sourceStates?.[key] ?? { status: "ready" }))
  const fiscalSource = stateFor("fiscalYears", "accountPeriods")
  const movesSource = stateFor("moves")
  const bankSource = stateFor("bankStatements", "bankStatementLines")
  const reportsSource = stateFor("financialReports")

  const companyFiscalYears = useMemo(
    () =>
      fiscalSource.status !== "ready" ? [] : fiscalYears.filter(
        (fy) => String(fy.companyId ?? fy.company_id ?? "") === String(companyId),
      ),
    [fiscalYears, companyId, fiscalSource.status],
  )

  const companyPeriods = useMemo(
    () =>
      fiscalSource.status !== "ready" ? [] : accountPeriods.filter(
        (p) => String(p.companyId ?? p.company_id ?? "") === String(companyId),
      ),
    [accountPeriods, companyId, fiscalSource.status],
  )

  const fiscalConfigured = companyFiscalYears.length > 0 && companyPeriods.length > 0

  const targetPeriod = useMemo(
    () => {
      if (selectionCompany !== companyId || fiscalSource.status !== "ready") return null
      const matches = companyPeriods.filter((period) => String(period.id ?? "") === targetPeriodId)
      return matches.length === 1 ? matches[0]! : null
    },
    [companyPeriods, targetPeriodId, selectionCompany, companyId, fiscalSource.status],
  )

  const targetRange = useMemo(() => {
    if (!targetPeriod) return null
    const dateFrom = rowDate(targetPeriod, "dateFrom", "date_from")
    const dateTo = rowDate(targetPeriod, "dateTo", "date_to")
    const fromMicros = stbTimestampMicros(targetPeriod.dateFrom ?? targetPeriod.date_from)
    const toMicros = stbTimestampMicros(targetPeriod.dateTo ?? targetPeriod.date_to)
    return dateFrom && dateTo && fromMicros != null && toMicros != null && fromMicros <= toMicros && Number.isFinite(dateFrom.getTime()) && Number.isFinite(dateTo.getTime()) ? { dateFrom, dateTo, fromMicros, toMicros } : null
  }, [targetPeriod])

  const draftMoves = useMemo<ScopedCount>(() => {
    if (!targetRange || movesSource.status !== "ready") return { available: false, count: 0 }
    let available = true
    let count = 0
    for (const move of moves) {
      const moveCompanyId = rowCompanyId(move)
      if (moveCompanyId == null) {
        available = false
        continue
      }
      if (moveCompanyId !== String(companyId)) continue
      const date = rowDate(move, "date")
      if (!date) {
        available = false
        continue
      }
      if (isInPeriod(date, targetRange.dateFrom, targetRange.dateTo) && !["draft", "posted", "cancelled", "cancel"].includes(stbEnumTag(move.state).toLowerCase())) {
        available = false
      }
      if (isInPeriod(date, targetRange.dateFrom, targetRange.dateTo) && moveStateIsDraft(move.state)) {
        count += 1
      }
    }
    return { available, count }
  }, [moves, companyId, targetRange, movesSource.status])

  const bankLines = useMemo<ScopedCount>(() => {
    if (!targetRange || bankSource.status !== "ready") return { available: false, count: 0 }
    const statementsById = new Map<string, PeriodCloseLookupRow[]>()
    for (const statement of bankStatements) {
      const statementId = rowId(statement, "id")
      if (statementId == null) continue
      const matchingStatements = statementsById.get(statementId) ?? []
      matchingStatements.push(statement)
      statementsById.set(statementId, matchingStatements)
    }

    let available = true
    let count = 0
    for (const line of bankStatementLines) {
      const statementId = rowId(line, "statementId", "statement_id")
      const matchingStatements = statementId == null ? [] : (statementsById.get(statementId) ?? [])
      if (matchingStatements.length !== 1) {
        available = false
        continue
      }
      const statementCompanyId = rowCompanyId(matchingStatements[0])
      if (statementCompanyId == null) {
        available = false
        continue
      }
      if (statementCompanyId !== String(companyId)) continue
      const date = rowDate(line, "date")
      if (!date) {
        available = false
        continue
      }
      if (isInPeriod(date, targetRange.dateFrom, targetRange.dateTo) && !rowIsReconciled(line)) {
        count += 1
      }
    }
    return { available, count }
  }, [bankStatements, bankStatementLines, companyId, targetRange, bankSource.status])

  const periodReports = useMemo(() => {
    if (!targetRange || reportsSource.status !== "ready") return []
    return financialReports.filter(
      (report) =>
        rowCompanyId(report) === String(companyId) &&
        reportCoversPeriod(report, targetRange.fromMicros, targetRange.toMicros),
    )
  }, [financialReports, companyId, targetRange, reportsSource.status])

  const vatReady = useMemo(() => {
    return periodReports.some((r) => {
      if (!reportTypeIsVat(r)) return false
      const st = reportStateNormalized(r)
      return st === "generated" || st === "exported" || st === "archived"
    })
  }, [periodReports])

  const trialBalanceReady = useMemo(() => {
    return periodReports.some((r) => {
      const tag = stbEnumTag(r.reportType ?? r.report_type)
      if (!tag.toLowerCase().includes("trial")) return false
      const st = reportStateNormalized(r)
      return st === "generated" || st === "exported" || st === "archived"
    })
  }, [periodReports])

  const targetPeriodState = targetPeriod ? accountPeriodStateTag(targetPeriod) : ""
  const targetOpenPeriodCount = targetPeriodState === "Open" ? 1 : 0

  const steps: CloseStep[] = useMemo(() => {
    const fiscalStatus: StepStatus = fiscalSource.status !== "ready" ? "blocked" : fiscalConfigured ? "done" : "pending"
    const hasTargetPeriod = targetPeriod != null && targetRange != null
    const bankStatus: StepStatus = !fiscalConfigured || !hasTargetPeriod || !bankLines.available
      ? "blocked"
      : bankLines.count === 0
        ? "done"
        : "pending"
    const draftStatus: StepStatus = !fiscalConfigured || !hasTargetPeriod || !draftMoves.available
      ? "blocked"
      : draftMoves.count === 0
        ? "done"
        : "pending"
    const tbStatus: StepStatus = !fiscalConfigured || !hasTargetPeriod || reportsSource.status !== "ready"
      ? "blocked"
      : trialBalanceReady
        ? "done"
        : "pending"
    const vatStatus: StepStatus = !fiscalConfigured || !hasTargetPeriod || reportsSource.status !== "ready"
      ? "blocked"
      : vatReady
        ? "done"
        : "pending"
    const closeStatus: StepStatus =
      !fiscalConfigured || !hasTargetPeriod || !draftMoves.available || !bankLines.available
      ? "blocked"
      : draftMoves.count > 0 || bankLines.count > 0 ||
        (requiredReports.includes("trial-balance") && !trialBalanceReady) ||
        (requiredReports.includes("vat-report") && !vatReady)
        ? "blocked"
        : targetPeriodState === "Closed"
          ? "done"
          : targetPeriodState === "Open"
            ? "pending"
            : "blocked"

    return [
      {
        id: "fiscal-calendar",
        title: t("accounting.periodClose.steps.fiscalCalendar.title"),
        description: t("accounting.periodClose.steps.fiscalCalendar.description"),
        status: fiscalStatus,
        tabId: "fiscal-years",
        icon: <Calendar className="h-5 w-5" />,
        sourceState: fiscalSource,
      },
      {
        id: "bank-recon",
        title: t("accounting.periodClose.steps.bankRecon.title"),
        description: bankLines.available
          ? t("accounting.periodClose.steps.bankRecon.description", { count: bankLines.count })
          : t("accounting.periodClose.steps.bankRecon.scopeUnavailable", {
              defaultValue: "Bank statement ownership cannot be resolved for this period.",
            }),
        status: bankStatus,
        tabId: "bank-statements",
        icon: <Landmark className="h-5 w-5" />,
        sourceState: bankSource,
      },
      {
        id: "draft-moves",
        title: t("accounting.periodClose.steps.draftMoves.title"),
        description: draftMoves.available
          ? t("accounting.periodClose.steps.draftMoves.description", { count: draftMoves.count })
          : t("accounting.periodClose.steps.draftMoves.scopeUnavailable", {
              defaultValue: "Journal entry company or period ownership is unavailable.",
            }),
        status: draftStatus,
        tabId: "journal-entries",
        icon: <FileText className="h-5 w-5" />,
        sourceState: movesSource,
      },
      {
        id: "trial-balance",
        title: t("accounting.periodClose.steps.trialBalance.title"),
        description: t("accounting.periodClose.steps.trialBalance.description"),
        status: tbStatus,
        href: organizationId && targetRange && targetPeriod ? periodReportHref({ organizationId: String(organizationId), companyId: String(companyId), periodId: String(targetPeriod.id), dateFrom: stbTimestampToExactIso(targetPeriod.dateFrom ?? targetPeriod.date_from)!, dateTo: stbTimestampToExactIso(targetPeriod.dateTo ?? targetPeriod.date_to)!, reportType: "trial-balance" }) : "/reports?tab=trial-balance",
        icon: <FileText className="h-5 w-5" />,
        sourceState: reportsSource,
      },
      {
        id: "vat-report",
        title: t("accounting.periodClose.steps.vatReport.title"),
        description: t("accounting.periodClose.steps.vatReport.description"),
        status: vatStatus,
        href: organizationId && targetRange && targetPeriod ? periodReportHref({ organizationId: String(organizationId), companyId: String(companyId), periodId: String(targetPeriod.id), dateFrom: stbTimestampToExactIso(targetPeriod.dateFrom ?? targetPeriod.date_from)!, dateTo: stbTimestampToExactIso(targetPeriod.dateTo ?? targetPeriod.date_to)!, reportType: "vat-report" }) : "/reports?tab=reports",
        icon: <Receipt className="h-5 w-5" />,
        sourceState: reportsSource,
      },
      {
        id: "close-period",
        title: t("accounting.periodClose.steps.closePeriod.title"),
        description: targetPeriod
          ? t("accounting.periodClose.steps.closePeriod.description", {
              count: targetOpenPeriodCount,
            })
          : t("accounting.periodClose.steps.closePeriod.selectPeriod", {
              defaultValue: "Select an accounting period to review close readiness.",
            }),
        status: closeStatus,
        tabId: "account-periods",
        icon: <Lock className="h-5 w-5" />,
      },
    ]
  }, [
    fiscalConfigured,
    targetPeriod,
    targetRange,
    bankLines,
    draftMoves,
    trialBalanceReady,
    vatReady,
    targetOpenPeriodCount,
    targetPeriodState,
    t,
    fiscalSource,
    movesSource,
    bankSource,
    reportsSource,
    requiredReports,
    organizationId,
    companyId,
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
        <label className="mt-4 block max-w-sm text-sm font-medium" htmlFor="period-close-target">
          {t("accounting.periodClose.targetPeriod.label", { defaultValue: "Accounting period" })}
        </label>
        <select
          id="period-close-target"
          data-testid="period-close-target"
          className="mt-1 h-9 w-full max-w-sm rounded-md border border-input bg-background px-3 text-sm"
          value={selectionCompany === companyId ? targetPeriodId : ""}
          disabled={fiscalSource.status !== "ready"}
          onChange={(event) => setTargetPeriodId(event.target.value)}
        >
          <option value="">
            {t("accounting.periodClose.targetPeriod.placeholder", {
              defaultValue: "Select a period to evaluate",
            })}
          </option>
          {companyPeriods.map((period) => (
            <option key={String(period.id)} value={String(period.id)}>
              {String(period.name ?? period.code ?? period.id)}
            </option>
          ))}
        </select>
        {targetRange ? <p className="mt-2 text-sm text-muted-foreground" data-testid="period-close-range">{t("accounting.periodClose.exactPeriod", { defaultValue: "Reviewing company {{company}} · {{from}} to {{to}}. Report evidence must cover these exact dates.", company: String(companyId), from: targetRange.dateFrom.toISOString().slice(0, 10), to: targetRange.dateTo.toISOString().slice(0, 10) })}</p> : null}
      </div>

      <div className="grid gap-4">
        {steps.map((step) => (
          <Card key={step.id} data-testid={`period-close-step-${step.id}`} data-status={step.status}>
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
              {step.sourceState && step.sourceState.status !== "ready" ? <div className="mb-3">{step.sourceState.status === "loading" ? <p role="status" className="text-sm text-muted-foreground">{t("accounting.periodClose.sourceLoading", { defaultValue: "Loading the source records needed for this check." })}</p> : <ModuleDataNotice state={step.sourceState} />}</div> : null}
              {step.href ? (
                <a
                  href={step.href}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  {t("accounting.periodClose.goToStep")}
                  <ExternalLink className="ml-2 h-4 w-4" />
                </a>
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

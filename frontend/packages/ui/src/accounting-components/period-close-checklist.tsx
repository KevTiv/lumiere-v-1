"use client"

import { useMemo, useState, type ReactNode } from "react"
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
import { accountMoveHref } from "@lumiere/erp-shared/record-links"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { kpiDate } from "@/lib/kpi-tiles"
import type { ModuleDataState } from "../lib/module-data-state"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/select"

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

type ScopedCount = {
  available: boolean
  count: number
  unknownCount: number
  records: CloseReviewRecord[]
}

type CloseReviewRecord = {
  id: string
  label: string
  date: string
  amount?: string
  statementId?: string
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
  return parseStrictU64(row.companyId ?? row.company_id)?.toString() ?? null
}

function rowId(row: PeriodCloseLookupRow, ...keys: (keyof PeriodCloseLookupRow)[]): string | null {
  for (const key of keys) {
    const id = parseStrictU64(row[key])
    if (id != null) return id.toString()
  }
  return null
}

function rowDate(row: PeriodCloseLookupRow, ...keys: (keyof PeriodCloseLookupRow)[]): Date | null {
  for (const key of keys) {
    const value = row[key]
    if (value != null) return kpiDate(value)
  }
  return null
}

function rowIsReconciled(row: PeriodCloseLookupRow): boolean | null {
  const value = row.isReconciled ?? row.is_reconciled
  return typeof value === "boolean" ? value : null
}

function rowIdentityCounts(rows: readonly PeriodCloseLookupRow[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const id = parseStrictU64(row.id)?.toString()
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

function isInPeriod(date: Date, dateFrom: Date, dateTo: Date): boolean {
  const value = date.getTime()
  return value >= dateFrom.getTime() && value <= dateTo.getTime()
}

function reportCoversPeriod(row: PeriodCloseLookupRow, dateFrom: Date, dateTo: Date): boolean {
  const reportFrom = rowDate(row, "dateFrom", "date_from")
  const reportTo = rowDate(row, "dateTo", "date_to")
  return reportFrom?.getTime() === dateFrom.getTime() && reportTo?.getTime() === dateTo.getTime()
}

function moveStateIsDraft(state: unknown): boolean | null {
  const tag =
    state != null && typeof state === "object" && "tag" in state
      ? String((state as { tag: unknown }).tag).toLowerCase()
      : String(state ?? "").toLowerCase()
  if (tag === "draft") return true
  if (tag === "posted" || tag === "cancelled") return false
  return null
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
  companyLabel?: string
  fiscalYears: Record<string, unknown>[]
  accountPeriods: Record<string, unknown>[]
  moves: Record<string, unknown>[]
  bankStatements: PeriodCloseLookupRow[]
  bankStatementLines: Record<string, unknown>[]
  financialReports: Record<string, unknown>[]
  onNavigateToTab: (tabId: string) => void
  dataState?: ModuleDataState
  onClosePeriod?: (periodId: bigint) => Promise<unknown>
  closePending?: boolean
  onInspectBankLine?: (statementId: string, lineId: string) => void
}

export function PeriodCloseChecklist({
  companyId,
  companyLabel,
  fiscalYears,
  accountPeriods,
  moves,
  bankStatements,
  bankStatementLines,
  financialReports,
  onNavigateToTab,
  dataState = { status: "ready" },
  onClosePeriod,
  closePending = false,
  onInspectBankLine,
}: PeriodCloseChecklistProps) {
  const { t } = useTranslation()
  const [targetPeriodId, setTargetPeriodId] = useState("")
  const [reviewPeriodId, setReviewPeriodId] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)

  const companyFiscalYears = useMemo(
    () => fiscalYears.filter((fy) => rowCompanyId(fy) === String(companyId)),
    [fiscalYears, companyId],
  )

  const companyPeriods = useMemo(
    () => accountPeriods.filter((p) => rowCompanyId(p) === String(companyId)),
    [accountPeriods, companyId],
  )

  const fiscalConfigured =
    dataState.status === "ready" && companyFiscalYears.length > 0 && companyPeriods.length > 0

  const targetPeriod = useMemo(() => {
    const matches = companyPeriods.filter((period) => String(period.id ?? "") === targetPeriodId)
    return matches.length === 1 ? matches[0]! : null
  }, [companyPeriods, targetPeriodId])

  const targetRange = useMemo(() => {
    if (!targetPeriod) return null
    const dateFrom = rowDate(targetPeriod, "dateFrom", "date_from")
    const dateTo = rowDate(targetPeriod, "dateTo", "date_to")
    return dateFrom && dateTo && dateFrom <= dateTo ? { dateFrom, dateTo } : null
  }, [targetPeriod])

  const draftMoves = useMemo<ScopedCount>(() => {
    if (!targetRange || dataState.status !== "ready")
      return { available: false, count: 0, unknownCount: 0, records: [] }
    let available = true
    let count = 0
    let unknownCount = 0
    const records: CloseReviewRecord[] = []
    const identities = rowIdentityCounts(moves)
    for (const move of moves) {
      const isDraft = moveStateIsDraft(move.state)
      if (isDraft === false) continue
      const moveCompanyId = rowCompanyId(move)
      if (moveCompanyId != null && moveCompanyId !== String(companyId)) continue
      const date = rowDate(move, "date")
      if (date && !isInPeriod(date, targetRange.dateFrom, targetRange.dateTo)) continue
      if (moveCompanyId == null) {
        available = false
        unknownCount += 1
        continue
      }
      if (!date) {
        available = false
        unknownCount += 1
        continue
      }
      const id = parseStrictU64(move.id)?.toString()
      if (!id || identities.get(id) !== 1 || isDraft == null) {
        available = false
        unknownCount += 1
        continue
      }
      count += 1
      records.push({
        id,
        label: String(move.name ?? move.ref ?? id),
        date: date.toISOString().slice(0, 10),
      })
    }
    return { available, count, unknownCount, records }
  }, [moves, companyId, targetRange, dataState.status])

  const bankLines = useMemo<ScopedCount>(() => {
    if (!targetRange || dataState.status !== "ready")
      return { available: false, count: 0, unknownCount: 0, records: [] }
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
    let unknownCount = 0
    const records: CloseReviewRecord[] = []
    const identities = rowIdentityCounts(bankStatementLines)
    for (const line of bankStatementLines) {
      const reconciled = rowIsReconciled(line)
      if (reconciled === true) continue
      const date = rowDate(line, "date")
      if (date && !isInPeriod(date, targetRange.dateFrom, targetRange.dateTo)) continue
      const statementId = rowId(line, "statementId", "statement_id")
      const matchingStatements = statementId == null ? [] : (statementsById.get(statementId) ?? [])
      if (matchingStatements.length !== 1) {
        available = false
        unknownCount += 1
        continue
      }
      const statementCompanyId = rowCompanyId(matchingStatements[0])
      if (statementCompanyId == null) {
        available = false
        unknownCount += 1
        continue
      }
      if (statementCompanyId !== String(companyId)) continue
      if (!date) {
        available = false
        unknownCount += 1
        continue
      }
      const id = parseStrictU64(line.id)?.toString()
      const parentId = parseStrictU64(statementId)?.toString()
      const lineCompanyId = rowCompanyId(line)
      if (
        !id ||
        !parentId ||
        identities.get(id) !== 1 ||
        reconciled == null ||
        (lineCompanyId != null && lineCompanyId !== statementCompanyId)
      ) {
        available = false
        unknownCount += 1
        continue
      }
      count += 1
      records.push({
        id,
        statementId: parentId,
        label: String(line.name ?? line.paymentRef ?? line.payment_ref ?? id),
        date: date.toISOString().slice(0, 10),
        amount: line.amount == null ? "—" : String(line.amount),
      })
    }
    return { available, count, unknownCount, records }
  }, [bankStatements, bankStatementLines, companyId, targetRange, dataState.status])

  const periodReports = useMemo(() => {
    if (!targetRange || dataState.status !== "ready") return []
    return financialReports.filter(
      (report) =>
        rowCompanyId(report) === String(companyId) &&
        reportCoversPeriod(report, targetRange.dateFrom, targetRange.dateTo),
    )
  }, [financialReports, companyId, targetRange, dataState.status])

  const vatReady = useMemo(() => {
    return periodReports.some((r) => {
      if (!reportTypeIsVat(r)) return false
      const st = reportStateNormalized(r)
      return st === "generated" || st === "exported" || st === "archived"
    })
  }, [periodReports])

  const trialBalanceReady = useMemo(() => {
    return periodReports.some((r) => {
      const raw = r.reportType ?? r.report_type
      const tag =
        raw != null && typeof raw === "object" && "tag" in raw
          ? String((raw as { tag?: string }).tag ?? "")
          : String(raw ?? "")
      if (!tag.toLowerCase().includes("trial")) return false
      const st = reportStateNormalized(r)
      return st === "generated" || st === "exported" || st === "archived"
    })
  }, [periodReports])

  const targetPeriodState = targetPeriod ? accountPeriodStateTag(targetPeriod) : ""
  const targetOpenPeriodCount = targetPeriodState === "Open" ? 1 : 0

  const steps: CloseStep[] = useMemo(() => {
    const fiscalStatus: StepStatus = fiscalConfigured ? "done" : "pending"
    const hasTargetPeriod = targetPeriod != null && targetRange != null
    const bankStatus: StepStatus =
      !fiscalConfigured || !hasTargetPeriod || !bankLines.available
        ? "blocked"
        : bankLines.count === 0
          ? "done"
          : "pending"
    const draftStatus: StepStatus =
      !fiscalConfigured || !hasTargetPeriod || !draftMoves.available
        ? "blocked"
        : draftMoves.count === 0
          ? "done"
          : "pending"
    const tbStatus: StepStatus =
      !fiscalConfigured || !hasTargetPeriod ? "blocked" : trialBalanceReady ? "done" : "pending"
    const vatStatus: StepStatus =
      !fiscalConfigured || !hasTargetPeriod ? "blocked" : vatReady ? "done" : "pending"
    const closeStatus: StepStatus =
      !fiscalConfigured || !hasTargetPeriod
        ? "blocked"
        : targetPeriodState === "Closed"
          ? "done"
          : !draftMoves.available || !bankLines.available || draftMoves.count > 0 || bankLines.count > 0
            ? "blocked"
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
      },
      {
        id: "bank-recon",
        title: t("accounting.periodClose.steps.bankRecon.title"),
        description: bankLines.available
          ? t("accounting.periodClose.steps.bankRecon.description", {
              count: bankLines.count,
            })
          : t("accounting.periodClose.steps.bankRecon.scopeUnavailable", {
              defaultValue: "Bank statement ownership cannot be resolved for this period.",
            }),
        status: bankStatus,
        tabId: "bank-statements",
        icon: <Landmark className="h-5 w-5" />,
      },
      {
        id: "draft-moves",
        title: t("accounting.periodClose.steps.draftMoves.title"),
        description: draftMoves.available
          ? t("accounting.periodClose.steps.draftMoves.description", {
              count: draftMoves.count,
            })
          : t("accounting.periodClose.steps.draftMoves.scopeUnavailable", {
              defaultValue: "Journal entry company or period ownership is unavailable.",
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
        href: "/reports?tab=trial-balance",
        icon: <FileText className="h-5 w-5" />,
      },
      {
        id: "vat-report",
        title: t("accounting.periodClose.steps.vatReport.title"),
        description: t("accounting.periodClose.steps.vatReport.description"),
        status: vatStatus,
        href: "/reports?tab=reports",
        icon: <Receipt className="h-5 w-5" />,
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
  ])

  const doneCount = steps.filter((s) => s.status === "done").length
  const periodName = String(targetPeriod?.name ?? targetPeriod?.code ?? targetPeriodId)
  const periodDates = targetRange
    ? `${targetRange.dateFrom.toISOString().slice(0, 10)} – ${targetRange.dateTo.toISOString().slice(0, 10)} (UTC)`
    : "—"
  const canClose =
    targetPeriodState === "Open" &&
    targetRange != null &&
    dataState.status === "ready" &&
    parseStrictU64(targetPeriod?.id) != null &&
    onClosePeriod != null
  const closeSelectedPeriod = async () => {
    const periodId = parseStrictU64(targetPeriod?.id)
    if (
      !canClose ||
      periodId == null ||
      !onClosePeriod ||
      closing ||
      closePending ||
      reviewPeriodId !== targetPeriodId
    )
      return
    setClosing(true)
    setCloseError(null)
    try {
      await onClosePeriod(periodId)
      setReviewPeriodId(null)
    } catch (cause) {
      setCloseError(
        cause instanceof Error
          ? cause.message
          : t("accounting.periodClose.review.failed", {
              defaultValue:
                "The close result could not be confirmed. Refresh the period before you try again.",
            }),
      )
    } finally {
      setClosing(false)
    }
  }
  const reviewSummary = (
    <dl
      className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2"
      data-testid="period-close-summary"
    >
      <div>
        <dt className="text-muted-foreground">
          {t("accounting.periodClose.review.company", { defaultValue: "Company" })}
        </dt>
        <dd>{companyLabel || String(companyId)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">
          {t("accounting.periodClose.review.period", {
            defaultValue: "Selected period",
          })}
        </dt>
        <dd className="font-medium">{periodName}</dd>
        <dd>{periodDates}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">
          {t("accounting.periodClose.review.state", {
            defaultValue: "Saved period state",
          })}
        </dt>
        <dd>{targetPeriodState || "—"}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">
          {t("accounting.periodClose.review.drafts", {
            defaultValue: "Confirmed draft journal entries",
          })}
        </dt>
        <dd>{dataState.status === "ready" ? draftMoves.count : "—"}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">
          {t("accounting.periodClose.review.bankLines", {
            defaultValue: "Confirmed unreconciled bank lines",
          })}
        </dt>
        <dd>{dataState.status === "ready" ? bankLines.count : "—"}</dd>
      </div>
    </dl>
  )

  return (
    <div className="space-y-6 p-1" data-testid="period-close-checklist">
      <div>
        <h2 className="text-lg font-semibold">{t("accounting.periodClose.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("accounting.periodClose.description")}</p>
        <p className="text-sm text-muted-foreground mt-1">
          {t("accounting.periodClose.progress", {
            done: doneCount,
            total: steps.length,
          })}
        </p>
        <label className="mt-4 block max-w-sm text-sm font-medium" htmlFor="period-close-target">
          {t("accounting.periodClose.targetPeriod.label", {
            defaultValue: "Accounting period",
          })}
        </label>
        <Select
          value={targetPeriodId}
          onValueChange={(value) => {
            setTargetPeriodId(value)
            setReviewPeriodId(null)
            setCloseError(null)
          }}
        >
          <SelectTrigger
            id="period-close-target"
            data-testid="period-close-target"
            className="w-full max-w-sm"
          >
            <SelectValue
              placeholder={t("accounting.periodClose.targetPeriod.placeholder", {
                defaultValue: "Select a period to evaluate",
              })}
            />
          </SelectTrigger>
          <SelectContent>
            {companyPeriods.map((period) => (
              <SelectItem key={String(period.id)} value={String(period.id)}>
                {String(period.name ?? period.code ?? period.id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {targetPeriod && targetRange ? (
        <Card data-testid="period-close-review">
          <CardHeader>
            <CardTitle>
              {t("accounting.periodClose.review.title", {
                defaultValue: "Review this period",
              })}
            </CardTitle>
            <CardDescription>
              {t("accounting.periodClose.review.advisory", {
                defaultValue:
                  "This checklist is a review aid. The server validates the close action; it does not post drafts or reconcile bank lines for you.",
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {reviewSummary}
            {dataState.status !== "ready" ? (
              <p role="alert">
                {t("accounting.periodClose.review.dataUnavailable", {
                  defaultValue:
                    "Period review data is incomplete or unavailable. Counts and close readiness cannot be confirmed.",
                })}
              </p>
            ) : null}
            <Button
              variant="outline"
              onClick={() => {
                setCloseError(null)
                setReviewPeriodId(targetPeriodId)
              }}
              disabled={closing || closePending}
            >
              {t("accounting.periodClose.review.open", {
                defaultValue: "Review close consequences",
              })}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4">
        {steps.map((step) => (
          <Card
            key={step.id}
            data-testid={`period-close-step-${step.id}`}
            data-status={step.status}
          >
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
                <a href={step.href} className={buttonVariants({ variant: "outline", size: "sm" })}>
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
              {(step.id === "draft-moves" || step.id === "bank-recon") && targetRange
                ? (() => {
                    const inspection = step.id === "draft-moves" ? draftMoves : bankLines
                    return (
                      <div
                        className="mt-4 space-y-2"
                        data-testid={`period-close-records-${step.id}`}
                      >
                        {inspection.unknownCount > 0 ? (
                          <p role="alert" className="text-sm">
                            {t("accounting.periodClose.review.unverified", {
                              defaultValue:
                                "Unverified records: {{count}}. Their scope, identity, or saved state cannot be verified. They are not counted as selected-period records.",
                              count: inspection.unknownCount,
                            })}
                          </p>
                        ) : null}
                        {inspection.records.length ? (
                          <Table aria-label={step.title}>
                            <TableHeader>
                              <TableRow>
                                <TableHead>
                                  {t("accounting.periodClose.review.record", {
                                    defaultValue: "Exact record",
                                  })}
                                </TableHead>
                                <TableHead>
                                  {t("accounting.periodClose.review.date", {
                                    defaultValue: "Date (UTC)",
                                  })}
                                </TableHead>
                                {step.id === "bank-recon" ? (
                                  <TableHead>
                                    {t("accounting.periodClose.review.amount", {
                                      defaultValue: "Saved amount",
                                    })}
                                  </TableHead>
                                ) : null}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {inspection.records.map((record) => (
                                <TableRow key={record.id} data-record-id={record.id}>
                                  <TableCell>
                                    {record.statementId ? (
                                      onInspectBankLine ? (
                                        <Button
                                          variant="link"
                                          size="sm"
                                          onClick={() =>
                                            onInspectBankLine(record.statementId!, record.id)
                                          }
                                        >
                                          {record.label} · #{record.id}
                                        </Button>
                                      ) : (
                                        <span>
                                          {record.label} · #{record.id}{" "}
                                          <span className="text-muted-foreground">
                                            (
                                            {t("accounting.periodClose.review.statement", {
                                              defaultValue: "Statement",
                                            })}{" "}
                                            #{record.statementId})
                                          </span>
                                        </span>
                                      )
                                    ) : (
                                      <a
                                        className="underline underline-offset-4"
                                        href={accountMoveHref(record.id)}
                                      >
                                        {record.label} · #{record.id}
                                      </a>
                                    )}
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap">{record.date}</TableCell>
                                  {record.statementId ? (
                                    <TableCell className="tabular-nums">{record.amount}</TableCell>
                                  ) : null}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        ) : null}
                      </div>
                    )
                  })()
                : null}
            </CardContent>
          </Card>
        ))}
      </div>
      <Dialog
        open={reviewPeriodId != null && reviewPeriodId === targetPeriodId}
        onOpenChange={(open) => {
          if (!open && !closing && !closePending) setReviewPeriodId(null)
        }}
      >
        <DialogContent
          className="max-h-[85dvh] overflow-y-auto sm:max-w-xl"
          showCloseButton={!closing && !closePending}
        >
          <DialogHeader>
            <DialogTitle>
              {t("accounting.periodClose.review.title", {
                defaultValue: "Review this period",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("accounting.periodClose.review.consequence", {
                defaultValue:
                  "Closing this period prevents new journal posting for dates in its range. It does not post drafts, reconcile bank lines, or generate reports.",
              })}
            </DialogDescription>
          </DialogHeader>
          {reviewSummary}
          {draftMoves.count > 0 || bankLines.count > 0 ? (
            <p role="alert">
              {t("accounting.periodClose.review.outstanding", {
                defaultValue:
                  "This period has outstanding records listed in the checklist. Review them before you close.",
              })}
            </p>
          ) : null}
          {!draftMoves.available || !bankLines.available ? (
            <p role="alert">
              {t("accounting.periodClose.review.unknown", {
                defaultValue:
                  "Some record scope or source data cannot be verified. The checklist cannot confirm that this period is ready to close.",
              })}
            </p>
          ) : null}
          {closeError ? (
            <p role="alert" className="text-destructive">
              {closeError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={closing || closePending}
              onClick={() => setReviewPeriodId(null)}
            >
              {t("accounting.periodClose.review.cancel", {
                defaultValue: "Return to checklist",
              })}
            </Button>
            {onClosePeriod ? (
              <Button
                disabled={!canClose || closing || closePending}
                onClick={() => {
                  void closeSelectedPeriod()
                }}
              >
                {t("accounting.periodClose.review.close", {
                  defaultValue: "Close selected period",
                })}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

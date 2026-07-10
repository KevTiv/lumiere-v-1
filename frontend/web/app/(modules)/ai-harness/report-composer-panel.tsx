"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@lumiere/ui/components/card"
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@lumiere/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@lumiere/ui/components/input-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lumiere/ui/components/select"
import { Badge } from "@lumiere/ui/components/badge"
import { Alert, AlertDescription, AlertTitle } from "@lumiere/ui/components/alert"
import { Separator } from "@lumiere/ui/components/separator"
import { Skeleton } from "@lumiere/ui/components/skeleton"
import {
  AlertCircle,
  Building2,
  CalendarDays,
  Clock,
  FileText,
  PlayCircle,
  ShieldCheck,
} from "lucide-react"

import { useReportCatalog } from "@lumiere/query-hooks/hooks/owner-reports"
import { useAiReportComposer } from "@lumiere/query-hooks/hooks/ai-report-composer"
import type { DecisionOutcome } from "@lumiere/erp-shared/ai-policy-schemas"
import type { ReportComposerResult } from "@lumiere/erp-shared/ai-report-composer-schemas"

interface ReportComposerPanelProps {
  organizationId: bigint
  companies: Record<string, unknown>[]
  defaultCompanyId?: number
}

function companyRowsToSelectOptions(
  rows: Record<string, unknown>[],
): Array<{ value: string; label: string }> {
  return rows.map((row) => ({
    value: String(row.id ?? ""),
    label: String(row.name ?? row.id ?? ""),
  }))
}

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10)
}

function timezoneInputValue(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

function decisionBadgeVariant(outcome: DecisionOutcome): "default" | "secondary" | "destructive" {
  switch (outcome) {
    case "allow":
      return "default"
    case "draft_only":
      return "secondary"
    case "deny":
      return "destructive"
    default:
      return "secondary"
  }
}

export function ReportComposerPanel({
  organizationId,
  companies,
  defaultCompanyId,
}: ReportComposerPanelProps) {
  const { t } = useTranslation()
  const catalog = useReportCatalog(organizationId)
  const compose = useAiReportComposer()

  const companyOptions = useMemo(
    () => companyRowsToSelectOptions(companies),
    [companies],
  )

  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(() => {
    if (defaultCompanyId && defaultCompanyId > 0) return String(defaultCompanyId)
    const first = companyOptions[0]
    return first?.value ?? ""
  })
  const [reportKey, setReportKey] = useState<string>(
    catalog.data?.reports.find((r) => r.key === "daily_business_summary_v1")?.key ?? "",
  )
  const [date, setDate] = useState(todayInputValue)
  const [timezone] = useState(timezoneInputValue)

  const reportOptions = useMemo(
    () =>
      (catalog.data?.reports ?? [])
        .filter((entry) => entry.availability === "preview")
        .map((entry) => ({ value: entry.key, label: entry.title })),
    [catalog.data],
  )

  const handleRun = async () => {
    const companyId = Number(selectedCompanyId)
    if (!reportKey || !Number.isFinite(companyId) || companyId <= 0) return
    await compose.mutateAsync({
      reportKey,
      companyId,
      date,
      timezone,
    })
  }

  if (catalog.isLoading) {
    return <ReportComposerPanelSkeleton />
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold tracking-tight">
            {t("aiHarness.reportComposer.title")}
          </h2>
          <Badge variant="default">
            {t("aiHarness.reportComposer.greenSkillBadge")}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("aiHarness.reportComposer.description")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("aiHarness.reportComposer.formTitle")}
          </CardTitle>
          <CardDescription>
            {t("aiHarness.reportComposer.formDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field>
              <FieldLabel>{t("aiHarness.reportComposer.companyLabel")}</FieldLabel>
              <Select
                value={selectedCompanyId}
                onValueChange={setSelectedCompanyId}
                disabled={companyOptions.length === 0}
              >
                <SelectTrigger>
                  <Building2 data-icon="inline-start" />
                  <SelectValue
                    placeholder={t("aiHarness.reportComposer.companyPlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {companyOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel>{t("aiHarness.reportComposer.reportLabel")}</FieldLabel>
              <Select
                value={reportKey}
                onValueChange={setReportKey}
                disabled={reportOptions.length === 0}
              >
                <SelectTrigger>
                  <FileText data-icon="inline-start" />
                  <SelectValue
                    placeholder={t("aiHarness.reportComposer.reportPlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {reportOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel>{t("aiHarness.reportComposer.dateLabel")}</FieldLabel>
              <InputGroup>
                <InputGroupAddon align="inline-start">
                  <CalendarDays />
                </InputGroupAddon>
                <InputGroupInput
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </InputGroup>
            </Field>

            <Field>
              <FieldLabel>{t("aiHarness.reportComposer.timezoneLabel")}</FieldLabel>
              <InputGroup>
                <InputGroupAddon align="inline-start">
                  <Clock />
                </InputGroupAddon>
                <InputGroupInput type="text" value={timezone} readOnly />
              </InputGroup>
            </Field>
          </FieldGroup>

          <Separator className="my-4" />

          <Button
            disabled={
              !reportKey ||
              !selectedCompanyId ||
              compose.isPending
            }
            onClick={handleRun}
          >
            <PlayCircle data-icon="inline-start" />
            {t("aiHarness.reportComposer.runButton")}
          </Button>
        </CardContent>
      </Card>

      {compose.isPending && <ReportComposerPanelSkeleton />}

      {compose.error && !compose.isPending && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>{t("aiHarness.reportComposer.errorTitle")}</AlertTitle>
          <AlertDescription>
            {compose.error instanceof Error
              ? compose.error.message
              : t("aiHarness.reportComposer.errorDescription")}
          </AlertDescription>
        </Alert>
      )}

      {compose.data && !compose.isPending && (
        <ReportComposerResultView result={compose.data} />
      )}
    </div>
  )
}

function ReportComposerResultView({ result }: { result: ReportComposerResult }) {
  const { t } = useTranslation()
  const { decision } = result.decision

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck />
            <CardTitle className="text-base">
              {t("aiHarness.reportComposer.decisionTitle")}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={decisionBadgeVariant(decision.outcome)}>
              {decision.outcome}
            </Badge>
            {decision.risk && (
              <Badge variant="outline">{decision.risk}</Badge>
            )}
            {result.decision.privacy && (
              <Badge variant="outline">
                {t("aiHarness.reportComposer.rowsProcessed", {
                  count: result.decision.privacy.rowsProcessed,
                })}
              </Badge>
            )}
          </div>

          {decision.reasons.length > 0 && (
            <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-muted-foreground">
              {decision.reasons.map((reason) => (
                <li key={reason.code}>
                  <span className="font-medium">[{reason.code}]</span>{" "}
                  {reason.message}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {decision.outcome === "allow" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("aiHarness.reportComposer.summaryTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed">{result.summary}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("aiHarness.reportComposer.citationsTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {result.citations.map((citation, index) => (
                  <div
                    key={`${citation.source}-${citation.label}-${index}`}
                    className="flex flex-col gap-1 rounded-lg border p-3"
                  >
                    <span className="text-xs font-medium uppercase text-muted-foreground">
                      {citation.source}
                    </span>
                    <span className="font-medium">{citation.label}</span>
                    <span className="text-sm text-muted-foreground">
                      {citation.valueMinorUnits}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function ReportComposerPanelSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  )
}

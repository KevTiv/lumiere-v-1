"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  useArchiveFinancialReport,
  useExportFinancialReport,
  useGenerateEuVatReport,
} from "@lumiere/query-hooks/hooks/reports"
import { useCurrencies } from "@lumiere/query-hooks/hooks/settings"
import {
  EntityTable,
  vatReportsTableConfig,
  Button,
  Input,
  Label,
} from "@lumiere/ui"
import type { EntityTableConfig } from "@lumiere/ui"
import { Archive, FileDown, FileSpreadsheet, PlayCircle } from "lucide-react"
import { reportStateTag } from "@/lib/reports-create-params"
import { useToast } from "@/hooks/use-toast"
import { currencyOptionsFromRows } from "@/lib/form-lookup"

type VatReportPanelProps = {
  organizationId: bigint
  financialReports: Record<string, unknown>[]
}

function reportTypeTag(row: Record<string, unknown>): string {
  const raw = row.reportType ?? row.report_type
  if (typeof raw === "string") return raw
  if (raw && typeof raw === "object" && "tag" in (raw as object)) {
    return String((raw as { tag?: string }).tag ?? "")
  }
  return String(raw ?? "")
}

function parseBoxes(row: Record<string, unknown>): Record<string, number> {
  const raw = row.reportData ?? row.report_data
  if (typeof raw !== "string" || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as { boxes?: Record<string, number> }
    return parsed.boxes ?? {}
  } catch {
    return {}
  }
}

function vatRowIsExportable(row: Record<string, unknown>): boolean {
  return reportStateTag(row.state) === "generated"
}

function vatRowIsArchivable(row: Record<string, unknown>): boolean {
  return reportStateTag(row.state) === "exported"
}

function mutationErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== "" ? error.message : fallback
}

export function VatReportPanel({ organizationId, financialReports }: VatReportPanelProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const generateEuVatReport = useGenerateEuVatReport(organizationId)
  const exportFinancialReport = useExportFinancialReport(organizationId)
  const archiveFinancialReport = useArchiveFinancialReport(organizationId)
  const { data: currencies = [] } = useCurrencies()

  const [name, setName] = useState("EU VAT Return")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [locale, setLocale] = useState("EU")
  const [currencyId, setCurrencyId] = useState("")
  const currencyOptions = useMemo(() => currencyOptionsFromRows(currencies), [currencies])

  useEffect(() => {
    if (!currencyId && currencyOptions[0]) setCurrencyId(currencyOptions[0].value)
  }, [currencyId, currencyOptions])

  const vatReports = useMemo(
    () =>
      financialReports
        .filter((r) => {
          const tag = reportTypeTag(r as Record<string, unknown>).toLowerCase()
          return tag.includes("vat")
        })
        .map((row) => {
          const boxes = parseBoxes(row as Record<string, unknown>)
          const net =
            boxes.box_71_vat_payable != null
              ? boxes.box_71_vat_payable
              : (boxes.box_02_vat_due_on_sales ?? 0) - (boxes.box_04_vat_deductible ?? 0)
          return {
            ...row,
            state: reportStateTag((row as { state?: unknown }).state),
            box01TaxableSupplies: boxes.box_01_taxable_supplies ?? 0,
            box02VatDue: boxes.box_02_vat_due_on_sales ?? 0,
            netVat: net,
          }
        }),
    [financialReports],
  )

  const tableConfig = useMemo((): EntityTableConfig => {
    const base = vatReportsTableConfig(t).view as EntityTableConfig
    return {
      ...base,
      actions: [
        {
          id: "vat-exp-pdf",
          label: t("reports.actions.exportPdf"),
          icon: FileDown,
          requiresSelection: true,
          onClick: (rows) => {
            for (const r of rows) {
              if (!vatRowIsExportable(r)) {
                toast({
                  variant: "destructive",
                  title: t("reports.vat.errors.exportBlocked"),
                  description: t("reports.vat.errors.exportRequiresGenerated"),
                })
                continue
              }
              void exportFinancialReport
                .mutateAsync({
                  reportId: r.id as string | number | bigint,
                  exportFormat: "pdf",
                })
                .catch((e) => {
                  toast({
                    variant: "destructive",
                    title: t("reports.vat.errors.exportFailed"),
                    description: mutationErrorMessage(e, t("common.error.generic")),
                  })
                })
            }
          },
        },
        {
          id: "vat-exp-xlsx",
          label: t("reports.actions.exportXlsx"),
          icon: FileSpreadsheet,
          requiresSelection: true,
          onClick: (rows) => {
            for (const r of rows) {
              if (!vatRowIsExportable(r)) {
                toast({
                  variant: "destructive",
                  title: t("reports.vat.errors.exportBlocked"),
                  description: t("reports.vat.errors.exportRequiresGenerated"),
                })
                continue
              }
              void exportFinancialReport
                .mutateAsync({
                  reportId: r.id as string | number | bigint,
                  exportFormat: "xlsx",
                })
                .catch((e) => {
                  toast({
                    variant: "destructive",
                    title: t("reports.vat.errors.exportFailed"),
                    description: mutationErrorMessage(e, t("common.error.generic")),
                  })
                })
            }
          },
        },
        {
          id: "vat-archive",
          label: t("reports.actions.archive"),
          icon: Archive,
          requiresSelection: true,
          onClick: (rows) => {
            for (const r of rows) {
              const st = reportStateTag(r.state)
              if (st === "archived") {
                toast({
                  variant: "destructive",
                  title: t("reports.vat.errors.archiveBlocked"),
                  description: t("reports.vat.errors.alreadyArchived"),
                })
                continue
              }
              if (!vatRowIsArchivable(r)) {
                toast({
                  variant: "destructive",
                  title: t("reports.vat.errors.archiveBlocked"),
                  description: t("reports.vat.errors.archiveRequiresExported"),
                })
                continue
              }
              void archiveFinancialReport
                .mutateAsync(r.id as string | number | bigint)
                .catch((e) => {
                  toast({
                    variant: "destructive",
                    title: t("reports.vat.errors.archiveFailed"),
                    description: mutationErrorMessage(e, t("common.error.generic")),
                  })
                })
            }
          },
        },
      ],
    }
  }, [t, exportFinancialReport, archiveFinancialReport, toast])

  return (
    <div className="space-y-6 p-4">
      <div>
        <h2 className="text-lg font-semibold">{t("reports.vat.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("reports.vat.description")}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <Label>{t("reports.vat.name")}</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>{t("reports.vat.dateFrom")}</Label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>{t("reports.vat.dateTo")}</Label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>{t("reports.vat.locale")}</Label>
          <Input value={locale} onChange={(e) => setLocale(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vat-report-currency">Currency</Label>
          <select
            id="vat-report-currency"
            value={currencyId}
            onChange={(event) => setCurrencyId(event.target.value)}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm"
          >
            {currencyOptions.map((currency) => (
              <option key={currency.value} value={currency.value}>{currency.label}</option>
            ))}
          </select>
        </div>
      </div>

      <Button
        disabled={!name.trim() || !dateFrom || !dateTo || !currencyId || generateEuVatReport.isPending}
        data-testid="vat-report-generate"
        onClick={() =>
          void generateEuVatReport
            .mutateAsync({
              name,
              dateFrom: `${dateFrom}T00:00:00.000Z`,
              dateTo: `${dateTo}T23:59:59.999Z`,
              currencyId: Number(currencyId),
              locale,
            })
            .catch((e) => {
              toast({
                variant: "destructive",
                title: t("reports.vat.errors.generateFailed"),
                description: mutationErrorMessage(e, t("common.error.generic")),
              })
            })
        }
      >
        <PlayCircle className="mr-2 h-4 w-4" />
        {t("reports.vat.generate")}
      </Button>

      <EntityTable config={tableConfig} data={vatReports} />
    </div>
  )
}

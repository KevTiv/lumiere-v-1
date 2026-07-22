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
  PackageSearch,
  PlayCircle,
  ShieldCheck,
} from "lucide-react"

import { useAiLowStockScan } from "@lumiere/query-hooks/hooks/ai-low-stock"
import type { DecisionOutcome } from "@lumiere/erp-shared/ai-policy-schemas"
import type { LowStockScanResult } from "@lumiere/erp-shared/ai-low-stock-schemas"
import { companyRowsToSelectOptions } from "@/lib/form-lookup"

import { HarnessAuditTrailCard } from "./harness-audit-trail-card"

interface LowStockPanelProps {
  organizationId: bigint
  companies: Record<string, unknown>[]
  defaultCompanyId?: number
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

export function LowStockPanel({
  companies,
  defaultCompanyId,
}: LowStockPanelProps) {
  const { t } = useTranslation()
  const scan = useAiLowStockScan()

  const companyOptions = useMemo(
    () => companyRowsToSelectOptions(companies),
    [companies],
  )

  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(() => {
    if (defaultCompanyId && defaultCompanyId > 0) return String(defaultCompanyId)
    const first = companyOptions[0]
    return first?.value ?? ""
  })
  const [threshold, setThreshold] = useState("5")

  const handleRun = async () => {
    const companyId = Number(selectedCompanyId)
    const thresholdValue = Number(threshold)
    if (!Number.isFinite(companyId) || companyId <= 0) return
    if (!Number.isFinite(thresholdValue) || thresholdValue < 0) return
    await scan.mutateAsync({
      companyId,
      threshold: thresholdValue,
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold tracking-tight">
            {t("aiHarness.lowStock.title")}
          </h2>
          <Badge variant="default">
            {t("aiHarness.lowStock.greenSkillBadge")}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("aiHarness.lowStock.description")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("aiHarness.lowStock.formTitle")}
          </CardTitle>
          <CardDescription>
            {t("aiHarness.lowStock.formDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>{t("aiHarness.lowStock.companyLabel")}</FieldLabel>
              <Select
                value={selectedCompanyId}
                onValueChange={setSelectedCompanyId}
                disabled={companyOptions.length === 0}
              >
                <SelectTrigger>
                  <Building2 data-icon="inline-start" />
                  <SelectValue
                    placeholder={t("aiHarness.lowStock.companyPlaceholder")}
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
              <FieldLabel>{t("aiHarness.lowStock.thresholdLabel")}</FieldLabel>
              <InputGroup>
                <InputGroupAddon align="inline-start">
                  <PackageSearch />
                </InputGroupAddon>
                <InputGroupInput
                  type="number"
                  min={0}
                  step={1}
                  value={threshold}
                  onChange={(event) => setThreshold(event.target.value)}
                />
              </InputGroup>
            </Field>
          </FieldGroup>

          <Separator className="my-4" />

          <Button
            disabled={!selectedCompanyId || scan.isPending}
            onClick={handleRun}
          >
            <PlayCircle data-icon="inline-start" />
            {t("aiHarness.lowStock.runButton")}
          </Button>
        </CardContent>
      </Card>

      {scan.isPending && <LowStockPanelSkeleton />}

      {scan.error && !scan.isPending && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>{t("aiHarness.lowStock.errorTitle")}</AlertTitle>
          <AlertDescription>
            {scan.error instanceof Error
              ? scan.error.message
              : t("aiHarness.lowStock.errorDescription")}
          </AlertDescription>
        </Alert>
      )}

      {scan.data && !scan.isPending && (
        <LowStockResultView result={scan.data} />
      )}
    </div>
  )
}

function LowStockResultView({ result }: { result: LowStockScanResult }) {
  const { t } = useTranslation()
  const { decision } = result.decision

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck />
            <CardTitle className="text-base">
              {t("aiHarness.lowStock.decisionTitle")}
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
                {t("aiHarness.lowStock.summaryTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed">{result.summary}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("aiHarness.lowStock.itemsTitle", { count: result.items.length })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {result.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("aiHarness.lowStock.emptyItems")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-4">{t("aiHarness.lowStock.skuColumn")}</th>
                        <th className="py-2 pr-4">{t("aiHarness.lowStock.nameColumn")}</th>
                        <th className="py-2 pr-4">{t("aiHarness.lowStock.qtyColumn")}</th>
                        <th className="py-2">{t("aiHarness.lowStock.reorderColumn")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.items.map((item) => (
                        <tr key={item.productId} className="border-b last:border-0">
                          <td className="py-2 pr-4 font-mono text-xs">{item.sku || "—"}</td>
                          <td className="py-2 pr-4">{item.name}</td>
                          <td className="py-2 pr-4">{item.quantityOnHand}</td>
                          <td className="py-2">{item.reorderLevel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <HarnessAuditTrailCard audit={result.audit} />
    </div>
  )
}

function LowStockPanelSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  )
}

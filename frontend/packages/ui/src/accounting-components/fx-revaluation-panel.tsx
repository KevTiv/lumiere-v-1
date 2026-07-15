"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { FormModal } from "@/components/forms/form-modal"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { runFxRevaluationForm } from "@/lib/accounting-form-configs"
import { mergeSelectOptionsForFields } from "@/lib/form-config-merge"

export interface FxRevaluationPanelProps {
  runs: Record<string, unknown>[]
  onRunFxRevaluation: (params: Record<string, unknown>) => void | Promise<void>
  onCreateCurrencyRate?: (params: Record<string, unknown>) => void | Promise<void>
  runPending?: boolean
  journalSelectOptions?: Array<{ value: string; label: string; disabled?: boolean }>
  accountSelectOptions?: Array<{ value: string; label: string; disabled?: boolean }>
}

function strVal(v: unknown): string {
  return v == null ? "" : String(v)
}

export function FxRevaluationPanel({
  runs,
  onRunFxRevaluation,
  onCreateCurrencyRate,
  runPending,
  journalSelectOptions = [],
  accountSelectOptions = [],
}: FxRevaluationPanelProps) {
  const { t } = useTranslation()
  const [showRun, setShowRun] = useState(false)
  const [showRate, setShowRate] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(runFxRevaluationForm(t), {
        journalId: journalSelectOptions,
        accountId: accountSelectOptions,
        gainAccountId: accountSelectOptions,
        lossAccountId: accountSelectOptions,
      }),
    [t, journalSelectOptions, accountSelectOptions],
  )

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("accounting.fxRevaluation.panelTitle")}</CardTitle>
          <CardDescription>{t("accounting.fxRevaluation.panelDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => { setError(null); setShowRun(true) }}>
            {t("accounting.fxRevaluation.runAction")}
          </Button>
          {onCreateCurrencyRate ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setShowRate(true)}>
              {t("accounting.fxRevaluation.importRateHint")}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("accounting.fxRevaluation.runsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("accounting.fxRevaluation.runsEmpty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("accounting.fxRevaluation.colCurrency")}</TableHead>
                  <TableHead>{t("accounting.fxRevaluation.colNet")}</TableHead>
                  <TableHead>{t("accounting.fxRevaluation.colMove")}</TableHead>
                  <TableHead>{t("accounting.fxRevaluation.colReference")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((row) => (
                  <TableRow key={String(row.id ?? strVal(row.moveId))}>
                    <TableCell>{strVal(row.currencyCode ?? row.currency_code)}</TableCell>
                    <TableCell>{strVal(row.netAdjustment ?? row.net_adjustment)}</TableCell>
                    <TableCell>{strVal(row.moveId ?? row.move_id)}</TableCell>
                    <TableCell>{strVal(row.reference)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {showRun ? (
        <FormModal
          open
          onOpenChange={(open) => !open && setShowRun(false)}
          config={runFormConfig}
          isPending={runPending}
          closeOnSubmit={false}
          submitError={error}
          onSubmit={async (data) => {
            setError(null)
            try {
              await onRunFxRevaluation(data)
              setShowRun(false)
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      ) : null}

      {showRate && onCreateCurrencyRate ? (
        <FormModal
          open
          onOpenChange={(open) => !open && setShowRate(false)}
          config={{
            id: "fx-rate-quick",
            title: t("accounting.forms.newCurrencyRate.title"),
            description: t("accounting.fxRevaluation.rateModalDescription"),
            submitLabel: t("accounting.forms.newCurrencyRate.submitLabel"),
            cancelLabel: t("common.cancel"),
            sections: [
              {
                id: "main",
                title: t("accounting.forms.newCurrencyRate.sections.main"),
                fields: [
                  {
                    id: "fromCurrency",
                    name: "fromCurrency",
                    type: "text",
                    label: t("accounting.forms.newCurrencyRate.fields.fromCurrency"),
                    required: true,
                    width: "1/2",
                  },
                  {
                    id: "toCurrency",
                    name: "toCurrency",
                    type: "text",
                    label: t("accounting.forms.newCurrencyRate.fields.toCurrency"),
                    required: true,
                    width: "1/2",
                  },
                  {
                    id: "rate",
                    name: "rate",
                    type: "number",
                    label: t("accounting.forms.newCurrencyRate.fields.rate"),
                    required: true,
                    width: "1/2",
                  },
                ],
              },
            ],
          }}
          onSubmit={async (data) => {
            await onCreateCurrencyRate(data)
            setShowRate(false)
          }}
        />
      ) : null}
    </div>
  )
}

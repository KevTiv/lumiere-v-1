"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { EntityView } from "@/components/entity-views/entity-view"
import { FormModal } from "@/components/forms/form-modal"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { fxRevaluationRunsTableConfig } from "@/lib/accounting-entity-configs"
import {
  postRealizedFxForm,
  runFxRevaluationBatchForm,
  runFxRevaluationForm,
} from "@/lib/accounting-form-configs"
import { mergeSelectOptionsForFields } from "@/lib/form-config-merge"

export interface FxRevaluationPanelProps {
  runs: Record<string, unknown>[]
  onRunFxRevaluation: (params: Record<string, unknown>) => void | Promise<void>
  onRunFxRevaluationBatch?: (params: Record<string, unknown>) => void | Promise<void>
  onPostRealizedFx?: (params: Record<string, unknown>) => void | Promise<void>
  onCreateCurrencyRate?: (params: Record<string, unknown>) => void | Promise<void>
  runPending?: boolean
  batchPending?: boolean
  realizedPending?: boolean
  journalSelectOptions?: Array<{ value: string; label: string; disabled?: boolean }>
  currencySelectOptions?: Array<{ value: string; label: string; disabled?: boolean }>
  accountSelectOptions?: Array<{ value: string; label: string; disabled?: boolean }>
  paymentSelectOptions?: Array<{ value: string; label: string; disabled?: boolean }>
  moveSelectOptions?: Array<{ value: string; label: string; disabled?: boolean }>
}

export function FxRevaluationPanel({
  runs,
  onRunFxRevaluation,
  onRunFxRevaluationBatch,
  onPostRealizedFx,
  onCreateCurrencyRate,
  runPending,
  batchPending,
  realizedPending,
  journalSelectOptions = [],
  currencySelectOptions = [],
  accountSelectOptions = [],
  paymentSelectOptions = [],
  moveSelectOptions = [],
}: FxRevaluationPanelProps) {
  const { t } = useTranslation()
  const [showRun, setShowRun] = useState(false)
  const [showBatch, setShowBatch] = useState(false)
  const [showRealized, setShowRealized] = useState(false)
  const [showRate, setShowRate] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runsTableConfig = useMemo(() => fxRevaluationRunsTableConfig(t), [t])

  const runFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(runFxRevaluationForm(t), {
        currencyId: currencySelectOptions,
        journalId: journalSelectOptions,
        accountId: accountSelectOptions,
        gainAccountId: accountSelectOptions,
        lossAccountId: accountSelectOptions,
      }),
    [t, currencySelectOptions, journalSelectOptions, accountSelectOptions],
  )

  const batchFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(runFxRevaluationBatchForm(t), {
        currencyId: currencySelectOptions,
        journalId: journalSelectOptions,
        gainAccountId: accountSelectOptions,
        lossAccountId: accountSelectOptions,
      }),
    [t, currencySelectOptions, journalSelectOptions, accountSelectOptions],
  )

  const realizedFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(postRealizedFxForm(t), {
        paymentId: paymentSelectOptions,
        invoiceMoveId: moveSelectOptions,
        journalId: journalSelectOptions,
        clearingAccountId: accountSelectOptions,
        gainAccountId: accountSelectOptions,
        lossAccountId: accountSelectOptions,
      }),
    [t, paymentSelectOptions, moveSelectOptions, journalSelectOptions, accountSelectOptions],
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
          {onRunFxRevaluationBatch ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => { setError(null); setShowBatch(true) }}
            >
              {t("accounting.fxRevaluation.batchAction")}
            </Button>
          ) : null}
          {onPostRealizedFx ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => { setError(null); setShowRealized(true) }}
            >
              {t("accounting.fxRevaluation.realizedAction")}
            </Button>
          ) : null}
          {onCreateCurrencyRate ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setShowRate(true)}>
              {t("accounting.fxRevaluation.importRateHint")}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <EntityView config={runsTableConfig} data={runs} />

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

      {showBatch && onRunFxRevaluationBatch ? (
        <FormModal
          open
          onOpenChange={(open) => !open && setShowBatch(false)}
          config={batchFormConfig}
          isPending={batchPending}
          closeOnSubmit={false}
          submitError={error}
          onSubmit={async (data) => {
            setError(null)
            try {
              await onRunFxRevaluationBatch(data)
              setShowBatch(false)
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      ) : null}

      {showRealized && onPostRealizedFx ? (
        <FormModal
          open
          onOpenChange={(open) => !open && setShowRealized(false)}
          config={realizedFormConfig}
          isPending={realizedPending}
          closeOnSubmit={false}
          submitError={error}
          onSubmit={async (data) => {
            setError(null)
            try {
              await onPostRealizedFx(data)
              setShowRealized(false)
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

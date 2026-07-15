"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { EntityView } from "@/components/entity-views/entity-view"
import { FormModal } from "@/components/forms/form-modal"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  amortizationLinesTableConfig,
  amortizationSchedulesTableConfig,
} from "@/lib/accounting-entity-configs"
import { createAmortizationScheduleForm } from "@/lib/accounting-form-configs"
import type { EntityTableConfig, EntityViewConfig } from "@/lib/entity-view-types"
import { mergeSelectOptionsForFields } from "@/lib/form-config-merge"

export interface AmortizationPanelProps {
  schedules: Record<string, unknown>[]
  lines: Record<string, unknown>[]
  onCreateSchedule: (params: Record<string, unknown>) => void | Promise<void>
  onRecognizeLine: (args: {
    lineId: bigint
    params: Record<string, unknown>
  }) => void | Promise<void>
  createPending?: boolean
  recognizePending?: boolean
  journalSelectOptions?: Array<{ value: string; label: string; disabled?: boolean }>
  accountSelectOptions?: Array<{ value: string; label: string; disabled?: boolean }>
  currencySelectOptions?: Array<{ value: string; label: string; disabled?: boolean }>
}

function toBigIntId(v: unknown): bigint | null {
  try {
    if (typeof v === "bigint") return v
    if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v))
    if (typeof v === "string" && v.trim() !== "") return BigInt(v.trim())
  } catch {
    return null
  }
  return null
}

export function AmortizationPanel({
  schedules,
  lines,
  onCreateSchedule,
  onRecognizeLine,
  createPending,
  recognizePending,
  journalSelectOptions = [],
  accountSelectOptions = [],
  currencySelectOptions = [],
}: AmortizationPanelProps) {
  const { t } = useTranslation()
  const [showCreate, setShowCreate] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recognizingId, setRecognizingId] = useState<string | null>(null)

  const schedulesConfig = useMemo(() => amortizationSchedulesTableConfig(t), [t])

  const openLines = useMemo(
    () => lines.filter((row) => !Boolean(row.recognized)),
    [lines],
  )

  const linesConfig = useMemo((): EntityViewConfig => {
    const base = amortizationLinesTableConfig(t)
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        columns: [
          ...view.columns,
          {
            key: "recognize",
            label: t("accounting.amortization.colRecognize"),
            width: "min-w-32",
            render: (_value, row) => {
              const id = toBigIntId(row.id)
              const rowKey = String(row.id)
              return (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!id || recognizePending}
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (!id) return
                    setError(null)
                    setRecognizingId(rowKey)
                    try {
                      await onRecognizeLine({ lineId: id, params: {} })
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err))
                    } finally {
                      setRecognizingId(null)
                    }
                  }}
                >
                  {recognizingId === rowKey
                    ? t("common.loading")
                    : t("accounting.amortization.recognizeAction")}
                </Button>
              )
            },
          },
        ],
      },
    }
  }, [t, recognizePending, recognizingId, onRecognizeLine])

  const createFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(createAmortizationScheduleForm(t), {
        journalId: journalSelectOptions,
        balanceSheetAccountId: accountSelectOptions,
        plAccountId: accountSelectOptions,
        currencyId: currencySelectOptions,
      }),
    [t, journalSelectOptions, accountSelectOptions, currencySelectOptions],
  )

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("accounting.amortization.panelTitle")}</CardTitle>
          <CardDescription>{t("accounting.amortization.panelDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" size="sm" onClick={() => { setError(null); setShowCreate(true) }}>
            {t("accounting.amortization.createAction")}
          </Button>
        </CardContent>
      </Card>

      <EntityView config={schedulesConfig} data={schedules} />
      <EntityView config={linesConfig} data={openLines} />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {showCreate ? (
        <FormModal
          open
          onOpenChange={(open) => !open && setShowCreate(false)}
          config={createFormConfig}
          isPending={createPending}
          closeOnSubmit={false}
          submitError={error}
          onSubmit={async (data) => {
            setError(null)
            try {
              await onCreateSchedule(data)
              setShowCreate(false)
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      ) : null}
    </div>
  )
}

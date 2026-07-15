"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { EntityView } from "@/components/entity-views/entity-view"
import { FormModal } from "@/components/forms/form-modal"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { partnerCreditControlsTableConfig } from "@/lib/accounting-entity-configs"
import {
  createBadDebtWriteOffForm,
  upsertPartnerCreditControlForm,
} from "@/lib/accounting-form-configs"
import { mergeSelectOptionsForFields } from "@/lib/form-config-merge"

export interface PartnerCreditControlPanelProps {
  controls: Record<string, unknown>[]
  onUpsertCreditControl: (params: Record<string, unknown>) => void | Promise<void>
  onCreateBadDebtWriteOff: (params: Record<string, unknown>) => void | Promise<void>
  upsertPending?: boolean
  writeOffPending?: boolean
  partnerSelectOptions?: Array<{ value: string; label: string; disabled?: boolean }>
  journalSelectOptions?: Array<{ value: string; label: string; disabled?: boolean }>
  accountSelectOptions?: Array<{ value: string; label: string; disabled?: boolean }>
  moveSelectOptions?: Array<{ value: string; label: string; disabled?: boolean }>
}

export function PartnerCreditControlPanel({
  controls,
  onUpsertCreditControl,
  onCreateBadDebtWriteOff,
  upsertPending,
  writeOffPending,
  partnerSelectOptions = [],
  journalSelectOptions = [],
  accountSelectOptions = [],
  moveSelectOptions = [],
}: PartnerCreditControlPanelProps) {
  const { t } = useTranslation()
  const [showUpsert, setShowUpsert] = useState(false)
  const [showWriteOff, setShowWriteOff] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const controlsTableConfig = useMemo(() => partnerCreditControlsTableConfig(t), [t])

  const upsertFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(upsertPartnerCreditControlForm(t), {
        partnerId: partnerSelectOptions,
      }),
    [t, partnerSelectOptions],
  )

  const writeOffFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(createBadDebtWriteOffForm(t), {
        partnerId: partnerSelectOptions,
        moveId: moveSelectOptions,
        journalId: journalSelectOptions,
        receivableAccountId: accountSelectOptions,
        writeOffAccountId: accountSelectOptions,
      }),
    [t, partnerSelectOptions, moveSelectOptions, journalSelectOptions, accountSelectOptions],
  )

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("accounting.creditControl.panelTitle")}</CardTitle>
          <CardDescription>{t("accounting.creditControl.panelDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => { setError(null); setShowUpsert(true) }}>
            {t("accounting.creditControl.upsertAction")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => { setError(null); setShowWriteOff(true) }}
          >
            {t("accounting.creditControl.writeOffAction")}
          </Button>
        </CardContent>
      </Card>

      <EntityView config={controlsTableConfig} data={controls} />

      {showUpsert ? (
        <FormModal
          open
          onOpenChange={(open) => !open && setShowUpsert(false)}
          config={upsertFormConfig}
          isPending={upsertPending}
          closeOnSubmit={false}
          submitError={error}
          onSubmit={async (data) => {
            setError(null)
            try {
              await onUpsertCreditControl(data)
              setShowUpsert(false)
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      ) : null}

      {showWriteOff ? (
        <FormModal
          open
          onOpenChange={(open) => !open && setShowWriteOff(false)}
          config={writeOffFormConfig}
          isPending={writeOffPending}
          closeOnSubmit={false}
          submitError={error}
          onSubmit={async (data) => {
            setError(null)
            try {
              await onCreateBadDebtWriteOff(data)
              setShowWriteOff(false)
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      ) : null}
    </div>
  )
}

"use client"

import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui"
import { Input } from "@lumiere/ui"
import { Label } from "@lumiere/ui"
import {
  useCreateCycleCountPlan,
  useStartCycleCountSession,
  useRecordCycleCountLine,
  useValidateCycleCount,
  usePostCycleCountAdjustments,
} from "@/hooks/inventory"
import type { QueryRows } from "@/lib/query-fetch"

type ScalarId = bigint | number | string

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function CycleCountWizard({
  organizationId,
  locations,
}: {
  organizationId: number
  locations: QueryRows
}) {
  const { t } = useTranslation()
  const orgId = BigInt(organizationId)
  const createPlan = useCreateCycleCountPlan(orgId)
  const startSession = useStartCycleCountSession(orgId)
  const recordLine = useRecordCycleCountLine(orgId)
  const validate = useValidateCycleCount(orgId)
  const postAdj = usePostCycleCountAdjustments(orgId)

  const [cycleCountId, setCycleCountId] = useState<ScalarId | "">("")
  const [locationId, setLocationId] = useState("")
  const [planName, setPlanName] = useState("")
  const [countBy, setCountBy] = useState("product")
  const [frequency, setFrequency] = useState("monthly")
  const [tolPct, setTolPct] = useState("0")
  const [tolVal, setTolVal] = useState("0")
  const [recProductId, setRecProductId] = useState("")
  const [recLocId, setRecLocId] = useState("")
  const [recQty, setRecQty] = useState("")
  const [recUom, setRecUom] = useState("")

  const locOpts = locations.map((l) => {
    const id = String(l.id ?? "")
    return (
      <option key={id} value={id}>
        {String(l.completeName ?? l.name ?? id)}
      </option>
    )
  })

  return (
    <div className="space-y-8 max-w-[720px] text-sm">
      <p className="text-muted-foreground">{t("inventory.cycleCountWizard.title")}</p>

      <section className="space-y-3 rounded-lg border border-border p-4">
        <h3 className="font-medium">{t("inventory.cycleCountWizard.stepPlan")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="cc-loc">{t("inventory.cycleCountWizard.locationId")}</Label>
            <select
              id="cc-loc"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">—</option>
              {locOpts}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cc-name">{t("inventory.cycleCountWizard.planName")}</Label>
            <Input
              id="cc-name"
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cc-by">{t("inventory.cycleCountWizard.countBy")}</Label>
            <Input id="cc-by" value={countBy} onChange={(e) => setCountBy(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cc-freq">{t("inventory.cycleCountWizard.frequency")}</Label>
            <Input id="cc-freq" value={frequency} onChange={(e) => setFrequency(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cc-tp">{t("inventory.cycleCountWizard.tolerancePct")}</Label>
            <Input id="cc-tp" value={tolPct} onChange={(e) => setTolPct(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cc-tv">{t("inventory.cycleCountWizard.toleranceVal")}</Label>
            <Input id="cc-tv" value={tolVal} onChange={(e) => setTolVal(e.target.value)} />
          </div>
        </div>
        <Button
          type="button"
          disabled={createPlan.isPending || !locationId}
          onClick={() => {
            const lid = Number(locationId)
            void createPlan.mutateAsync({
              locationId: lid,
              params: {
                name: planName.trim() ? planName.trim() : undefined,
                countBy,
                frequency,
                tolerancePercentage: num(tolPct),
                toleranceValue: num(tolVal),
                productIds: [],
                productCategoryIds: [],
                reason: undefined,
                notes: undefined,
                metadata: undefined,
              },
            })
          }}
        >
          {t("inventory.cycleCountWizard.createPlan")}
        </Button>
        <p className="text-xs text-muted-foreground">
          After creating, note the new row ID in Cycle counts, then enter it below.
        </p>
      </section>

      <section className="space-y-3 rounded-lg border border-border p-4">
        <h3 className="font-medium">{t("inventory.cycleCountWizard.stepStart")}</h3>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="space-y-1 flex-1 min-w-[140px]">
            <Label htmlFor="cc-id">{t("inventory.cycleCountWizard.cycleCountId")}</Label>
            <Input
              id="cc-id"
              value={cycleCountId === "" ? "" : String(cycleCountId)}
              onChange={(e) => setCycleCountId(e.target.value === "" ? "" : e.target.value)}
            />
          </div>
          <Button
            type="button"
            disabled={startSession.isPending || cycleCountId === ""}
            onClick={() => void startSession.mutateAsync(cycleCountId)}
          >
            {t("inventory.cycleCountWizard.startSession")}
          </Button>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-border p-4">
        <h3 className="font-medium">{t("inventory.cycleCountWizard.stepRecord")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>{t("inventory.cycleCountWizard.productId")}</Label>
            <Input value={recProductId} onChange={(e) => setRecProductId(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("inventory.cycleCountWizard.recordLocationId")}</Label>
            <Input value={recLocId} onChange={(e) => setRecLocId(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("inventory.cycleCountWizard.qtyCounted")}</Label>
            <Input value={recQty} onChange={(e) => setRecQty(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("inventory.cycleCountWizard.uomId")}</Label>
            <Input value={recUom} onChange={(e) => setRecUom(e.target.value)} />
          </div>
        </div>
        <Button
          type="button"
          disabled={recordLine.isPending || cycleCountId === ""}
          onClick={() =>
            void recordLine.mutateAsync({
              cycleCountId,
              params: {
                productId: num(recProductId),
                locationId: num(recLocId),
                lotId: undefined,
                qtyCounted: num(recQty),
                uomId: num(recUom),
                notes: undefined,
                metadata: undefined,
              },
            })
          }
        >
          {t("inventory.cycleCountWizard.recordLine")}
        </Button>
      </section>

      <section className="flex flex-wrap gap-2 rounded-lg border border-border p-4">
        <Button
          type="button"
          variant="secondary"
          disabled={validate.isPending || cycleCountId === ""}
          onClick={() => void validate.mutateAsync(cycleCountId)}
        >
          {t("inventory.cycleCountWizard.validate")}
        </Button>
        <Button
          type="button"
          disabled={postAdj.isPending || cycleCountId === ""}
          onClick={() => void postAdj.mutateAsync(cycleCountId)}
        >
          {t("inventory.cycleCountWizard.post")}
        </Button>
      </section>
    </div>
  )
}

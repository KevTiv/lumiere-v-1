"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Button, EntityView, cn } from "@lumiere/ui"
import { Input } from "@lumiere/ui"
import { Label } from "@lumiere/ui"
import { qualityAlertsTableConfig } from "@lumiere/ui"
import {
  useCreateCycleCountPlan,
  useStartCycleCountSession,
  useRecordCycleCountLine,
  useValidateCycleCount,
  usePostCycleCountAdjustments,
  useOpenQualityAlert,
  useQualityAlerts,
  useSolveQualityAlert,
  useCancelQualityAlert,
} from "@lumiere/query-hooks/hooks/inventory"
import type { QueryRows } from "@/lib/query-fetch"
import { ChevronRight, MapPin, Package } from "lucide-react"

type ScalarId = bigint | number | string

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function strId(v: unknown): string {
  return v == null ? "" : String(v)
}

type WizardStep = 1 | 2 | 3 | 4 | 5

const WIZARD_STEPS: WizardStep[] = [1, 2, 3, 4, 5]

export function CycleCountWizard({
  organizationId,
  locations,
  cycleCounts,
  products,
  uoms,
  initialCycleCountId,
}: {
  organizationId: number
  locations: QueryRows
  cycleCounts: QueryRows
  products: QueryRows
  uoms: QueryRows
  initialCycleCountId?: ScalarId | ""
}) {
  const { t } = useTranslation()
  const orgId = BigInt(organizationId)
  const createPlan = useCreateCycleCountPlan(orgId)
  const startSession = useStartCycleCountSession(orgId)
  const recordLine = useRecordCycleCountLine(orgId)
  const validate = useValidateCycleCount(orgId)
  const postAdj = usePostCycleCountAdjustments(orgId)

  const [step, setStep] = useState<WizardStep>(1)
  const [cycleCountId, setCycleCountId] = useState<ScalarId | "">(initialCycleCountId ?? "")
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
  const [planCreatedAt, setPlanCreatedAt] = useState(0)

  useEffect(() => {
    if (initialCycleCountId != null && initialCycleCountId !== "") {
      setCycleCountId(initialCycleCountId)
      setStep(2)
    }
  }, [initialCycleCountId])

  useEffect(() => {
    if (planCreatedAt === 0 || cycleCounts.length === 0) return
    const forLoc = locationId
      ? cycleCounts.filter((c) => strId(c.locationId) === locationId)
      : cycleCounts
    const sorted = [...forLoc].sort((a, b) => num(b.id) - num(a.id))
    const newest = sorted[0]
    if (newest?.id != null) {
      setCycleCountId(newest.id as ScalarId)
      setStep(2)
    }
  }, [cycleCounts, locationId, planCreatedAt])

  const selectedCount = useMemo(
    () => cycleCounts.find((c) => strId(c.id) === strId(cycleCountId)),
    [cycleCounts, cycleCountId],
  )

  const locOpts = locations.map((l) => {
    const id = strId(l.id)
    return (
      <option key={id} value={id}>
        {String(l.completeName ?? l.name ?? id)}
      </option>
    )
  })

  const countOpts = cycleCounts.map((c) => {
    const id = strId(c.id)
    return (
      <option key={id} value={id}>
        {`${id} — ${String(c.name ?? "Count")} (${String(c.state ?? "—")})`}
      </option>
    )
  })

  const productOpts = products.map((p) => {
    const id = strId(p.id)
    return (
      <option key={id} value={id}>
        {String(p.name ?? p.defaultCode ?? id)}
      </option>
    )
  })

  const uomOpts = uoms.map((u) => {
    const id = strId(u.id)
    return (
      <option key={id} value={id}>
        {String(u.name ?? id)}
      </option>
    )
  })

  const stepLabels: Record<WizardStep, string> = {
    1: t("inventory.cycleCountWizard.stepPlan"),
    2: t("inventory.cycleCountWizard.stepStart"),
    3: t("inventory.cycleCountWizard.stepRecord"),
    4: t("inventory.cycleCountWizard.stepValidate"),
    5: t("inventory.cycleCountWizard.stepPost"),
  }

  const canAdvance =
    (step === 1 && Boolean(locationId)) ||
    (step === 2 && cycleCountId !== "") ||
    (step === 3 && recProductId && recLocId && recQty && recUom) ||
    step === 4 ||
    step === 5

  const goNext = useCallback(() => {
    setStep((s) => (s < 5 ? ((s + 1) as WizardStep) : s))
  }, [])

  const goBack = useCallback(() => {
    setStep((s) => (s > 1 ? ((s - 1) as WizardStep) : s))
  }, [])

  return (
    <div className="space-y-6 max-w-[800px] text-sm">
      <div>
        <h2 className="text-lg font-semibold">{t("inventory.cycleCountWizard.title")}</h2>
        <p className="text-muted-foreground">{t("inventory.cycleCountWizard.subtitle")}</p>
      </div>

      <ol className="flex flex-wrap gap-2">
        {WIZARD_STEPS.map((s) => (
          <li key={s}>
            <button
              type="button"
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                step === s
                  ? "border-primary bg-primary text-primary-foreground"
                  : step > s
                    ? "border-primary/40 text-primary"
                    : "border-border text-muted-foreground",
              )}
              onClick={() => setStep(s)}
            >
              {stepLabels[s]}
            </button>
          </li>
        ))}
      </ol>

      {selectedCount ? (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
          {t("inventory.cycleCountWizard.activeCount", {
            id: strId(selectedCount.id),
            state: String(selectedCount.state ?? "—"),
          })}
        </div>
      ) : null}

      {step === 1 ? (
        <section className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="font-medium">{stepLabels[1]}</h3>
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
                placeholder={t("inventory.cycleCountWizard.planNamePlaceholder")}
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
              void createPlan
                .mutateAsync({
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
                .then(() => setPlanCreatedAt(Date.now()))
            }}
          >
            {t("inventory.cycleCountWizard.createPlan")}
          </Button>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="font-medium">{stepLabels[2]}</h3>
          <div className="space-y-1">
            <Label htmlFor="cc-id">{t("inventory.cycleCountWizard.cycleCountId")}</Label>
            <select
              id="cc-id"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3"
              value={cycleCountId === "" ? "" : strId(cycleCountId)}
              onChange={(e) => setCycleCountId(e.target.value === "" ? "" : e.target.value)}
            >
              <option value="">—</option>
              {countOpts}
            </select>
          </div>
          <Button
            type="button"
            disabled={startSession.isPending || cycleCountId === ""}
            onClick={() => void startSession.mutateAsync(cycleCountId).then(goNext)}
          >
            {t("inventory.cycleCountWizard.startSession")}
          </Button>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="font-medium">{stepLabels[3]}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="cc-prod">{t("inventory.cycleCountWizard.productId")}</Label>
              <select
                id="cc-prod"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3"
                value={recProductId}
                onChange={(e) => setRecProductId(e.target.value)}
              >
                <option value="">—</option>
                {productOpts}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cc-rec-loc">{t("inventory.cycleCountWizard.recordLocationId")}</Label>
              <select
                id="cc-rec-loc"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3"
                value={recLocId}
                onChange={(e) => setRecLocId(e.target.value)}
              >
                <option value="">—</option>
                {locOpts}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cc-qty">{t("inventory.cycleCountWizard.qtyCounted")}</Label>
              <Input id="cc-qty" value={recQty} onChange={(e) => setRecQty(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cc-uom">{t("inventory.cycleCountWizard.uomId")}</Label>
              <select
                id="cc-uom"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3"
                value={recUom}
                onChange={(e) => setRecUom(e.target.value)}
              >
                <option value="">—</option>
                {uomOpts}
              </select>
            </div>
          </div>
          <Button
            type="button"
            disabled={recordLine.isPending || cycleCountId === ""}
            onClick={() =>
              void recordLine
                .mutateAsync({
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
                .then(goNext)
            }
          >
            {t("inventory.cycleCountWizard.recordLine")}
          </Button>
        </section>
      ) : null}

      {step === 4 ? (
        <section className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="font-medium">{stepLabels[4]}</h3>
          <p className="text-muted-foreground text-xs">{t("inventory.cycleCountWizard.validateHint")}</p>
          <Button
            type="button"
            variant="secondary"
            disabled={validate.isPending || cycleCountId === ""}
            onClick={() => void validate.mutateAsync(cycleCountId).then(goNext)}
          >
            {t("inventory.cycleCountWizard.validate")}
          </Button>
        </section>
      ) : null}

      {step === 5 ? (
        <section className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="font-medium">{stepLabels[5]}</h3>
          <p className="text-muted-foreground text-xs">{t("inventory.cycleCountWizard.postHint")}</p>
          <Button
            type="button"
            disabled={postAdj.isPending || cycleCountId === ""}
            onClick={() => void postAdj.mutateAsync(cycleCountId)}
          >
            {t("inventory.cycleCountWizard.post")}
          </Button>
        </section>
      ) : null}

      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={step === 1} onClick={goBack}>
          {t("common.back")}
        </Button>
        {step < 5 && step !== 2 && step !== 3 && step !== 4 ? (
          <Button type="button" disabled={!canAdvance} onClick={goNext}>
            {t("common.next")}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

type LocationTreeNode = {
  id: string
  row: Record<string, unknown>
  children: LocationTreeNode[]
  quantCount: number
}

function buildLocationTree(locations: QueryRows, quants: QueryRows): LocationTreeNode[] {
  const byParent = new Map<string, LocationTreeNode[]>()
  const nodes = new Map<string, LocationTreeNode>()

  for (const loc of locations) {
    const id = strId(loc.id)
    if (!id) continue
    const quantCount = quants.filter((q) => strId(q.locationId) === id).length
    nodes.set(id, { id, row: loc as Record<string, unknown>, children: [], quantCount })
  }

  for (const node of nodes.values()) {
    const parentRaw = node.row.locationId ?? node.row.location_id
    const parentId = parentRaw == null || parentRaw === 0 || parentRaw === "0" ? "" : strId(parentRaw)
    const bucket = byParent.get(parentId) ?? []
    bucket.push(node)
    byParent.set(parentId, bucket)
  }

  const attach = (node: LocationTreeNode) => {
    node.children = (byParent.get(node.id) ?? []).sort((a, b) =>
      String(a.row.completeName ?? a.row.name ?? "").localeCompare(
        String(b.row.completeName ?? b.row.name ?? ""),
      ),
    )
    node.children.forEach(attach)
  }

  const roots = (byParent.get("") ?? []).sort((a, b) =>
    String(a.row.completeName ?? a.row.name ?? "").localeCompare(
      String(b.row.completeName ?? b.row.name ?? ""),
    ),
  )
  roots.forEach(attach)
  return roots
}

function LocationTreeRow({
  node,
  depth,
  onViewQuants,
  t,
}: {
  node: LocationTreeNode
  depth: number
  onViewQuants: (locationId: string) => void
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const [open, setOpen] = useState(depth < 2)
  const label = String(node.row.completeName ?? node.row.name ?? node.id)
  const usage = String(node.row.usage ?? "")

  return (
    <li>
      <div
        className="flex items-center gap-2 rounded-md py-1.5 pr-2 hover:bg-muted/50"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {node.children.length > 0 ? (
          <button
            type="button"
            className="text-muted-foreground"
            aria-label={open ? "Collapse" : "Expand"}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="w-4" />
        )}
        <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="flex-1 truncate font-medium">{label}</span>
        {usage ? (
          <span className="text-xs text-muted-foreground capitalize">{usage}</span>
        ) : null}
        <span className="text-xs text-muted-foreground tabular-nums">
          {t("inventory.locationTree.quantCount", { count: node.quantCount })}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={() => onViewQuants(node.id)}>
          {t("inventory.locationTree.viewQuants")}
        </Button>
      </div>
      {open && node.children.length > 0 ? (
        <ul>
          {node.children.map((child) => (
            <LocationTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              onViewQuants={onViewQuants}
              t={t}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function LocationHierarchyPanel({
  locations,
  quants,
  onViewQuants,
}: {
  locations: QueryRows
  quants: QueryRows
  onViewQuants: (locationId: string) => void
}) {
  const { t } = useTranslation()
  const tree = useMemo(() => buildLocationTree(locations, quants), [locations, quants])

  return (
    <div className="space-y-4 p-1">
      <div>
        <h2 className="text-lg font-semibold">{t("inventory.locationTree.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("inventory.locationTree.description")}</p>
      </div>
      {tree.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("inventory.stockLocations.emptyMessage")}</p>
      ) : (
        <ul className="rounded-lg border border-border p-2">
          {tree.map((node) => (
            <LocationTreeRow
              key={node.id}
              node={node}
              depth={0}
              onViewQuants={onViewQuants}
              t={t}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

export function QualityAlertsPanel({
  organizationId,
  operatingCompanyId,
  onAssignAlert,
  onSolveAlert,
}: {
  organizationId: number
  operatingCompanyId: bigint
  onAssignAlert: (alertId: ScalarId) => void
  onSolveAlert: (alertId: ScalarId) => void
}) {
  const { t } = useTranslation()
  const orgId = BigInt(organizationId)
  const openAlert = useOpenQualityAlert(orgId)
  const solveAlert = useSolveQualityAlert(orgId)
  const cancelAlert = useCancelQualityAlert(orgId, operatingCompanyId)

  const { data: alerts = [], isLoading } = useQualityAlerts(orgId)

  const tableConfig = useMemo(() => {
    const base = qualityAlertsTableConfig(t)
    if (base.view.mode !== "table") return base
    return {
      ...base,
      view: {
        ...base.view,
        actions: [
          {
            id: "open-alert",
            label: t("inventory.qualityAlerts.actions.open"),
            requiresSelection: true,
            onClick: (rows: Record<string, unknown>[]) => {
              const id = rows[0]?.id as ScalarId | undefined
              if (id != null) void openAlert.mutateAsync(id)
            },
          },
          {
            id: "assign-alert",
            label: t("inventory.qualityAlerts.actions.assign"),
            requiresSelection: true,
            onClick: (rows: Record<string, unknown>[]) => {
              const id = rows[0]?.id as ScalarId | undefined
              if (id != null) onAssignAlert(id)
            },
          },
          {
            id: "solve-alert",
            label: t("inventory.qualityAlerts.actions.solve"),
            requiresSelection: true,
            onClick: (rows: Record<string, unknown>[]) => {
              const id = rows[0]?.id as ScalarId | undefined
              if (id != null) onSolveAlert(id)
            },
          },
          {
            id: "cancel-alert",
            label: t("inventory.qualityAlerts.actions.cancel"),
            variant: "destructive" as const,
            requiresSelection: true,
            onClick: (rows: Record<string, unknown>[]) => {
              const id = rows[0]?.id as ScalarId | undefined
              if (id != null) void cancelAlert.mutateAsync({ alertId: id })
            },
          },
        ],
      },
    }
  }, [t, openAlert, cancelAlert, onAssignAlert, onSolveAlert])

  return (
    <div className="space-y-4 p-1 min-h-[320px]">
      <div className="flex items-start gap-3">
        <Package className="h-5 w-5 text-muted-foreground mt-0.5" />
        <div>
          <h2 className="text-lg font-semibold">{t("inventory.qualityAlerts.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("inventory.qualityAlerts.description")}</p>
        </div>
      </div>
      {alerts.length === 0 && !isLoading ? (
        <p className="text-sm text-muted-foreground rounded-md border border-dashed p-4">
          {t("inventory.qualityAlerts.emptyHint")}
        </p>
      ) : null}
      <EntityView
        config={tableConfig}
        data={alerts as Record<string, unknown>[]}
      />
    </div>
  )
}

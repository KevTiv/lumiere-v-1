"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  newManufacturingOrderForm,
  newBomForm,
  newWorkcenterForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
} from "@lumiere/ui"
import type { FormConfig, ModuleConfig } from "@lumiere/ui"
import { manufacturingModuleConfig } from "@/lib/module-dashboard-configs"
import {
  useMrpProductions,
  useMrpBoms,
  useMrpWorkorders,
  useMrpWorkcenters,
  useQualityChecks,
  useCreateManufacturingOrder,
  useCreateBom,
  useCreateWorkcenter,
} from "@/hooks/manufacturing"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import {
  useProducts,
  useStockQuants,
  useStockPickings,
  useWarehouses,
} from "@/hooks/inventory"
import {
  productRowsToSelectOptions,
  warehouseRowsToSelectOptions,
  pickingTypeOptionsFromTransfers,
  locationOptionsFromQuantsAndTransfers,
  mrpBomRowsToSelectOptions,
} from "@/lib/form-lookup"

interface ManufacturingClientProps {
  initialProductions?: Record<string, unknown>[]
  initialBoms?: Record<string, unknown>[]
  initialWorkorders?: Record<string, unknown>[]
  initialWorkcenters?: Record<string, unknown>[]
  initialProducts?: Record<string, unknown>[]
  initialWarehouses?: Record<string, unknown>[]
  initialStockPickings?: Record<string, unknown>[]
  initialStockQuants?: Record<string, unknown>[]
  organizationId?: number
}

type ManufacturingClientLoadedProps = Omit<ManufacturingClientProps, "organizationId"> & {
  organizationId: number
}

export function ManufacturingClient(props: ManufacturingClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <ManufacturingClientLoaded {...props} organizationId={props.organizationId} />
}

function ManufacturingClientLoaded({
  initialProductions,
  initialBoms,
  initialWorkorders,
  initialWorkcenters,
  initialProducts,
  initialWarehouses,
  initialStockPickings,
  initialStockQuants,
  organizationId,
}: ManufacturingClientLoadedProps) {
  const { t } = useTranslation()
  const { orgId, companyId } = orgBigInts(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)

  const { data: productions = [] } = useMrpProductions(companyId, initialProductions)
  const { data: boms = [] } = useMrpBoms(companyId, initialBoms)
  const { data: workorders = [] } = useMrpWorkorders(companyId, initialWorkorders)
  const { data: workcenters = [] } = useMrpWorkcenters(companyId, initialWorkcenters)
  const { data: qualityChecks = [] } = useQualityChecks(companyId)
  const { data: products = [] } = useProducts(orgId, initialProducts)
  const { data: warehouses = [] } = useWarehouses(companyId, initialWarehouses)
  const { data: transfers = [] } = useStockPickings(companyId, initialStockPickings)
  const { data: stockQuants = [] } = useStockQuants(companyId, initialStockQuants)

  const createManufacturingOrder = useCreateManufacturingOrder(orgId, companyId)
  const createBom = useCreateBom(orgId, companyId)
  const createWorkcenter = useCreateWorkcenter(orgId, companyId)

  const moduleConfig = useMemo(() => manufacturingModuleConfig(t), [t])

  const productFieldOptions = useMemo(() => {
    const fromApi = productRowsToSelectOptions(products)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noProducts"), disabled: true }]
  }, [products, t])

  const bomFieldOptions = useMemo(() => {
    const fromApi = mrpBomRowsToSelectOptions(boms)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noBoms"), disabled: true }]
  }, [boms, t])

  const warehouseFieldOptions = useMemo(() => {
    const fromApi = warehouseRowsToSelectOptions(warehouses)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noWarehouses"), disabled: true }]
  }, [warehouses, t])

  const pickingAndLocations = useMemo(() => {
    const picking = pickingTypeOptionsFromTransfers(transfers)
    const locs = locationOptionsFromQuantsAndTransfers(stockQuants, transfers)
    const emptyPicking =
      picking.length > 0
        ? picking
        : [{ value: "", label: t("common.lookup.noStockMoves"), disabled: true }]
    const emptyLocs =
      locs.length > 0 ? locs : [{ value: "", label: t("common.lookup.noStockMoves"), disabled: true }]
    return { picking: emptyPicking, locs: emptyLocs }
  }, [transfers, stockQuants, t])

  const moFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newManufacturingOrderForm(t), {
        productId: productFieldOptions,
        bomId: bomFieldOptions,
        warehouseId: warehouseFieldOptions,
        pickingTypeId: pickingAndLocations.picking,
        locationSrcId: pickingAndLocations.locs,
        locationDestId: pickingAndLocations.locs,
      }),
    [t, productFieldOptions, bomFieldOptions, warehouseFieldOptions, pickingAndLocations],
  )

  const bomFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newBomForm(t), {
        productTmplId: productFieldOptions,
      }),
    [t, productFieldOptions],
  )

  const workcenterFormConfig = useMemo(() => newWorkcenterForm(t), [t])

  const liveSections = useMemo(() => {
    const activeOrders = productions.filter(
      (p) => String(p.state) === "Confirmed" || String(p.state) === "Progress"
    )
    const doneOrders = productions.filter((p) => String(p.state) === "Done")
    const totalOrders = productions.length
    const onTimeRate =
      totalOrders > 0 ? Math.round((doneOrders.length / totalOrders) * 100) : 0

    const avgOee =
      workcenters.length > 0
        ? Math.round(
          workcenters.reduce((s, wc) => s + Number(wc.oee ?? 0), 0) / workcenters.length
        )
        : 0

    const readyWorkorders = workorders.filter((wo) => String(wo.state) === "Ready").length

    return (
      moduleConfig.tabs
        .find((tab) => tab.id === "dashboard")
        ?.sections?.map((section) => ({
          ...section,
          widgets: section.widgets.map((w) => {
            if (w.type === "stat-cards") {
              return {
                ...w,
                data: {
                  stats: [
                    { label: t("manufacturing.dashboard.activeOrders"), value: activeOrders.length.toString(), icon: "Factory" },
                    { label: t("manufacturing.dashboard.onTimeRate"), value: `${onTimeRate}%`, icon: "CheckCircle" },
                    { label: t("manufacturing.dashboard.oeeEfficiency"), value: `${avgOee}%`, icon: "Settings" },
                    { label: t("manufacturing.dashboard.readyWorkOrders"), value: readyWorkorders.toString(), icon: "Wrench" },
                  ],
                },
              }
            }
            if (w.type === "quick-actions") {
              const handlers: Record<string, () => void> = {
                create_mo: () => setQuickActionForm({ form: moFormConfig, action: "createManufacturingOrder" }),
                create_bom: () => setQuickActionForm({ form: bomFormConfig, action: "createBom" }),
                create_workcenter: () => setQuickActionForm({ form: workcenterFormConfig, action: "createWorkcenter" }),
              }
              return {
                ...w,
                data: {
                  ...w.data,
                  actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] })),
                },
              }
            }
            if (w.id === "mfg-work-centers") {
              const colors = ["#22c55e", "#6366f1", "#22c55e", "#f59e0b", "#f59e0b"]
              const metrics = workcenters.slice(0, 5).map((wc, i) => ({
                label: String(wc.name ?? t("manufacturing.dashboard.workCenterFallback", { number: i + 1 })),
                value: Math.round(Number(wc.oee ?? 0)),
                max: 100,
                color: colors[i] ?? "#6366f1",
              }))
              return { ...w, data: { metrics } }
            }
            if (w.id === "mfg-orders-table") {
              const activeOrdersRows = productions
                .filter((p) => {
                  const s = String(p.state ?? "")
                  return s === "Confirmed" || s === "Progress" || s === "InProgress"
                })
                .slice(0, 4)
                .map((p) => {
                  const progress =
                    Number(p.qtyProducing ?? 0) > 0 && Number(p.qtyProduced ?? 0) >= 0
                      ? `${Math.round((Number(p.qtyProduced) / Math.max(1, Number(p.qtyProducing ?? 1))) * 100)}%`
                      : "0%"
                  const dueDateMs = Number(p.datePlannedFinished ?? 0) / 1000
                  const dueStr =
                    dueDateMs > 0
                      ? new Date(dueDateMs).toLocaleDateString("en", { month: "short", day: "numeric" })
                      : "—"
                  return {
                    ref: `MO-${String(p.id).slice(-6)}`,
                    product: t("manufacturing.dashboard.productFallback", { id: String(p.productId ?? "?").slice(-4) }),
                    qty: Math.round(Number(p.qtyProducing ?? 0)),
                    progress,
                    due: dueStr,
                    status: String(p.state ?? "Draft"),
                  }
                })
              return { ...w, data: { ...(w.data as Record<string, unknown>), rows: activeOrdersRows } }
            }
            return w
          }),
        })) ??
      moduleConfig.tabs.find((tab) => tab.id === "dashboard")?.sections ??
      []
    )
  }, [productions, workorders, workcenters, t, moduleConfig, moFormConfig, bomFormConfig, workcenterFormConfig])

  const config = useMemo(
    () =>
      ({
        ...moduleConfig,
        tabs: moduleConfig.tabs.map((tab) => {
          if (tab.id === "dashboard") return { ...tab, sections: liveSections }
          if (tab.id === "orders") return { ...tab, createForm: moFormConfig }
          if (tab.id === "boms") return { ...tab, createForm: bomFormConfig }
          if (tab.id === "workcenters") return { ...tab, createForm: workcenterFormConfig }
          return tab
        }),
      }) as ModuleConfig,
    [moduleConfig, liveSections, moFormConfig, bomFormConfig, workcenterFormConfig]
  )

  const data = useMemo(
    () => ({
      orders: productions as unknown as Record<string, unknown>[],
      boms: boms as unknown as Record<string, unknown>[],
      workorders: workorders as unknown as Record<string, unknown>[],
      workcenters: workcenters as unknown as Record<string, unknown>[],
      quality: qualityChecks as unknown as Record<string, unknown>[],
    }),
    [productions, boms, workorders, workcenters, qualityChecks]
  )

  const handleFormSubmit = (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>
  ) => {
    if (action === "createManufacturingOrder") {
      const prodRaw = formData.productId
      const whRaw = formData.warehouseId
      const pickRaw = formData.pickingTypeId
      const srcRaw = formData.locationSrcId
      const destRaw = formData.locationDestId
      if (
        prodRaw === "" ||
        prodRaw == null ||
        whRaw === "" ||
        whRaw == null ||
        pickRaw === "" ||
        pickRaw == null ||
        srcRaw === "" ||
        srcRaw == null ||
        destRaw === "" ||
        destRaw == null
      ) {
        return
      }
      const productRow = products.find((p) => String(p.id) === String(prodRaw))
      const uomFromProduct =
        productRow?.uomId != null
          ? Number(productRow.uomId)
          : productRow?.uomPoId != null
            ? Number(productRow.uomPoId)
            : undefined
      if (uomFromProduct == null || Number.isNaN(uomFromProduct)) return
      createManufacturingOrder.mutate({
        productId: Number(prodRaw),
        productQty: Number(formData.productQty ?? 1),
        productUomId: uomFromProduct,
        datePlannedStart: new Date(String(formData.datePlannedStart ?? new Date().toISOString())),
        datePlannedFinished: new Date(
          String(formData.datePlannedFinished ?? formData.datePlannedStart ?? new Date().toISOString())
        ),
        locationSrcId: Number(srcRaw),
        locationDestId: Number(destRaw),
        warehouseId: Number(whRaw),
        pickingTypeId: Number(pickRaw),
        consumption: formData.consumption ? String(formData.consumption) : undefined,
        state: "Draft",
        availability: "available",
        reservationState: "confirmed",
        componentsAvailability: "available",
        componentsAvailabilityState: "available",
        isPlanned: true,
        isLocked: false,
        isWorkorder: true,
        delayAlert: false,
        lotProducingCount: 0,
        qtyProducing: 0,
        qtyProduced: 0,
        productUomQtyProducing: 0,
        bomId:
          formData.bomId != null && String(formData.bomId) !== ""
            ? Number(formData.bomId)
            : undefined,
        routingId: formData.routingId != null ? Number(formData.routingId) : undefined,
        procGroupId: undefined,
        procurementGroupId: undefined,
        dateDeadline: formData.datePlannedFinished
          ? new Date(String(formData.datePlannedFinished))
          : undefined,
        origin: formData.origin ? String(formData.origin) : undefined,
        responsibleUserId: undefined,
        metadata: undefined,
      } as never)
    } else if (action === "createBom") {
      const tmplRaw = formData.productTmplId
      if (tmplRaw === "" || tmplRaw == null) return
      const productRow = products.find((p) => String(p.id) === String(tmplRaw))
      const uomFromProduct =
        productRow?.uomId != null
          ? Number(productRow.uomId)
          : productRow?.uomPoId != null
            ? Number(productRow.uomPoId)
            : undefined
      if (uomFromProduct == null || Number.isNaN(uomFromProduct)) return
      const pid = Number(tmplRaw)
      createBom.mutate({
        type: String(formData.type ?? "Normal"),
        productId: pid,
        productTmplId: pid,
        productQty: Number(formData.productQty ?? 1),
        productUomId: uomFromProduct,
        readyToProduce: "asap",
        consumption: "flexible",
        sequence: 1,
        estimatedCost: Number(formData.estimatedCost ?? 0),
        lines: [],
        pickingTypeId: formData.pickingTypeId != null ? Number(formData.pickingTypeId) : undefined,
        locationSrcId: formData.locationSrcId != null ? Number(formData.locationSrcId) : undefined,
        locationDestId: formData.locationDestId != null ? Number(formData.locationDestId) : undefined,
        warehouseId: formData.warehouseId != null ? Number(formData.warehouseId) : undefined,
        routingId: formData.routingId != null ? Number(formData.routingId) : undefined,
        metadata: undefined,
      } as never)
    } else if (action === "createWorkcenter") {
      const oeeTarget = Number(formData.oeeTarget ?? 85)
      const timeEfficiency = Number(formData.timeEfficiency ?? 100)
      const capacity = Number(formData.capacity ?? 1)

      createWorkcenter.mutate({
        name: String(formData.name ?? ""),
        active: formData.active == null ? true : Boolean(formData.active),
        code: formData.code ? String(formData.code) : undefined,
        workingState: "normal",
        oeeTarget,
        timeEfficiency,
        capacity,
        capacityIds: [],
        oee: 0,
        performance: 0,
        blockedTime: 0,
        productiveTime: 0,
        productivityIds: [],
        orderIds: [],
        workorderCount: 0,
        workorderReadyCount: 0,
        workorderProgressCount: 0,
        workorderPendingCount: 0,
        workorderLateCount: 0,
        alternativeWorkcenterIds: [],
        color: undefined,
        resourceCalendarId: undefined,
        tagIds: [],
        defaultCapacityParentId: undefined,
        defaultTimeEfficiency: timeEfficiency,
        defaultOeeTarget: oeeTarget,
        sequence: 1,
        metadata: undefined,
      } as never)
    }
  }

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
      />
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? moFormConfig}
        onSubmit={(formData) => {
          if (quickActionForm) {
            handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
    </>
  )
}

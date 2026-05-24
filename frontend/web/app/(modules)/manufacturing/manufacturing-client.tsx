"use client"

import { useEffect, useMemo, useState } from "react"
import { useModuleTab } from "@/hooks/use-module-tab"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  newManufacturingOrderForm,
  newBomForm,
  newWorkcenterForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
  manufacturingCsvImportForm,
} from "@lumiere/ui"
import type { ManufacturingCsvImportKind } from "@lumiere/ui"
import type { EntityViewConfig, FormConfig, ModuleConfig } from "@lumiere/ui"
import { manufacturingModuleConfig } from "@/lib/module-dashboard-configs"
import {
  useMrpProductions,
  useMrpBoms,
  useMrpBomLines,
  useMrpWorkorders,
  useMrpWorkcenters,
  useMrpRoutingWorkcenters,
  useQualityChecks,
  useManufacturingMutations,
} from "@lumiere/query-hooks/hooks/manufacturing"
import { ManufacturingRowDialog } from "./manufacturing-row-dialog"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import {
  useProducts,
  useStockQuants,
  useStockPickings,
  useWarehouses,
} from "@lumiere/query-hooks/hooks/inventory"
import { useIotDevices } from "@lumiere/query-hooks/hooks/iot"
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
  initialBomLines?: Record<string, unknown>[]
  initialWorkorders?: Record<string, unknown>[]
  initialWorkcenters?: Record<string, unknown>[]
  initialRoutingOperations?: Record<string, unknown>[]
  initialIotDevices?: Record<string, unknown>[]
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
  initialBomLines,
  initialWorkorders,
  initialWorkcenters,
  initialRoutingOperations,
  initialIotDevices,
  initialProducts,
  initialWarehouses,
  initialStockPickings,
  initialStockQuants,
  organizationId,
}: ManufacturingClientLoadedProps) {
  const { t } = useTranslation()
  const { orgId, companyId } = orgBigInts(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const [rowPick, setRowPick] = useState<{ tabId: string; row: Record<string, unknown> } | null>(null)
  const [csvKind, setCsvKind] = useState<ManufacturingCsvImportKind | null>(null)
  const [csvError, setCsvError] = useState<string | null>(null)
  // activeTab is now URL-synced via useModuleTab below (after moduleConfig is defined)

  const { data: productions = [] } = useMrpProductions(orgId, initialProductions)
  const { data: boms = [] } = useMrpBoms(orgId, initialBoms)
  const { data: bomLines = [] } = useMrpBomLines(orgId, initialBomLines)
  const { data: workorders = [] } = useMrpWorkorders(orgId, initialWorkorders)
  const { data: workcenters = [] } = useMrpWorkcenters(orgId, initialWorkcenters)
  const { data: routingOperations = [] } = useMrpRoutingWorkcenters(orgId, initialRoutingOperations)
  const { data: iotDevices = [] } = useIotDevices(orgId, initialIotDevices)
  const { data: qualityChecks = [] } = useQualityChecks(orgId)
  const { data: products = [] } = useProducts(orgId, initialProducts)
  const { data: warehouses = [] } = useWarehouses(orgId, initialWarehouses)
  const { data: transfers = [] } = useStockPickings(orgId, initialStockPickings)
  const { data: stockQuants = [] } = useStockQuants(orgId, initialStockQuants)

  const m = useManufacturingMutations(orgId, companyId)

  const moduleConfig = useMemo(() => manufacturingModuleConfig(t), [t])
  const { activeTab, setActiveTab } = useModuleTab(
    moduleConfig.defaultTab ?? "dashboard",
    moduleConfig.tabs.map((tab) => tab.id),
  )

  const csvFormConfig = useMemo(() => {
    if (!csvKind) return null
    return manufacturingCsvImportForm(t, csvKind)
  }, [csvKind, t])

  useEffect(() => {
    if (csvKind) setCsvError(null)
  }, [csvKind])

  const addCsvToolbar = (
    ec: EntityViewConfig,
    actions: Array<{ id: string; label: string; onClick: () => void }>,
  ): EntityViewConfig => {
    if (ec.view.mode !== "table") return ec
    return {
      ...ec,
      view: {
        ...ec.view,
        rowSelectionToggleOnClick: false,
        actions,
      },
    }
  }

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
                schedule_production: () => setActiveTab("orders"),
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
  }, [
    productions,
    workorders,
    workcenters,
    t,
    moduleConfig,
    moFormConfig,
    bomFormConfig,
    workcenterFormConfig,
  ])

  const config = useMemo(
    () =>
      ({
        ...moduleConfig,
        tabs: moduleConfig.tabs.map((tab) => {
          if (tab.id === "dashboard") return { ...tab, sections: liveSections }
          if (tab.id === "orders" && tab.entityConfig) {
            return {
              ...tab,
              createForm: moFormConfig,
              entityConfig: addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-mo",
                  label: t("manufacturing.toolbar.importMoCsv"),
                  onClick: () => setCsvKind("mo"),
                },
              ]),
            }
          }
          if (tab.id === "boms" && tab.entityConfig) {
            return {
              ...tab,
              createForm: bomFormConfig,
              entityConfig: addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-bom",
                  label: t("manufacturing.toolbar.importBomCsv"),
                  onClick: () => setCsvKind("bom"),
                },
                {
                  id: "csv-bom-line",
                  label: t("manufacturing.toolbar.importBomLineCsv"),
                  onClick: () => setCsvKind("bom_line"),
                },
              ]),
            }
          }
          if (tab.id === "workcenters" && tab.entityConfig) {
            return {
              ...tab,
              createForm: workcenterFormConfig,
              entityConfig: addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-wc",
                  label: t("manufacturing.toolbar.importWorkcenterCsv"),
                  onClick: () => setCsvKind("workcenter"),
                },
              ]),
            }
          }
          return tab
        }),
      }) as ModuleConfig,
    [moduleConfig, liveSections, moFormConfig, bomFormConfig, workcenterFormConfig, t],
  )

  const data = useMemo(
    () => ({
      orders: productions as unknown as Record<string, unknown>[],
      boms: boms as unknown as Record<string, unknown>[],
      "bom-lines": bomLines as unknown as Record<string, unknown>[],
      workorders: workorders as unknown as Record<string, unknown>[],
      workcenters: workcenters as unknown as Record<string, unknown>[],
      "routing-operations": routingOperations as unknown as Record<string, unknown>[],
      quality: qualityChecks as unknown as Record<string, unknown>[],
    }),
    [productions, boms, bomLines, workorders, workcenters, routingOperations, qualityChecks]
  )

  const handleFormSubmit = async (
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
      await m.createManufacturingOrder.mutateAsync({
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
        bomId:
          formData.bomId != null && String(formData.bomId) !== ""
            ? Number(formData.bomId)
            : undefined,
        routingId: formData.routingId != null ? Number(formData.routingId) : undefined,
        dateDeadline: formData.datePlannedFinished
          ? new Date(String(formData.datePlannedFinished))
          : undefined,
        origin: formData.origin ? String(formData.origin) : undefined,
      })
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
      await m.createBom.mutateAsync({
        type: String(formData.type ?? "Normal"),
        productId: pid,
        productTmplId: pid,
        productQty: Number(formData.productQty ?? 1),
        productUomId: uomFromProduct,
        routingId: formData.routingId != null ? Number(formData.routingId) : undefined,
      })
    } else if (action === "createWorkcenter") {
      const oeeTarget = Number(formData.oeeTarget ?? 85)
      const timeEfficiency = Number(formData.timeEfficiency ?? 100)
      const capacity = Number(formData.capacity ?? 1)

      await m.createWorkcenter.mutateAsync({
        name: String(formData.name ?? ""),
        code: formData.code ? String(formData.code) : undefined,
        oeeTarget,
        timeEfficiency,
        capacity,
        defaultTimeEfficiency: timeEfficiency,
        defaultOeeTarget: oeeTarget,
      })
    }
  }

  const isFormMutationPending = Object.values(m).some(
    (mutation) =>
      mutation != null &&
      typeof mutation === "object" &&
      "isPending" in mutation &&
      Boolean((mutation as { isPending: boolean }).isPending),
  )

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
        isPending={isFormMutationPending}
        onRowClick={(tabId, row) => {
          if (["orders", "boms", "workorders", "workcenters"].includes(tabId)) {
            setRowPick({ tabId, row })
          }
        }}
      />
      <ManufacturingRowDialog
        open={rowPick !== null}
        onOpenChange={(o) => {
          if (!o) setRowPick(null)
        }}
        tabId={rowPick?.tabId ?? null}
        row={rowPick?.row ?? null}
        workcenters={workcenters}
        iotDevices={iotDevices}
        mutations={m}
        t={t}
      />
      {csvKind && csvFormConfig ? (
        <FormModal
          key={csvKind}
          open
          onOpenChange={(o) => !o && setCsvKind(null)}
          config={csvFormConfig}
          isPending={isFormMutationPending}
          closeOnSubmit={false}
          submitError={csvError}
          onSubmit={async (data) => {
            setCsvError(null)
            const files = data.csvFile as FileList | undefined
            const file = files?.[0]
            if (!file) {
              setCsvError(t("common.validation.required"))
              return
            }
            try {
              const text = await file.text()
              if (csvKind === "mo") await m.importMoCsv.mutateAsync(text)
              else if (csvKind === "bom") await m.importBomCsv.mutateAsync(text)
              else if (csvKind === "bom_line") await m.importBomLineCsv.mutateAsync(text)
              else await m.importWorkcenterCsv.mutateAsync(text)
              setCsvKind(null)
            } catch (e) {
              setCsvError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      ) : null}
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? moFormConfig}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (quickActionForm) {
            await handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
    </>
  )
}

"use client"
import { mapDashboardWidgets, withDashboardSections } from "@lumiere/ui/lib/dashboard-sections"

import { useEffect, useMemo, useState } from "react"
import { useModuleTab } from "@/hooks/use-module-tab"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  CsvImportModal,
  newManufacturingOrderForm,
  newBomForm,
  newWorkcenterForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
  manufacturingCsvImportForm,
} from "@lumiere/ui"
import type { ManufacturingCsvImportKind } from "@lumiere/ui"
import type { EntityViewConfig, FormConfig, ModuleConfig } from "@lumiere/ui"
import type { Product, Warehouse, StockPicking, StockQuant } from "@lumiere/stdb/types"
import { manufacturingModuleConfig } from "@/lib/module-dashboard-configs"
import { useManufacturingModuleSubscription } from "@/lib/module-subscription-hooks"
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
import type {
  MrpBom,
  MrpBomLine,
  MrpProduction,
  MrpRoutingWorkcenter,
  MrpWorkcenter,
  MrpWorkorder,
} from "@lumiere/query-hooks/hooks/manufacturing"
import { ManufacturingRowDialog } from "./manufacturing-row-dialog"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import {
  toCreateBomParams,
  toCreateMrpProductionParams,
  toCreateWorkcenterParams,
} from "@lumiere/erp-shared/manufacturing-create-params"
import { optionalBigIntU64 } from "@lumiere/erp-shared/form-coercion"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import {
  useProducts,
  useStockQuants,
  useStockPickings,
  useWarehouses,
} from "@lumiere/query-hooks/hooks/inventory"
import { useIotDevices } from "@lumiere/query-hooks/hooks/iot"
import type { IoTDevice } from "@lumiere/query-hooks/hooks/iot"
import {
  productRowsToSelectOptions,
  warehouseRowsToSelectOptions,
  pickingTypeOptionsFromTransfers,
  locationOptionsFromQuantsAndTransfers,
  mrpBomRowsToSelectOptions,
} from "@/lib/form-lookup"

interface ManufacturingClientProps {
  initialProductions?: MrpProduction[]
  initialBoms?: MrpBom[]
  initialBomLines?: MrpBomLine[]
  initialWorkorders?: MrpWorkorder[]
  initialWorkcenters?: MrpWorkcenter[]
  initialRoutingOperations?: MrpRoutingWorkcenter[]
  initialIotDevices?: IoTDevice[]
  initialProducts?: Product[]
  initialWarehouses?: Warehouse[]
  initialStockPickings?: StockPicking[]
  initialStockQuants?: StockQuant[]
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
  useManufacturingModuleSubscription()
  const { t } = useTranslation()
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n
  const hasActiveCompany = operatingCompanyId > 0n
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const [rowPick, setRowPick] = useState<{ tabId: string; row: Record<string, unknown> } | null>(null)
  const [csvKind, setCsvKind] = useState<ManufacturingCsvImportKind | null>(null)
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

  const m = useManufacturingMutations(orgId, operatingCompanyId)

  const moduleConfig = useMemo(() => manufacturingModuleConfig(t), [t])
  const { activeTab, setActiveTab } = useModuleTab(
    moduleConfig.defaultTab ?? "dashboard",
    moduleConfig.tabs.map((tab) => tab.id),
  )

  const csvFormConfig = useMemo(() => {
    if (!csvKind) return null
    return manufacturingCsvImportForm(t, csvKind)
  }, [csvKind, t])

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

  // Enrich rows with resolved relation labels so entity tables show names, not IDs.
  const enrichedProductions = useMemo(
    () =>
      productions.map((p) => ({
        ...p,
        productName: (() => {
          const product = products.find((pr) => String(pr.id) === String(p.productId))
          return product != null ? String(product.name ?? p.productId) : String(p.productId ?? "—")
        })(),
        workcenterName: (() => {
          // Pre-existing bug: MrpProduction has no `workcenterId` field (only workorders
          // do); this lookup has always resolved to `undefined`. Cast preserves that
          // behavior — flagged for a follow-up to fix the actual enrichment logic.
          const pWorkcenterId = (p as Record<string, unknown>).workcenterId
          const workcenter = workcenters.find((wc) => String(wc.id) === String(pWorkcenterId))
          return workcenter != null ? String(workcenter.name ?? pWorkcenterId) : undefined
        })(),
      })) as Record<string, unknown>[],
    [productions, products, workcenters],
  )

  const enrichedWorkorders = useMemo(
    () =>
      workorders.map((wo) => ({
        ...wo,
        workcenterName: (() => {
          const workcenter = workcenters.find((wc) => String(wc.id) === String(wo.workcenterId))
          return workcenter != null ? String(workcenter.name ?? wo.workcenterId) : String(wo.workcenterId ?? "—")
        })(),
        productionRef: (() => {
          const production = productions.find((p) => String(p.id) === String(wo.productionId))
          // Pre-existing bug: MrpProduction has no `name` field, so this has always
          // fallen through to the `MO-<id suffix>` form. Cast preserves that behavior —
          // flagged for a follow-up to fix the actual enrichment logic.
          const productionName = (production as Record<string, unknown> | undefined)?.name
          return production != null
            ? String(productionName ?? `MO-${String(production.id).slice(-6)}`)
            : String(wo.productionId ?? "—")
        })(),
      })) as Record<string, unknown>[],
    [workorders, workcenters, productions],
  )

  const enrichedBoms = useMemo(
    () =>
      boms.map((b) => ({
        ...b,
        productName: (() => {
          const product = products.find((pr) => String(pr.id) === String(b.productId))
          return product != null ? String(product.name ?? b.productId) : String(b.productId ?? "—")
        })(),
      })) as Record<string, unknown>[],
    [boms, products],
  )

  const enrichedRoutingOperations = useMemo(
    () =>
      routingOperations.map((op) => ({
        ...op,
        workcenterName: (() => {
          const workcenter = workcenters.find((wc) => String(wc.id) === String(op.workcenterId))
          return workcenter != null ? String(workcenter.name ?? op.workcenterId) : String(op.workcenterId ?? "—")
        })(),
      })) as Record<string, unknown>[],
    [routingOperations, workcenters],
  )

  const liveSections = useMemo(() => {
    const activeOrders = enrichedProductions.filter(
      (p) => String(p.state) === "Confirmed" || String(p.state) === "Progress"
    )
    const doneOrders = enrichedProductions.filter((p) => String(p.state) === "Done")
    const totalOrders = enrichedProductions.length
    const onTimeRate =
      totalOrders > 0 ? Math.round((doneOrders.length / totalOrders) * 100) : 0

    const avgOee =
      workcenters.length > 0
        ? Math.round(
          workcenters.reduce((s, wc) => s + Number(wc.oee ?? 0), 0) / workcenters.length
        )
        : 0

    const readyWorkorders = workorders.filter((wo) => String(wo.state) === "Ready").length

    return mapDashboardWidgets(moduleConfig, (w) => {
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
              const activeOrdersRows = enrichedProductions
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
                    ref: String(p.name ?? `MO-${String(p.id).slice(-6)}`),
                    product: String(p.productName ?? p.productId ?? "—"),
                    qty: Math.round(Number(p.qtyProducing ?? 0)),
                    progress,
                    due: dueStr,
                    status: String(p.state ?? "Draft"),
                  }
                })
              return { ...w, data: { ...(w.data as Record<string, unknown>), rows: activeOrdersRows } }
            }
            return w
              })
  }, [
    enrichedProductions,
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
        tabs: withDashboardSections(moduleConfig, liveSections).tabs.map((tab) => {
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
      orders: enrichedProductions as unknown as Record<string, unknown>[],
      boms: enrichedBoms as unknown as Record<string, unknown>[],
      "bom-lines": bomLines as unknown as Record<string, unknown>[],
      workorders: enrichedWorkorders as unknown as Record<string, unknown>[],
      workcenters: workcenters as unknown as Record<string, unknown>[],
      "routing-operations": enrichedRoutingOperations as unknown as Record<string, unknown>[],
      quality: qualityChecks as unknown as Record<string, unknown>[],
    }),
    [enrichedProductions, enrichedBoms, bomLines, enrichedWorkorders, workcenters, enrichedRoutingOperations, qualityChecks],
  )

  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>
  ) => {
    if (!hasActiveCompany) {
      throw new Error(t("manufacturing.errors.noActiveCompany"))
    }
    if (action === "createManufacturingOrder") {
      const prodRaw = formData.productId
      const productRow = products.find((p) => String(p.id) === String(prodRaw))
      const uomFromProduct =
        productRow?.uomId != null
          ? optionalBigIntU64(productRow.uomId)
          : productRow?.uomPoId != null
            ? optionalBigIntU64(productRow.uomPoId)
            : undefined
      if (uomFromProduct == null) return
      const params = toCreateMrpProductionParams(formData, {
        productUomId: uomFromProduct,
        companyId: operatingCompanyId > 0n ? operatingCompanyId : undefined,
      })
      if (!params) return
      await m.createManufacturingOrder.mutateAsync(params)
    } else if (action === "createBom") {
      const tmplRaw = formData.productTmplId
      const productRow = products.find((p) => String(p.id) === String(tmplRaw))
      const uomFromProduct =
        productRow?.uomId != null
          ? optionalBigIntU64(productRow.uomId)
          : productRow?.uomPoId != null
            ? optionalBigIntU64(productRow.uomPoId)
            : undefined
      if (uomFromProduct == null) return
      const params = toCreateBomParams(formData, {
        productUomId: uomFromProduct,
        companyId: operatingCompanyId > 0n ? operatingCompanyId : undefined,
      })
      if (!params) return
      await m.createBom.mutateAsync(params)
    } else if (action === "createWorkcenter") {
      const params = toCreateWorkcenterParams(
        formData,
        operatingCompanyId > 0n ? operatingCompanyId : undefined,
      )
      if (!params) return
      await m.createWorkcenter.mutateAsync(params)
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
        <CsvImportModal
          key={csvKind}
          onClose={() => setCsvKind(null)}
          config={csvFormConfig}
          isPending={isFormMutationPending}
          onImport={async (text) => {
            if (csvKind === "mo") await m.importMoCsv.mutateAsync(text)
            else if (csvKind === "bom") await m.importBomCsv.mutateAsync(text)
            else if (csvKind === "bom_line") await m.importBomLineCsv.mutateAsync(text)
            else await m.importWorkcenterCsv.mutateAsync(text)
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

"use client"

import { useMemo, useState, useEffect } from "react"
import dynamic from "next/dynamic"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  newProductForm,
  newTransferForm,
  newInventoryAdjustmentForm,
  newStockLocationForm,
  newWarehouseForm,
  editWarehouseForm,
  editProductForm,
  newProductVariantForm,
  assignUserToPickingForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
} from "@lumiere/ui"
import type { EntityTableConfig, FormConfig, ModuleConfig } from "@lumiere/ui"
import { inventoryModuleConfig } from "@/lib/module-dashboard-configs"
import { groupBy } from "@/lib/utils"
import {
  useProducts,
  useProductCategories,
  useUoms,
  useStockQuants,
  useStockPickings,
  useWarehouses,
  useInventoryAdjustments,
  useStockLocations,
  useProductionLots,
  useQualityChecks,
  useStockCycleCounts,
  usePickingWaves,
  useWarehouseTasks,
  useStockRoutes,
  useStockRules,
  useStockMoves,
  useInventoryValuations,
  useReplenishmentRules,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  useCreateProductVariant,
  useCreateStockPicking,
  useCreateInventoryAdjustment,
  useCreateStockLocation,
  useCreateWarehouse,
  useUpdateWarehouse,
  useDeleteWarehouse,
  useDeleteStockLocation,
  useConfirmStockPicking,
  useAssignStockPicking,
  useAssignUserToPicking,
  useValidateStockPicking,
  useCancelStockPicking,
  useProcessInventoryAdjustment,
  useReserveStockQuant,
  useUnreserveStockQuant,
  useWarehouse3D,
  useMoveStockItem3D,
  useDoneStockMove,
  useCancelStockMove,
  useOrgUsers,
} from "@/hooks/inventory"
import { usePricelists } from "@/hooks/sales"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"

type ScalarId = bigint | number | string
import {
  pricelistRowsToSelectOptions,
  pickingTypeOptionsFromTransfers,
  locationOptionsFromQuantsAndTransfers,
  productRowsToSelectOptions,
  productCategoryRowsToSelectOptions,
  uomRowsToSelectOptions,
} from "@/lib/form-lookup"
import { CheckCircle, ListChecks, Pencil, Plus, Trash2, UserCircle2, UserPlus, XCircle } from "lucide-react"
import { buildCreateWarehouseParamsFromTemplate } from "@/lib/warehouse-create-params"
import { withDefaultsFromRow } from "@/lib/prefill-form-config"
import { CycleCountWizard } from "./cycle-count-wizard"

// WarehouseViewer uses Three.js — must be loaded client-side only, imported directly to avoid SSR barrel evaluation
const WarehouseViewer = dynamic(
  () => import("@lumiere/ui/stock-3d/warehouse-viewer"),
  { ssr: false, loading: () => <div className="flex items-center justify-center h-full text-muted-foreground">Loading 3D viewer…</div> }
)

interface InventoryClientProps {
  initialProducts?: Record<string, unknown>[]
  initialStockQuants?: Record<string, unknown>[]
  initialTransfers?: Record<string, unknown>[]
  initialWarehouses?: Record<string, unknown>[]
  initialAdjustments?: Record<string, unknown>[]
  initialPricelists?: Record<string, unknown>[]
  initialProductCategories?: Record<string, unknown>[]
  initialUoms?: Record<string, unknown>[]
  initialStockLocations?: Record<string, unknown>[]
  initialStockCycleCounts?: Record<string, unknown>[]
  initialStockMoves?: Record<string, unknown>[]
  initialWarehouse3dZones?: Record<string, unknown>[]
  initialInventoryValuations?: Record<string, unknown>[]
  initialReplenishmentRules?: Record<string, unknown>[]
  organizationId?: number
}

type InventoryClientLoadedProps = Omit<InventoryClientProps, "organizationId"> & {
  organizationId: number
}

export function InventoryClient(props: InventoryClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <InventoryClientLoaded {...props} organizationId={props.organizationId} />
}

function InventoryClientLoaded({
  initialProducts,
  initialStockQuants,
  initialTransfers,
  initialWarehouses,
  initialAdjustments,
  initialPricelists,
  initialProductCategories,
  initialUoms,
  initialStockLocations,
  initialStockCycleCounts,
  initialStockMoves,
  initialWarehouse3dZones: _initialWarehouse3dZones,
  initialInventoryValuations,
  initialReplenishmentRules,
  organizationId,
}: InventoryClientLoadedProps) {
  const { t } = useTranslation()
  const { orgId, companyId } = orgBigInts(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const [editProductRow, setEditProductRow] = useState<Record<string, unknown> | null>(null)
  const [variantProductId, setVariantProductId] = useState<ScalarId | null>(null)
  const [editWarehouseRow, setEditWarehouseRow] = useState<Record<string, unknown> | null>(null)
  const [assignPickingId, setAssignPickingId] = useState<ScalarId | null>(null)

  const { data: products = [] } = useProducts(orgId, initialProducts)
  const { data: productCategories = [] } = useProductCategories(orgId, initialProductCategories)
  const { data: uoms = [] } = useUoms(orgId, initialUoms)
  const { data: stockQuants = [] } = useStockQuants(orgId, initialStockQuants)
  const { data: transfers = [] } = useStockPickings(orgId, initialTransfers)
  const { data: warehouses = [] } = useWarehouses(orgId, initialWarehouses)
  const { data: adjustments = [] } = useInventoryAdjustments(orgId, initialAdjustments)
  const { data: locations = [] } = useStockLocations(orgId, initialStockLocations)
  const { data: lots = [] } = useProductionLots(orgId)
  const { data: qualityChecks = [] } = useQualityChecks(orgId)
  const { data: cycleCounts = [] } = useStockCycleCounts(orgId, initialStockCycleCounts)
  const { data: pickingWaves = [] } = usePickingWaves(orgId)
  const { data: warehouseTasks = [] } = useWarehouseTasks(orgId)
  const { data: stockRoutes = [] } = useStockRoutes(orgId)
  const { data: stockRules = [] } = useStockRules(orgId)
  const { data: stockMoves = [] } = useStockMoves(orgId, initialStockMoves)
  const { data: inventoryValuations = [] } = useInventoryValuations(orgId, initialInventoryValuations)
  const { data: replenishmentRulesList = [] } = useReplenishmentRules(orgId, initialReplenishmentRules)
  const { data: orgUsers = [] } = useOrgUsers()
  const { data: pricelists = [] } = usePricelists(orgId, initialPricelists)

  const pricelistFieldOptions = useMemo(() => {
    const fromApi = pricelistRowsToSelectOptions(pricelists)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noPricelists"), disabled: true }]
  }, [pricelists, t])

  const categoryFieldOptions = useMemo(() => {
    const fromApi = productCategoryRowsToSelectOptions(productCategories)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noCategories"), disabled: true }]
  }, [productCategories, t])

  const uomFieldOptions = useMemo(() => {
    const fromApi = uomRowsToSelectOptions(uoms)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noUoms"), disabled: true }]
  }, [uoms, t])

  const uomPoFieldOptions = useMemo(() => {
    const base = uomRowsToSelectOptions(uoms)
    if (base.length === 0) return [{ value: "", label: t("common.lookup.noUoms"), disabled: true }]
    return [
      { value: "", label: t("inventory.forms.newProduct.fields.uomPoSameAsSales") },
      ...base,
    ]
  }, [uoms, t])

  const productFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newProductForm(t), {
        pricelistId: pricelistFieldOptions,
        categId: categoryFieldOptions,
        uomId: uomFieldOptions,
        uomPoId: uomPoFieldOptions,
      }),
    [t, pricelistFieldOptions, categoryFieldOptions, uomFieldOptions, uomPoFieldOptions],
  )

  const transferFieldOptions = useMemo(() => {
    const picking = pickingTypeOptionsFromTransfers(transfers)
    const locs = locationOptionsFromQuantsAndTransfers(stockQuants, transfers)
    const emptyPicking =
      picking.length > 0
        ? picking
        : [{ value: "", label: t("common.lookup.noStockMoves"), disabled: true }]
    const emptyLocs =
      locs.length > 0 ? locs : [{ value: "", label: t("common.lookup.noStockMoves"), disabled: true }]
    return { picking, locs, emptyPicking, emptyLocs }
  }, [transfers, stockQuants, t])

  const transferFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newTransferForm(t), {
        pickingTypeId: transferFieldOptions.emptyPicking,
        locationId: transferFieldOptions.emptyLocs,
        locationDestId: transferFieldOptions.emptyLocs,
      }),
    [t, transferFieldOptions],
  )

  const adjustmentFieldOptions = useMemo(() => {
    const prod = productRowsToSelectOptions(products)
    const locs = locationOptionsFromQuantsAndTransfers(stockQuants, transfers)
    return {
      product: prod.length > 0 ? prod : [{ value: "", label: t("common.lookup.noProducts"), disabled: true }],
      location:
        locs.length > 0 ? locs : [{ value: "", label: t("common.lookup.noStockMoves"), disabled: true }],
    }
  }, [products, stockQuants, transfers, t])

  const adjustmentFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newInventoryAdjustmentForm(t), {
        productId: adjustmentFieldOptions.product,
        locationId: adjustmentFieldOptions.location,
      }),
    [t, adjustmentFieldOptions],
  )

  const createProduct = useCreateProduct(orgId)
  const createStockPicking = useCreateStockPicking(orgId, companyId)
  const createInventoryAdjustment = useCreateInventoryAdjustment(orgId)
  const createStockLocation = useCreateStockLocation(orgId)
  const createWarehouse = useCreateWarehouse(orgId)
  const updateWarehouse = useUpdateWarehouse(orgId)
  const deleteWarehouse = useDeleteWarehouse(orgId)
  const updateProduct = useUpdateProduct(orgId)
  const deleteProduct = useDeleteProduct(orgId)
  const createProductVariant = useCreateProductVariant(orgId)
  const deleteStockLocation = useDeleteStockLocation(orgId)
  const doneStockMove = useDoneStockMove(orgId)
  const cancelStockMove = useCancelStockMove(orgId)
  const assignUserToPicking = useAssignUserToPicking(orgId)
  const confirmPicking = useConfirmStockPicking(orgId)
  const assignPicking = useAssignStockPicking(orgId)
  const validatePicking = useValidateStockPicking(orgId)
  const cancelPicking = useCancelStockPicking(orgId)
  const processAdjustment = useProcessInventoryAdjustment(orgId)
  const reserveQuant = useReserveStockQuant(orgId)
  const unreserveQuant = useUnreserveStockQuant(orgId)

  const locationParentOptions = useMemo(() => {
    const opts = locations.map((loc) => ({
      value: String(loc.id),
      label: String(loc.completeName ?? loc.name ?? loc.id),
    }))
    return [
      { value: "", label: t("inventory.forms.newStockLocation.fields.parentNone") },
      ...opts,
    ]
  }, [locations, t])

  const stockLocationFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newStockLocationForm(t), {
        parentLocationId: locationParentOptions,
      }),
    [t, locationParentOptions],
  )

  const warehouseTemplateOptions = useMemo(() => {
    if (warehouses.length === 0)
      return [{ value: "", label: t("common.lookup.noWarehouses"), disabled: true }]
    return warehouses.map((w) => ({
      value: String(w.id),
      label: `${String(w.name ?? "")} (${String(w.code ?? w.id)})`,
    }))
  }, [warehouses, t])

  const warehouseFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newWarehouseForm(t), {
        templateWarehouseId: warehouseTemplateOptions,
      }),
    [t, warehouseTemplateOptions],
  )

  const assignUserFieldOptions = useMemo(() => {
    const rows = orgUsers as Record<string, unknown>[]
    const opts = rows
      .map((u) => {
        const id = String(u.identity ?? u.userIdentity ?? "")
        if (!id) return null
        return {
          value: id,
          label: String(u.name ?? u.email ?? u.username ?? id).slice(0, 80),
        }
      })
      .filter((x): x is { value: string; label: string } => x != null)
    return [{ value: "", label: "—" }, ...opts]
  }, [orgUsers])

  const assignUserFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(assignUserToPickingForm(t), {
        userIdentity: assignUserFieldOptions,
      }),
    [t, assignUserFieldOptions],
  )

  const editProductModalConfig = useMemo(() => {
    if (!editProductRow) return editProductForm(t)
    return withDefaultsFromRow(editProductForm(t), editProductRow)
  }, [t, editProductRow])

  const editWarehouseModalConfig = useMemo(() => {
    if (!editWarehouseRow) return editWarehouseForm(t)
    return withDefaultsFromRow(editWarehouseForm(t), editWarehouseRow)
  }, [t, editWarehouseRow])

  // 3D viewer — use first warehouse found (or 0n as a no-op before warehouses load)
  const firstWarehouseId = warehouses[0]?.id ? BigInt(String(warehouses[0].id)) : 0n
  const { zones, slots, items: warehouseItems } = useWarehouse3D(orgId, companyId, firstWarehouseId)
  const moveStockItem = useMoveStockItem3D(orgId)

  const moduleConfig = useMemo(() => inventoryModuleConfig(t), [t])

  // Only render the 3D viewer on the client to avoid SSR/hydration tree mismatches
  const [isMounted, setIsMounted] = useState(false)
  useEffect(() => setIsMounted(true), [])

  const liveSections = useMemo(() => {
    const totalSkus = products.length
    const stockValue = stockQuants.reduce((s, q) => s + Number(q.value ?? 0), 0)
    const zeroStock = stockQuants.filter((q) => Number(q.availableQuantity ?? 0) <= 0).length
    const pendingTransfers = transfers.filter(
      (transfer) => String(transfer.state) === "confirmed" || String(transfer.state) === "assigned"
    ).length

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
                    { label: t("inventory.dashboard.totalSKUs"), value: totalSkus.toString(), icon: "Package" },
                    { label: t("inventory.dashboard.stockValue"), value: `$${stockValue.toLocaleString()}`, icon: "DollarSign" },
                    { label: t("inventory.dashboard.zeroStockAlerts"), value: zeroStock.toString(), icon: "AlertTriangle" },
                    { label: t("inventory.dashboard.pendingTransfers"), value: pendingTransfers.toString(), icon: "Truck" },
                  ],
                },
              }
            }
            if (w.type === "quick-actions") {
              const handlers: Record<string, () => void> = {
                create_product: () => setQuickActionForm({ form: productFormConfig, action: "createProduct" }),
                create_transfer: () => setQuickActionForm({ form: transferFormConfig, action: "createStockPicking" }),
                create_adjustment: () =>
                  setQuickActionForm({ form: adjustmentFormConfig, action: "createInventoryAdjustment" }),
              }
              return {
                ...w,
                data: {
                  ...w.data,
                  actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] })),
                },
              }
            }
            if (w.id === "inv-by-category") {
              // Group by costMethod as a proxy for category
              const byType = groupBy(stockQuants, (q) => String(q.costMethod ?? "Standard"))
              const colors = ["#6366f1", "#8b5cf6", "#22c55e", "#f59e0b", "#ef4444"]
              const allQty = stockQuants.reduce((s, q) => s + Number(q.availableQuantity ?? 0), 0)
              const metrics = Object.entries(byType)
                .map(([label, quants]) => ({
                  label,
                  value: Math.round(quants.reduce((s, q) => s + Number(q.availableQuantity ?? 0), 0)),
                  max: Math.max(1, Math.round(allQty)),
                  color: "#6366f1",
                }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 5)
                .map((m, i) => ({ ...m, color: colors[i] ?? "#6366f1" }))
              return { ...w, data: { metrics } }
            }
            if (w.id === "inv-movements") {
              const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
              const nowMs = Date.now()
              const sevenDaysAgo = nowMs - 7 * 86400000
              const dayIn: Record<string, number> = {}
              const dayOut: Record<string, number> = {}
              const orderedDays: string[] = []
              for (let i = 6; i >= 0; i--) {
                const d = new Date(nowMs - i * 86400000)
                const label = days[d.getDay()]
                if (!orderedDays.includes(label)) orderedDays.push(label)
                dayIn[label] = 0
                dayOut[label] = 0
              }
              for (const t of transfers) {
                const ms = Number(t.scheduledDate ?? 0) / 1000
                if (ms < sevenDaysAgo || ms > nowMs) continue
                const label = days[new Date(ms).getDay()]
                if (String(t.pickingCode ?? "").toLowerCase().includes("in")) {
                  dayIn[label] = (dayIn[label] ?? 0) + 1
                } else {
                  dayOut[label] = (dayOut[label] ?? 0) + 1
                }
              }
              const values = orderedDays.map((day) => ({ day, In: dayIn[day] ?? 0, Out: dayOut[day] ?? 0 }))
              return { ...w, data: { ...(w.data as Record<string, unknown>), values } }
            }
            if (w.id === "inv-low-stock-table") {
              const lowStock = stockQuants
                .filter((q) => Number(q.availableQuantity ?? 0) <= 0)
                .slice(0, 5)
                .map((q) => {
                  const product = products.find((p) => p.id === q.productId)
                  return {
                    sku: String(product?.defaultCode ?? t("inventory.dashboard.skuFallback", { id: String(q.productId).slice(-4) })),
                    name: String(product?.name ?? t("inventory.dashboard.productFallback", { id: String(q.productId).slice(-4) })),
                    qty: Math.round(Number(q.availableQuantity ?? 0)),
                    reorder: "—",
                    status: "Critical",
                  }
                })
              return { ...w, data: { ...(w.data as Record<string, unknown>), rows: lowStock } }
            }
            return w
          }),
        })) ??
      moduleConfig.tabs.find((tab) => tab.id === "dashboard")?.sections ??
      []
    )
  }, [
    products,
    stockQuants,
    transfers,
    t,
    moduleConfig,
    productFormConfig,
    transferFormConfig,
    adjustmentFormConfig,
  ])

  const warehouse3DTab = useMemo(
    () => ({
      id: "3d-view",
      label: t("inventory.3dView"),
      type: "custom" as const,
      customContent: isMounted ? (
        <div className="h-[calc(100vh-12rem)]">
          <WarehouseViewer
            zones={zones}
            slots={slots}
            items={warehouseItems}
            warehouseName={warehouses[0]?.name ? String(warehouses[0].name) : undefined}
            onMoveItem={(itemId, targetSlotId) => {
              moveStockItem.mutate({
                quantId: BigInt(itemId),
                targetLocationId: BigInt(targetSlotId),
                quantity: 1,
              })
            }}
          />
        </div>
      ) : null,
    }),
    [zones, slots, warehouseItems, warehouses, moveStockItem, t, isMounted]
  )

  const cycleCountWizardTab = useMemo(
    () => ({
      id: "cycle-wizard",
      label: t("inventory.cycleCountWizard.tabLabel"),
      type: "custom" as const,
      customContent: <CycleCountWizard organizationId={organizationId} locations={locations} />,
    }),
    [t, organizationId, locations],
  )

  const config = useMemo(() => {
    const withTransferActions = (
      tab: (typeof moduleConfig.tabs)[number],
    ): (typeof moduleConfig.tabs)[number] => {
      if (tab.type !== "entity" || !tab.entityConfig || tab.entityConfig.view.mode !== "table") {
        return tab
      }
      const v = tab.entityConfig.view as EntityTableConfig
      if (tab.id === "transfers") {
        return {
          ...tab,
          createForm: transferFormConfig,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: "confirm-picking",
                  label: t("inventory.transferActions.confirm"),
                  icon: CheckCircle,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) void confirmPicking.mutateAsync(id)
                  },
                },
                {
                  id: "assign-picking",
                  label: t("inventory.transferActions.assign"),
                  icon: UserCircle2,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) void assignPicking.mutateAsync(id)
                  },
                },
                {
                  id: "assign-user-picking",
                  label: t("inventory.transferActions.assignUser"),
                  icon: UserPlus,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) setAssignPickingId(id)
                  },
                },
                {
                  id: "validate-picking",
                  label: t("inventory.transferActions.validate"),
                  icon: ListChecks,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) void validatePicking.mutateAsync(id)
                  },
                },
                {
                  id: "cancel-picking",
                  label: t("inventory.transferActions.cancel"),
                  icon: XCircle,
                  variant: "destructive",
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) void cancelPicking.mutateAsync(id)
                  },
                },
              ],
            },
          },
        }
      }
      if (tab.id === "products") {
        return {
          ...tab,
          createForm: productFormConfig,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: "edit-product",
                  label: t("common.edit"),
                  icon: Pencil,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const row = rows[0] as Record<string, unknown> | undefined
                    if (row) setEditProductRow(row)
                  },
                },
                {
                  id: "delete-product",
                  label: t("common.delete"),
                  icon: Trash2,
                  variant: "destructive",
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id == null) return
                    if (typeof window !== "undefined" && window.confirm(t("inventory.productActions.confirmDelete"))) {
                      void deleteProduct.mutateAsync(id)
                    }
                  },
                },
                {
                  id: "add-variant",
                  label: t("inventory.productActions.addVariant"),
                  icon: Plus,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) setVariantProductId(id)
                  },
                },
              ],
            },
          },
        }
      }
      if (tab.id === "warehouses") {
        return {
          ...tab,
          createForm: warehouseFormConfig,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: "edit-warehouse",
                  label: t("common.edit"),
                  icon: Pencil,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const row = rows[0] as Record<string, unknown> | undefined
                    if (row) setEditWarehouseRow(row)
                  },
                },
                {
                  id: "delete-warehouse",
                  label: t("common.delete"),
                  icon: Trash2,
                  variant: "destructive",
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id == null) return
                    if (typeof window !== "undefined" && window.confirm(t("inventory.warehouseActions.confirmDelete"))) {
                      void deleteWarehouse.mutateAsync(id)
                    }
                  },
                },
              ],
            },
          },
        }
      }
      if (tab.id === "stock-moves") {
        return {
          ...tab,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: "done-move",
                  label: t("inventory.stockMoveActions.done"),
                  icon: CheckCircle,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const row = rows[0] as Record<string, unknown> | undefined
                    const id = row?.id as ScalarId | undefined
                    if (id == null) return
                    const def = Number(row?.productUomQty ?? row?.product_uom_qty ?? 1)
                    const q =
                      typeof window !== "undefined"
                        ? window.prompt(t("inventory.stockMoveActions.quantityDonePrompt"), String(def))
                        : null
                    const qty = q != null && q !== "" ? Number(q) : def
                    if (!Number.isFinite(qty)) return
                    void doneStockMove.mutateAsync({ moveId: id, quantityDone: qty })
                  },
                },
                {
                  id: "cancel-move",
                  label: t("inventory.stockMoveActions.cancel"),
                  icon: XCircle,
                  variant: "destructive",
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) void cancelStockMove.mutateAsync(id)
                  },
                },
              ],
            },
          },
        }
      }
      if (tab.id === "stock") {
        return {
          ...tab,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: "reserve-qty",
                  label: t("inventory.stockActions.reserve"),
                  icon: CheckCircle,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) void reserveQuant.mutateAsync({ quantId: id, reserveQty: 1 })
                  },
                },
                {
                  id: "unreserve-qty",
                  label: t("inventory.stockActions.unreserve"),
                  icon: XCircle,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) void unreserveQuant.mutateAsync({ quantId: id, unreserveQty: 1 })
                  },
                },
              ],
            },
          },
        }
      }
      if (tab.id === "adjustments") {
        return {
          ...tab,
          createForm: adjustmentFormConfig,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: "process-adjustment",
                  label: t("inventory.adjustmentActions.process"),
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) void processAdjustment.mutateAsync(id)
                  },
                },
              ],
            },
          },
        }
      }
      if (tab.id === "locations") {
        return {
          ...tab,
          createForm: stockLocationFormConfig,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: "delete-location",
                  label: t("common.delete"),
                  variant: "destructive",
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) void deleteStockLocation.mutateAsync(id)
                  },
                },
              ],
            },
          },
        }
      }
      return tab
    }

    return {
      ...moduleConfig,
      tabs: [
        ...moduleConfig.tabs.map((tab) => {
          if (tab.id === "dashboard") return { ...tab, sections: liveSections }
          if (tab.id === "products") return withTransferActions(tab)
          if (tab.id === "transfers") return withTransferActions(tab)
          if (tab.id === "warehouses") return withTransferActions(tab)
          if (tab.id === "stock-moves") return withTransferActions(tab)
          if (tab.id === "stock") return withTransferActions(tab)
          if (tab.id === "adjustments") return withTransferActions(tab)
          if (tab.id === "locations") return withTransferActions(tab)
          return tab
        }),
        cycleCountWizardTab,
        warehouse3DTab,
      ],
    } as ModuleConfig
  }, [
    moduleConfig,
    liveSections,
    cycleCountWizardTab,
    warehouse3DTab,
    productFormConfig,
    warehouseFormConfig,
    transferFormConfig,
    adjustmentFormConfig,
    stockLocationFormConfig,
    t,
    confirmPicking,
    assignPicking,
    validatePicking,
    cancelPicking,
    processAdjustment,
    reserveQuant,
    unreserveQuant,
    deleteStockLocation,
    deleteProduct,
    deleteWarehouse,
    doneStockMove,
    cancelStockMove,
  ])

  const data = useMemo(
    () => ({
      products: products as unknown as Record<string, unknown>[],
      stock: stockQuants as unknown as Record<string, unknown>[],
      transfers: transfers as unknown as Record<string, unknown>[],
      warehouses: warehouses as unknown as Record<string, unknown>[],
      adjustments: adjustments as unknown as Record<string, unknown>[],
      locations: locations as unknown as Record<string, unknown>[],
      lots: lots as unknown as Record<string, unknown>[],
      quality: qualityChecks as unknown as Record<string, unknown>[],
      "cycle-counts": cycleCounts as unknown as Record<string, unknown>[],
      "picking-waves": pickingWaves as unknown as Record<string, unknown>[],
      "warehouse-tasks": warehouseTasks as unknown as Record<string, unknown>[],
      routes: stockRoutes as unknown as Record<string, unknown>[],
      rules: stockRules as unknown as Record<string, unknown>[],
      "stock-moves": stockMoves as unknown as Record<string, unknown>[],
      valuations: inventoryValuations as unknown as Record<string, unknown>[],
      replenishment: replenishmentRulesList as unknown as Record<string, unknown>[],
    }),
    [
      products,
      stockQuants,
      transfers,
      warehouses,
      adjustments,
      locations,
      lots,
      qualityChecks,
      cycleCounts,
      pickingWaves,
      warehouseTasks,
      stockRoutes,
      stockRules,
      stockMoves,
      inventoryValuations,
      replenishmentRulesList,
    ]
  )

  const handleFormSubmit = (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>
  ) => {
    if (action === "createProduct") {
      const categRaw = formData.categId
      const uomRaw = formData.uomId
      if (categRaw === "" || categRaw == null || uomRaw === "" || uomRaw == null) return
      const categId = Number(categRaw)
      const uomId = Number(uomRaw)
      const uomPoRaw = formData.uomPoId
      const uomPoId =
        uomPoRaw !== "" && uomPoRaw != null && String(uomPoRaw).trim() !== ""
          ? Number(uomPoRaw)
          : uomId
      const pricelistRaw = formData.pricelistId
      if (pricelistRaw === "" || pricelistRaw == null) return
      const pl = pricelists.find((p) => String(p.id) === String(pricelistRaw))
      if (pl == null || pl.currencyId === undefined || pl.currencyId === null) return
      const currencyId = Number(pl.currencyId)
      createProduct.mutate({
        name: String(formData.name ?? ""),
        categId,
        type: String(formData.type ?? "product"),
        uomId,
        uomPoId,
        standardPrice: Number(formData.standardPrice ?? 0),
        listPrice: Number(formData.listPrice ?? formData.standardPrice ?? 0),
        currencyId,
        defaultCode: formData.defaultCode ? String(formData.defaultCode) : undefined,
        barcode: formData.barcode ? String(formData.barcode) : undefined,
        description: formData.description ? String(formData.description) : undefined,
        saleOk: formData.saleOk == null ? true : Boolean(formData.saleOk),
        purchaseOk: formData.purchaseOk == null ? true : Boolean(formData.purchaseOk),
        displayName: formData.name ? String(formData.name) : undefined,
        costMethod: String(formData.costMethod ?? "standard"),
        valuation: String(formData.valuation ?? "manual_periodic"),
        volume: formData.volume != null ? Number(formData.volume) : undefined,
        weight: formData.weight != null ? Number(formData.weight) : undefined,
        canBeExpensed: formData.canBeExpensed != null ? Boolean(formData.canBeExpensed) : undefined,
        availableInPos: formData.availableInPos != null ? Boolean(formData.availableInPos) : undefined,
        invoicingPolicy: formData.invoicingPolicy ? String(formData.invoicingPolicy) : undefined,
        expensePolicy: formData.expensePolicy ? String(formData.expensePolicy) : undefined,
        priority: formData.priority ? String(formData.priority) : undefined,
        isPublished: formData.isPublished != null ? Boolean(formData.isPublished) : undefined,
        descriptionPurchase: formData.descriptionPurchase ? String(formData.descriptionPurchase) : undefined,
        descriptionSale: formData.descriptionSale ? String(formData.descriptionSale) : undefined,
        serviceType: formData.serviceType ? String(formData.serviceType) : undefined,
        serviceTracking: formData.serviceTracking ? String(formData.serviceTracking) : undefined,
        image1920Url: formData.image1920Url ? String(formData.image1920Url) : undefined,
        image128Url: formData.image128Url ? String(formData.image128Url) : undefined,
        color: formData.color ? String(formData.color) : undefined,
        responsibleId: undefined,
        pricelistId: formData.pricelistId != null ? Number(formData.pricelistId) : undefined,
        descriptionPicking: formData.descriptionPicking ? String(formData.descriptionPicking) : undefined,
        descriptionPickingout: formData.descriptionPickingout ? String(formData.descriptionPickingout) : undefined,
        descriptionPickingin: formData.descriptionPickingin ? String(formData.descriptionPickingin) : undefined,
        locationId: formData.locationId != null ? Number(formData.locationId) : undefined,
        warehouseId: formData.warehouseId != null ? Number(formData.warehouseId) : undefined,
        tracking: formData.tracking ? String(formData.tracking) : undefined,
        hasConfigurableAttributes: formData.hasConfigurableAttributes != null ? Boolean(formData.hasConfigurableAttributes) : undefined,
        taxesId: formData.taxesId != null ? (formData.taxesId as number[]).map((id) => Number(id)) : undefined,
        supplierTaxesId: formData.supplierTaxesId != null ? (formData.supplierTaxesId as number[]).map((id) => Number(id)) : undefined,
        routeIds: formData.routeIds != null ? (formData.routeIds as number[]).map((id) => Number(id)) : undefined,
        routeFromCategIds: formData.routeFromCategIds != null ? (formData.routeFromCategIds as number[]).map((id) => Number(id)) : undefined,
        propertyAccountIncomeId: formData.propertyAccountIncomeId != null ? Number(formData.propertyAccountIncomeId) : undefined,
        propertyAccountExpenseId: formData.propertyAccountExpenseId != null ? Number(formData.propertyAccountExpenseId) : undefined,
        variantAttributeIds: formData.variantAttributeIds != null ? (formData.variantAttributeIds as number[]).map((id) => Number(id)) : undefined,
        attributeLineIds: formData.attributeLineIds != null ? (formData.attributeLineIds as number[]).map((id) => Number(id)) : undefined,
        metadata: undefined,
      } as never)
    }
    else if (action === "createTransfer" || action === "createStockPicking") {
      const pickingRaw = formData.pickingTypeId
      const locFrom = formData.locationId
      const locTo = formData.locationDestId
      if (
        pickingRaw === "" ||
        pickingRaw == null ||
        locFrom === "" ||
        locFrom == null ||
        locTo === "" ||
        locTo == null
      ) {
        return
      }
      createStockPicking.mutate({
        name: String(formData.name ?? formData.origin ?? "New Transfer"),
        pickingTypeId: Number(pickingRaw),
        locationId: Number(locFrom),
        locationDestId: Number(locTo),
        moveType: String(formData.moveType ?? "direct"),
        priority: String(formData.priority ?? "0"),
        partnerId: formData.partnerId != null ? Number(formData.partnerId) : undefined,
        contactId: formData.contactId != null ? Number(formData.contactId) : undefined,
        scheduledDate: formData.scheduledDate ? new Date(String(formData.scheduledDate)) : undefined,
        origin: formData.origin ? String(formData.origin) : undefined,
        note: formData.note ? String(formData.note) : undefined,
        userId: undefined,
        saleId: formData.saleId != null ? Number(formData.saleId) : undefined,
        purchaseId: formData.purchaseId != null ? Number(formData.purchaseId) : undefined,
        groupId: formData.groupId != null ? Number(formData.groupId) : undefined,
        isLocked: false,
        immediateTransfer: false,
        isPrinted: false,
        isReturn: false,
        hasScrapMove: false,
        hasTracking: false,
        date: undefined,
        dateDone: undefined,
        backorderId: undefined,
        backorderIds: [],
        showOperations: true,
        showLotsText: false,
        showReserved: true,
        showCheckAvailability: true,
        showValidate: true,
        showMarkAsTodo: false,
        showSetQtyButton: false,
        showClearQtyButton: false,
        showLotsM2O: false,
        productId: formData.productId != null ? Number(formData.productId) : undefined,
        lotId: formData.lotId != null ? Number(formData.lotId) : undefined,
        packageId: formData.packageId != null ? Number(formData.packageId) : undefined,
        resultPackageId: formData.resultPackageId != null ? Number(formData.resultPackageId) : undefined,
        ownerId: formData.ownerId != null ? Number(formData.ownerId) : undefined,
        displayLotId: formData.displayLotId != null ? Number(formData.displayLotId) : undefined,
        locationIdName: undefined,
        locationDestIdName: undefined,
        pickingCode: formData.pickingCode ? String(formData.pickingCode) : undefined,
        productTracking: formData.productTracking ? String(formData.productTracking) : undefined,
        productBarcode: formData.productBarcode ? String(formData.productBarcode) : undefined,
        moveLineExist: false,
        hasPackages: false,
        hasMoveLines: false,
        hasPackage: false,
        hasLot: false,
        hasOwner: false,
        hasEntirePackageSrc: false,
        hasEntirePackageDest: false,
        packageLevelIds: [],
        batchId: formData.batchId != null ? Number(formData.batchId) : undefined,
        metadata: undefined,
      } as never)
    }
    else if (action === "createAdjustment" || action === "createInventoryAdjustment") {
      const productRaw = formData.productId
      const locRaw = formData.locationId
      if (productRaw === "" || productRaw == null || locRaw === "" || locRaw == null) return
      const productRow = products.find((p) => String(p.id) === String(productRaw))
      const uomFromProduct =
        productRow?.uomId != null
          ? Number(productRow.uomId)
          : productRow?.uomPoId != null
            ? Number(productRow.uomPoId)
            : undefined
      if (uomFromProduct == null || Number.isNaN(uomFromProduct)) return
      createInventoryAdjustment.mutate({
        name: String(formData.name ?? "Inventory Adjustment"),
        productId: Number(productRaw),
        locationId: Number(locRaw),
        productUomId: uomFromProduct,
        inventoryQuantity: Number(formData.inventoryQuantity ?? 0),
        countQty: Number(formData.countQty ?? formData.inventoryQuantity ?? 0),
        differenceQty: Number(formData.differenceQty ?? 0),
        standardPrice: Number(formData.standardPrice ?? 0),
        date: formData.date ? new Date(String(formData.date)) : new Date(),
        reasonNotes: formData.reasonNotes ? String(formData.reasonNotes) : undefined,
        metadata: JSON.stringify({
          source: "inventory-ui",
          originalForm: formData,
        }),
      } as never)
    } else if (action === "createStockLocation") {
      const name = String(formData.name ?? "").trim()
      if (!name) return
      const usage = String(formData.usage ?? "internal")
      const parentRaw = formData.parentLocationId
      const parentId =
        parentRaw !== "" && parentRaw != null && String(parentRaw).trim() !== ""
          ? Number(parentRaw)
          : undefined
      createStockLocation.mutate({
        name,
        usage,
        locationCategory: usage,
        parentPath: parentId ? "" : "/",
        childLeft: 0,
        childRight: 1,
        scrapLocation: false,
        returnLocation: false,
        active: true,
        posx: 0,
        posy: 0,
        posz: 0,
        cyclicInventoryFrequency: 0,
        locationId: parentId,
        completeName: undefined,
        valuationInAccountId: undefined,
        valuationOutAccountId: undefined,
        comment: undefined,
        barcode: formData.barcode ? String(formData.barcode) : undefined,
        lastInventoryDate: undefined,
        nextInventoryDate: undefined,
        metadata: undefined,
      } as never)
    } else if (action === "createWarehouse") {
      const tid = formData.templateWarehouseId
      if (tid === "" || tid == null) return
      const template = warehouses.find((w) => String(w.id) === String(tid)) as
        | Record<string, unknown>
        | undefined
      if (!template) return
      const name = String(formData.name ?? "").trim()
      const code = String(formData.code ?? "").trim()
      const active = formData.active == null ? true : Boolean(formData.active)
      const sequence = Number(formData.sequence ?? 0)
      let params: Record<string, unknown>
      try {
        params = buildCreateWarehouseParamsFromTemplate(template, { name, code, active, sequence })
      } catch {
        return
      }
      createWarehouse.mutate(params)
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
        config={quickActionForm?.form ?? productFormConfig}
        onSubmit={(formData) => {
          if (quickActionForm) {
            handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
      <FormModal
        key={editProductRow ? `edit-product-${String(editProductRow.id)}` : "edit-product-closed"}
        open={editProductRow !== null}
        onOpenChange={(open) => !open && setEditProductRow(null)}
        config={editProductModalConfig}
        onSubmit={async (fd) => {
          if (!editProductRow) return
          const id = editProductRow.id as ScalarId
          await updateProduct.mutateAsync({
            productId: id,
            params: {
              name: fd.name != null && String(fd.name).trim() !== "" ? String(fd.name) : undefined,
              standardPrice:
                fd.standardPrice != null && fd.standardPrice !== ""
                  ? Number(fd.standardPrice)
                  : undefined,
              listPrice:
                fd.listPrice != null && fd.listPrice !== "" ? Number(fd.listPrice) : undefined,
              description:
                fd.description != null && String(fd.description).trim() !== ""
                  ? String(fd.description)
                  : undefined,
              saleOk: fd.saleOk != null ? Boolean(fd.saleOk) : undefined,
              purchaseOk: fd.purchaseOk != null ? Boolean(fd.purchaseOk) : undefined,
              active: fd.active != null ? Boolean(fd.active) : undefined,
              isPublished: fd.isPublished != null ? Boolean(fd.isPublished) : undefined,
            },
          })
        }}
      />
      <FormModal
        key={variantProductId != null ? `variant-${String(variantProductId)}` : "variant-closed"}
        open={variantProductId !== null}
        onOpenChange={(open) => !open && setVariantProductId(null)}
        config={newProductVariantForm(t)}
        onSubmit={async (fd) => {
          if (variantProductId == null) return
          await createProductVariant.mutateAsync({
            productTmplId: variantProductId,
            params: {
              name: String(fd.name ?? "").trim(),
              attributeValueIds: [],
              standardPrice: Number(fd.standardPrice ?? 0),
              lstPrice: Number(fd.lstPrice ?? fd.standardPrice ?? 0),
              defaultCode: fd.defaultCode ? String(fd.defaultCode) : undefined,
              barcode: fd.barcode ? String(fd.barcode) : undefined,
            },
          })
        }}
      />
      <FormModal
        key={editWarehouseRow ? `edit-wh-${String(editWarehouseRow.id)}` : "edit-wh-closed"}
        open={editWarehouseRow !== null}
        onOpenChange={(open) => !open && setEditWarehouseRow(null)}
        config={editWarehouseModalConfig}
        onSubmit={async (fd) => {
          if (!editWarehouseRow) return
          const id = editWarehouseRow.id as ScalarId
          await updateWarehouse.mutateAsync({
            warehouseId: id,
            params: {
              name: fd.name != null && String(fd.name).trim() !== "" ? String(fd.name) : undefined,
              code: fd.code != null && String(fd.code).trim() !== "" ? String(fd.code) : undefined,
              active: fd.active != null ? Boolean(fd.active) : undefined,
              receptionSteps:
                fd.receptionSteps != null && String(fd.receptionSteps).trim() !== ""
                  ? String(fd.receptionSteps)
                  : undefined,
              deliverySteps:
                fd.deliverySteps != null && String(fd.deliverySteps).trim() !== ""
                  ? String(fd.deliverySteps)
                  : undefined,
              manufactureSteps:
                fd.manufactureSteps != null && String(fd.manufactureSteps).trim() !== ""
                  ? String(fd.manufactureSteps)
                  : undefined,
              buyToResupply: fd.buyToResupply != null ? Boolean(fd.buyToResupply) : undefined,
              manufactureToResupply:
                fd.manufactureToResupply != null ? Boolean(fd.manufactureToResupply) : undefined,
              crossdock: fd.crossdock != null ? Boolean(fd.crossdock) : undefined,
              sequence:
                fd.sequence != null && fd.sequence !== "" ? Number(fd.sequence) : undefined,
              metadata:
                fd.metadata != null && String(fd.metadata).trim() !== ""
                  ? String(fd.metadata)
                  : undefined,
            },
          })
        }}
      />
      <FormModal
        key={assignPickingId != null ? `assign-${String(assignPickingId)}` : "assign-closed"}
        open={assignPickingId !== null}
        onOpenChange={(open) => !open && setAssignPickingId(null)}
        config={assignUserFormConfig}
        onSubmit={async (fd) => {
          if (assignPickingId == null) return
          const raw = fd.userIdentity
          const hex =
            raw != null && String(raw).trim() !== "" ? String(raw).trim() : null
          await assignUserToPicking.mutateAsync({ pickingId: assignPickingId, userIdentityHex: hex })
        }}
      />
    </>
  )
}

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
  newQualityCheckForm,
  newQualityAlertForm,
  newQualityPointForm,
  newQualityTeamForm,
  newBarcodeRuleForm,
  newReplenishmentRuleForm,
  newPickingWaveForm,
  newProductCategoryForm,
  newStockQuantForm,
  newWarehouse3dZoneForm,
  newProductSupplierLineForm,
  newProductPackagingForm,
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
  useStockProductionSerials,
  useDoneStockMove,
  useCancelStockMove,
  useInventoryValuations,
  useReplenishmentRules,
  useBarcodeRules,
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
  useOrgUsers,
  // Quality management
  useCreateQualityCheck,
  usePassQualityCheck,
  useFailQualityCheck,
  useDeleteQualityCheck,
  useCreateQualityAlert,
  useAssignQualityAlert,
  useCancelQualityAlert,
  useDeleteQualityAlert,
  useCreateQualityPoint,
  useDeleteQualityPoint,
  useCreateQualityTeam,
  useDeleteQualityTeam,
  // Barcode management
  useCreateBarcodeRule,
  useUpdateBarcodeRule,
  useDeleteBarcodeRule,
  useRecordBarcodeScan,
  // Replenishment
  useCreateReplenishmentRule,
  useUpdateReplenishmentRule,
  useDeleteReplenishmentRule,
  useTriggerReplenishment,
  // Picking waves
  useCreatePickingWave,
  useUpdatePickingWave,
  useDeletePickingWave,
  useConfirmPickingWave,
  useProcessPickingWave,
  useCompletePickingWave,
  // Product category
  useCreateProductCategory,
  useUpdateProductCategory,
  useDeleteProductCategory,
  // Stock routes and rules
  useCreateStockRoute,
  useUpdateStockRoute,
  useDeleteStockRoute,
  useCreateStockRule,
  useUpdateStockRule,
  useDeleteStockRule,
  // Warehouse tasks
  useCreateWarehouseTask,
  useUpdateWarehouseTask,
  useDeleteWarehouseTask,
  useStartWarehouseTask,
  useCompleteWarehouseTask,
  useCancelWarehouseTask,
  useStartQualityCheck,
  useOpenQualityAlert,
  useSolveQualityAlert,
  useCreateQualityAlertReason,
  useUpdateQualityAlertReason,
  useDeleteQualityAlertReason,
  useAddMemberToQualityTeam,
  useRemoveMemberFromQualityTeam,
  useExecuteReplenishmentRule,
  useCreateStockQuant,
  useUpdateStockQuantQuantity,
  useUpdateStockProductionLot,
  useDeleteStockProductionLot,
  useUpdateStockProductionSerial,
  useDeleteStockProductionSerial,
  useCreateWarehouse3dZone,
  useUpdateWarehouse3dZone,
  useDeleteWarehouse3dZone,
  useUpdateWarehouseTaskStatus,
  useLinkDeviceToQualityCheck,
  useCreateProductSupplierInfo,
  useUpdateProductSupplierInfo,
  useCreateProductPackaging,
  useUpdateProductPackaging,
  useRestoreProductCategory,
  useUpsertWarehouseGeo,
} from "@/hooks/inventory"
import { usePricelists } from "@/hooks/sales"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"

type ScalarId = bigint | number | string

/** SpacetimeDB sum-type encoding for `ZoneDisplayType` (warehouse 3D zones). */
function zoneDisplayTypeForReducer(tag: string): Record<string, unknown> {
  const t = String(tag || "Rack")
  if (t === "Floor") return { Floor: [] }
  if (t === "Bin") return { Bin: [] }
  return { Rack: [] }
}

import {
  pricelistRowsToSelectOptions,
  pickingTypeOptionsFromTransfers,
  locationOptionsFromQuantsAndTransfers,
  productRowsToSelectOptions,
  productCategoryRowsToSelectOptions,
  uomRowsToSelectOptions,
} from "@/lib/form-lookup"
import {
  CheckCircle, ListChecks, Pencil, Plus, Trash2, UserCircle2, UserPlus, XCircle,
  ShieldCheck, AlertTriangle, ScanLine, RefreshCw, PackageOpen, FolderTree, Route, ClipboardList,
} from "lucide-react"
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
  initialStockProductionSerials?: Record<string, unknown>[]
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
  initialStockProductionSerials,
  organizationId,
}: InventoryClientLoadedProps) {
  const { t } = useTranslation()
  const { orgId, companyId } = orgBigInts(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const [editProductRow, setEditProductRow] = useState<Record<string, unknown> | null>(null)
  const [variantProductId, setVariantProductId] = useState<ScalarId | null>(null)
  const [editWarehouseRow, setEditWarehouseRow] = useState<Record<string, unknown> | null>(null)
  const [assignPickingId, setAssignPickingId] = useState<ScalarId | null>(null)
  const [editQualityCheckId, setEditQualityCheckId] = useState<ScalarId | null>(null)
  const [editQualityAlertId, setEditQualityAlertId] = useState<ScalarId | null>(null)
  const [editReplenishmentRuleId, setEditReplenishmentRuleId] = useState<ScalarId | null>(null)
  const [editPickingWaveId, setEditPickingWaveId] = useState<ScalarId | null>(null)
  const [editProductCategoryId, setEditProductCategoryId] = useState<ScalarId | null>(null)
  const [editStockRouteId, setEditStockRouteId] = useState<ScalarId | null>(null)
  const [editStockRuleId, setEditStockRuleId] = useState<ScalarId | null>(null)
  const [supplierLineProductId, setSupplierLineProductId] = useState<ScalarId | null>(null)
  const [packagingProductId, setPackagingProductId] = useState<ScalarId | null>(null)

  const { data: products = [] } = useProducts(orgId, initialProducts)
  const { data: productCategories = [] } = useProductCategories(orgId, initialProductCategories)
  const { data: uoms = [] } = useUoms(orgId, initialUoms)
  const { data: stockQuants = [] } = useStockQuants(orgId, initialStockQuants)
  const { data: transfers = [] } = useStockPickings(orgId, initialTransfers)
  const { data: warehouses = [] } = useWarehouses(orgId, initialWarehouses)
  const { data: adjustments = [] } = useInventoryAdjustments(orgId, initialAdjustments)
  const { data: locations = [] } = useStockLocations(orgId, initialStockLocations)
  const { data: lots = [] } = useProductionLots(orgId)
  const { data: serials = [] } = useStockProductionSerials(orgId, initialStockProductionSerials)
  const { data: qualityChecks = [] } = useQualityChecks(orgId)
  const { data: cycleCounts = [] } = useStockCycleCounts(orgId, initialStockCycleCounts)
  const { data: pickingWaves = [] } = usePickingWaves(orgId)
  const { data: warehouseTasks = [] } = useWarehouseTasks(orgId)
  const { data: stockRoutes = [] } = useStockRoutes(orgId)
  const { data: stockRules = [] } = useStockRules(orgId)
  const { data: stockMoves = [] } = useStockMoves(orgId, initialStockMoves)
  const { data: inventoryValuations = [] } = useInventoryValuations(orgId, initialInventoryValuations)
  const { data: replenishmentRulesList = [] } = useReplenishmentRules(orgId, initialReplenishmentRules)
  const { data: barcodeRules = [] } = useBarcodeRules(orgId)
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

  // Quality management hooks
  const createQualityCheck = useCreateQualityCheck(orgId, companyId)
  const passQualityCheck = usePassQualityCheck(orgId, companyId)
  const failQualityCheck = useFailQualityCheck(orgId, companyId)
  const deleteQualityCheck = useDeleteQualityCheck(orgId, companyId)
  const createQualityAlert = useCreateQualityAlert(orgId, companyId)
  const assignQualityAlert = useAssignQualityAlert(orgId, companyId)
  const cancelQualityAlert = useCancelQualityAlert(orgId, companyId)
  const deleteQualityAlert = useDeleteQualityAlert(orgId, companyId)
  const createQualityPoint = useCreateQualityPoint(orgId, companyId)
  const deleteQualityPoint = useDeleteQualityPoint(orgId, companyId)
  const createQualityTeam = useCreateQualityTeam(orgId, companyId)
  const deleteQualityTeam = useDeleteQualityTeam(orgId, companyId)

  // Barcode hooks
  const createBarcodeRule = useCreateBarcodeRule(orgId, companyId)
  const updateBarcodeRule = useUpdateBarcodeRule(orgId, companyId)
  const deleteBarcodeRule = useDeleteBarcodeRule(orgId, companyId)
  const recordBarcodeScan = useRecordBarcodeScan(orgId, companyId)

  // Replenishment hooks
  const createReplenishmentRule = useCreateReplenishmentRule(orgId, companyId)
  const updateReplenishmentRule = useUpdateReplenishmentRule(orgId, companyId)
  const deleteReplenishmentRule = useDeleteReplenishmentRule(orgId, companyId)
  const triggerReplenishment = useTriggerReplenishment(orgId, companyId)

  // Picking wave hooks
  const createPickingWave = useCreatePickingWave(orgId, companyId)
  const updatePickingWave = useUpdatePickingWave(orgId, companyId)
  const deletePickingWave = useDeletePickingWave(orgId, companyId)
  const confirmPickingWave = useConfirmPickingWave(orgId, companyId)
  const processPickingWave = useProcessPickingWave(orgId, companyId)
  const completePickingWave = useCompletePickingWave(orgId, companyId)

  // Product category hooks
  const createProductCategory = useCreateProductCategory(orgId, companyId)
  const updateProductCategory = useUpdateProductCategory(orgId, companyId)
  const deleteProductCategory = useDeleteProductCategory(orgId, companyId)

  // Stock routes and rules hooks
  const createStockRoute = useCreateStockRoute(orgId, companyId)
  const updateStockRoute = useUpdateStockRoute(orgId, companyId)
  const deleteStockRoute = useDeleteStockRoute(orgId, companyId)
  const createStockRule = useCreateStockRule(orgId, companyId)
  const updateStockRule = useUpdateStockRule(orgId, companyId)
  const deleteStockRule = useDeleteStockRule(orgId, companyId)

  // Warehouse task hooks
  const createWarehouseTask = useCreateWarehouseTask(orgId, companyId)
  const updateWarehouseTask = useUpdateWarehouseTask(orgId, companyId)
  const deleteWarehouseTask = useDeleteWarehouseTask(orgId, companyId)
  const startWarehouseTask = useStartWarehouseTask(orgId, companyId)
  const completeWarehouseTask = useCompleteWarehouseTask(orgId, companyId)
  const cancelWarehouseTask = useCancelWarehouseTask(orgId, companyId)

  const startQualityCheck = useStartQualityCheck(orgId)
  const openQualityAlert = useOpenQualityAlert(orgId)
  const solveQualityAlert = useSolveQualityAlert(orgId)
  const createQualityAlertReason = useCreateQualityAlertReason(orgId)
  const updateQualityAlertReason = useUpdateQualityAlertReason(orgId)
  const deleteQualityAlertReason = useDeleteQualityAlertReason(orgId)
  const addMemberToQualityTeam = useAddMemberToQualityTeam(orgId)
  const removeMemberFromQualityTeam = useRemoveMemberFromQualityTeam(orgId)
  const executeReplenishmentRule = useExecuteReplenishmentRule(orgId)
  const createStockQuant = useCreateStockQuant(orgId)
  const updateStockQuantQuantity = useUpdateStockQuantQuantity(orgId)
  const updateStockProductionLot = useUpdateStockProductionLot(orgId)
  const deleteStockProductionLot = useDeleteStockProductionLot(orgId)
  const updateStockProductionSerial = useUpdateStockProductionSerial(orgId)
  const deleteStockProductionSerial = useDeleteStockProductionSerial(orgId)
  const createWarehouse3dZone = useCreateWarehouse3dZone(orgId)
  const updateWarehouse3dZone = useUpdateWarehouse3dZone(orgId)
  const deleteWarehouse3dZone = useDeleteWarehouse3dZone(orgId)
  const updateWarehouseTaskStatus = useUpdateWarehouseTaskStatus(orgId)
  const linkDeviceToQualityCheck = useLinkDeviceToQualityCheck(orgId)
  const createProductSupplierInfo = useCreateProductSupplierInfo(orgId)
  const updateProductSupplierInfo = useUpdateProductSupplierInfo(orgId)
  const createProductPackaging = useCreateProductPackaging(orgId)
  const updateProductPackaging = useUpdateProductPackaging(orgId)
  const restoreProductCategory = useRestoreProductCategory(orgId)
  const upsertWarehouseGeo = useUpsertWarehouseGeo(orgId)

  const stockOnHandLocationOptions = useMemo(() => {
    const opts = locations.map((loc) => ({
      value: String(loc.id),
      label: String(loc.completeName ?? loc.name ?? loc.id),
    }))
    return opts.length > 0
      ? opts
      : [{ value: "", label: t("common.lookup.noStockMoves"), disabled: true }]
  }, [locations, t])

  const stockQuantFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newStockQuantForm(t), {
        productId: productRowsToSelectOptions(products),
        locationId: stockOnHandLocationOptions,
      }),
    [t, products, stockOnHandLocationOptions],
  )

  const warehouse3dZoneFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newWarehouse3dZoneForm(t), {
        warehouseId: warehouses.map((w) => ({ value: String(w.id), label: String(w.name ?? w.id) })),
        locationId: stockOnHandLocationOptions,
      }),
    [t, warehouses, stockOnHandLocationOptions],
  )

  const currencyIdFromPricelistsOptions = useMemo(() => {
    const seen = new Set<number>()
    const opts: { value: string; label: string }[] = []
    for (const p of pricelists) {
      const cid = p.currencyId
      if (cid == null) continue
      const n = Number(cid)
      if (seen.has(n)) continue
      seen.add(n)
      opts.push({
        value: String(n),
        label: `${String(p.name ?? "Pricelist")} (${n})`,
      })
    }
    return opts.length > 0
      ? opts
      : [{ value: "", label: t("common.lookup.noPricelists"), disabled: true }]
  }, [pricelists, t])

  const productSupplierLineFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newProductSupplierLineForm(t), {
        currencyId: currencyIdFromPricelistsOptions,
      }),
    [t, currencyIdFromPricelistsOptions],
  )

  const productPackagingFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newProductPackagingForm(t), {
        uomId: uomFieldOptions,
      }),
    [t, uomFieldOptions],
  )

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
        <div className="flex flex-col gap-2 h-[calc(100vh-12rem)]">
          <div className="flex flex-wrap gap-2 shrink-0 items-center">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                setQuickActionForm({ form: warehouse3dZoneFormConfig, action: "createWarehouse3dZone" })
              }
            >
              {t("inventory.z3dActions.addZone")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (typeof window === "undefined") return
                const zid = window.prompt(t("inventory.z3dActions.zoneIdPrompt"))
                if (zid == null || zid.trim() === "") return
                const zoneId = Number(zid)
                if (!Number.isFinite(zoneId)) return
                const color = window.prompt("Color hex (optional, leave empty to skip)")
                void updateWarehouse3dZone.mutateAsync({
                  zoneId,
                  params:
                    color != null && color.trim() !== ""
                      ? { color: color.trim() }
                      : {},
                })
              }}
            >
              {t("inventory.z3dActions.editZone")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => {
                if (typeof window === "undefined") return
                const zid = window.prompt(t("inventory.z3dActions.zoneIdPrompt"))
                if (zid == null || zid.trim() === "") return
                const zoneId = Number(zid)
                if (!Number.isFinite(zoneId)) return
                if (window.confirm(t("inventory.z3dActions.deleteZone") + "?")) {
                  void deleteWarehouse3dZone.mutateAsync(zoneId)
                }
              }}
            >
              {t("inventory.z3dActions.deleteZone")}
            </Button>
          </div>
          <div className="flex-1 min-h-0">
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
        </div>
      ) : null,
    }),
    [
      zones,
      slots,
      warehouseItems,
      warehouses,
      moveStockItem,
      t,
      isMounted,
      warehouse3dZoneFormConfig,
      updateWarehouse3dZone,
      deleteWarehouse3dZone,
    ]
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
                {
                  id: "add-supplier-line",
                  label: t("inventory.productActions.addSupplierLine"),
                  icon: PackageOpen,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) setSupplierLineProductId(id)
                  },
                },
                {
                  id: "add-packaging",
                  label: t("inventory.productActions.addPackaging"),
                  icon: FolderTree,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) setPackagingProductId(id)
                  },
                },
                {
                  id: "update-supplier-line",
                  label: t("inventory.productActions.updateSupplierLineById"),
                  requiresSelection: false,
                  onClick: () => {
                    if (typeof window === "undefined") return
                    const raw = window.prompt(t("inventory.productActions.supplierLineIdPrompt"))
                    if (raw == null || raw.trim() === "") return
                    const supplierInfoId = Number(raw)
                    if (!Number.isFinite(supplierInfoId)) return
                    const priceS = window.prompt("New price (empty to skip)")
                    const minS = window.prompt("New min qty (empty to skip)")
                    void updateProductSupplierInfo.mutateAsync({
                      supplierInfoId,
                      params: {
                        price:
                          priceS != null && priceS.trim() !== "" ? Number(priceS) : undefined,
                        min_qty:
                          minS != null && minS.trim() !== "" ? Number(minS) : undefined,
                      },
                    })
                  },
                },
                {
                  id: "update-packaging-row",
                  label: t("inventory.productActions.updatePackagingById"),
                  requiresSelection: false,
                  onClick: () => {
                    if (typeof window === "undefined") return
                    const raw = window.prompt(t("inventory.productActions.packagingIdPrompt"))
                    if (raw == null || raw.trim() === "") return
                    const packagingId = Number(raw)
                    if (!Number.isFinite(packagingId)) return
                    const name = window.prompt("New name (empty to skip)")
                    void updateProductPackaging.mutateAsync({
                      packagingId,
                      params: {
                        name: name != null && name.trim() !== "" ? name.trim() : undefined,
                      },
                    })
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
                {
                  id: "warehouse-geo",
                  label: t("inventory.warehouseActions.setGeo"),
                  icon: Route,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id == null || typeof window === "undefined") return
                    const latS = window.prompt(t("inventory.warehouseActions.geoLatPrompt"), "0")
                    const lngS = window.prompt(t("inventory.warehouseActions.geoLngPrompt"), "0")
                    if (latS == null || lngS == null) return
                    const latitude = Number(latS)
                    const longitude = Number(lngS)
                    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return
                    const address = window.prompt(t("inventory.warehouseActions.geoAddressPrompt"))
                    void upsertWarehouseGeo.mutateAsync({
                      warehouseId: id,
                      latitude,
                      longitude,
                      address: address && address.trim() !== "" ? address.trim() : null,
                    })
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
          createForm: stockQuantFormConfig,
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
                {
                  id: "set-quant-qty",
                  label: t("inventory.stockActions.setQuantity"),
                  icon: Pencil,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id == null || typeof window === "undefined") return
                    const q = window.prompt(t("inventory.stockActions.quantityPrompt"), "0")
                    if (q == null) return
                    const qty = Number(q)
                    if (!Number.isFinite(qty)) return
                    void updateStockQuantQuantity.mutateAsync({ quantId: id, quantity: qty })
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
      if (tab.id === "lots") {
        return {
          ...tab,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: "edit-lot-note",
                  label: t("inventory.lotActions.editNote"),
                  icon: Pencil,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id == null || typeof window === "undefined") return
                    const note = window.prompt(t("inventory.lotActions.notePrompt"))
                    if (note == null) return
                    void updateStockProductionLot.mutateAsync({
                      lotId: id,
                      params: { company_id: null, note: note.trim() !== "" ? note : null },
                    })
                  },
                },
                {
                  id: "delete-lot",
                  label: t("common.delete"),
                  icon: Trash2,
                  variant: "destructive",
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id == null || typeof window === "undefined") return
                    if (window.confirm(t("inventory.lotActions.confirmDelete"))) {
                      void deleteStockProductionLot.mutateAsync(id)
                    }
                  },
                },
              ],
            },
          },
        }
      }
      if (tab.id === "serials") {
        return {
          ...tab,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: "edit-serial-note",
                  label: t("inventory.serialActions.editNote"),
                  icon: Pencil,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id == null || typeof window === "undefined") return
                    const note = window.prompt(t("inventory.serialActions.notePrompt"))
                    if (note == null) return
                    void updateStockProductionSerial.mutateAsync({
                      serialId: id,
                      params: { company_id: null, note: note.trim() !== "" ? note : null },
                    })
                  },
                },
                {
                  id: "delete-serial",
                  label: t("common.delete"),
                  icon: Trash2,
                  variant: "destructive",
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id == null || typeof window === "undefined") return
                    if (window.confirm(t("inventory.serialActions.confirmDelete"))) {
                      void deleteStockProductionSerial.mutateAsync(id)
                    }
                  },
                },
              ],
            },
          },
        }
      }
      // Quality checks actions
      if (tab.id === "quality") {
        return {
          ...tab,
          createForm: mergeSelectOptionsForFields(newQualityCheckForm(t), {
            productId: productRowsToSelectOptions(products),
            teamId: [] as { value: string; label: string }[],
          }),
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: "pass-check",
                  label: t("inventory.qualityActions.pass"),
                  icon: ShieldCheck,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) void passQualityCheck.mutateAsync(id)
                  },
                },
                {
                  id: "fail-check",
                  label: t("inventory.qualityActions.fail"),
                  icon: AlertTriangle,
                  variant: "destructive",
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    const reason = typeof window !== "undefined" ? window.prompt(t("inventory.qualityActions.failReason")) : null
                    if (id != null) void failQualityCheck.mutateAsync({ checkId: id, reason: reason ?? undefined })
                  },
                },
                {
                  id: "start-check",
                  label: t("inventory.qualityActions.startCheck"),
                  icon: ListChecks,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) void startQualityCheck.mutateAsync(id)
                  },
                },
                {
                  id: "link-device-check",
                  label: t("inventory.qualityActions.linkDevice"),
                  icon: ScanLine,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const checkId = rows[0]?.id as ScalarId | undefined
                    if (checkId == null || typeof window === "undefined") return
                    const dev = window.prompt(t("inventory.qualityActions.deviceIdPrompt"))
                    if (dev == null || dev.trim() === "") return
                    const deviceId = Number(dev)
                    if (!Number.isFinite(deviceId)) return
                    void linkDeviceToQualityCheck.mutateAsync({ deviceId, checkId })
                  },
                },
                {
                  id: "open-alert-prompt",
                  label: t("inventory.qualityActions.openAlertById"),
                  requiresSelection: false,
                  onClick: () => {
                    if (typeof window === "undefined") return
                    const raw = window.prompt(t("inventory.qualityActions.alertIdPrompt"))
                    if (raw == null || raw.trim() === "") return
                    const alertId = Number(raw)
                    if (!Number.isFinite(alertId)) return
                    void openQualityAlert.mutateAsync(alertId)
                  },
                },
                {
                  id: "solve-alert-prompt",
                  label: t("inventory.qualityActions.solveAlertById"),
                  requiresSelection: false,
                  onClick: () => {
                    if (typeof window === "undefined") return
                    const raw = window.prompt(t("inventory.qualityActions.alertIdPrompt"))
                    if (raw == null || raw.trim() === "") return
                    const alertId = Number(raw)
                    if (!Number.isFinite(alertId)) return
                    const desc = window.prompt(t("inventory.qualityActions.solveDescriptionPrompt"))
                    void solveQualityAlert.mutateAsync({ alertId, description: desc ?? null })
                  },
                },
                {
                  id: "add-alert-reason",
                  label: t("inventory.qualityActions.addAlertReason"),
                  requiresSelection: false,
                  onClick: () => {
                    if (typeof window === "undefined") return
                    const name = window.prompt(t("inventory.qualityActions.alertReasonNamePrompt"))
                    if (name == null || name.trim() === "") return
                    const desc = window.prompt(t("inventory.qualityActions.alertReasonDescPrompt"))
                    void createQualityAlertReason.mutateAsync({
                      name: name.trim(),
                      description: desc && desc.trim() !== "" ? desc.trim() : null,
                    })
                  },
                },
                {
                  id: "update-alert-reason",
                  label: t("inventory.qualityActions.updateAlertReason"),
                  requiresSelection: false,
                  onClick: () => {
                    if (typeof window === "undefined") return
                    const rid = window.prompt(t("inventory.qualityActions.reasonIdPrompt"))
                    if (rid == null || rid.trim() === "") return
                    const reasonId = Number(rid)
                    if (!Number.isFinite(reasonId)) return
                    const name = window.prompt(t("inventory.qualityActions.newReasonNamePrompt"))
                    void updateQualityAlertReason.mutateAsync({
                      reasonId,
                      params: {
                        name: name != null && name.trim() !== "" ? name.trim() : null,
                      },
                    })
                  },
                },
                {
                  id: "delete-alert-reason",
                  label: t("inventory.qualityActions.deleteAlertReason"),
                  variant: "destructive",
                  requiresSelection: false,
                  onClick: () => {
                    if (typeof window === "undefined") return
                    const rid = window.prompt(t("inventory.qualityActions.reasonIdPrompt"))
                    if (rid == null || rid.trim() === "") return
                    const reasonId = Number(rid)
                    if (!Number.isFinite(reasonId)) return
                    if (window.confirm(t("common.delete") + "?")) {
                      void deleteQualityAlertReason.mutateAsync(reasonId)
                    }
                  },
                },
                {
                  id: "add-team-member",
                  label: t("inventory.qualityActions.addTeamMember"),
                  requiresSelection: false,
                  onClick: () => {
                    if (typeof window === "undefined") return
                    const tid = window.prompt(t("inventory.qualityActions.teamIdPrompt"))
                    if (tid == null || tid.trim() === "") return
                    const teamId = Number(tid)
                    if (!Number.isFinite(teamId)) return
                    const hex = window.prompt(t("inventory.qualityActions.memberIdentityPrompt"))
                    if (hex == null || hex.trim() === "") return
                    void addMemberToQualityTeam.mutateAsync({ teamId, memberIdentityHex: hex.trim() })
                  },
                },
                {
                  id: "remove-team-member",
                  label: t("inventory.qualityActions.removeTeamMember"),
                  variant: "destructive",
                  requiresSelection: false,
                  onClick: () => {
                    if (typeof window === "undefined") return
                    const tid = window.prompt(t("inventory.qualityActions.teamIdPrompt"))
                    if (tid == null || tid.trim() === "") return
                    const teamId = Number(tid)
                    if (!Number.isFinite(teamId)) return
                    const hex = window.prompt(t("inventory.qualityActions.memberIdentityPrompt"))
                    if (hex == null || hex.trim() === "") return
                    void removeMemberFromQualityTeam.mutateAsync({ teamId, memberIdentityHex: hex.trim() })
                  },
                },
                {
                  id: "delete-check",
                  label: t("common.delete"),
                  icon: Trash2,
                  variant: "destructive",
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null && typeof window !== "undefined" && window.confirm(t("inventory.qualityActions.confirmDeleteCheck"))) {
                      void deleteQualityCheck.mutateAsync(id)
                    }
                  },
                },
              ],
            },
          },
        }
      }
      // Replenishment rules actions
      if (tab.id === "replenishment") {
        return {
          ...tab,
          createForm: mergeSelectOptionsForFields(newReplenishmentRuleForm(t), {
            productId: productRowsToSelectOptions(products),
            locationId: locationParentOptions,
          }),
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: "trigger-replenishment",
                  label: t("inventory.replenishmentActions.trigger"),
                  icon: RefreshCw,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const row = rows[0] as Record<string, unknown> | undefined
                    const productId = row?.productId as ScalarId | undefined
                    const locationId = row?.locationId as ScalarId | undefined
                    void triggerReplenishment.mutateAsync({ productId, locationId })
                  },
                },
                {
                  id: "execute-replenishment-rule",
                  label: t("inventory.replenishmentActions.executeRule"),
                  icon: ListChecks,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id == null || typeof window === "undefined") return
                    if (
                      window.confirm(
                        `${t("inventory.replenishmentActions.executeRule")}\n${t("inventory.replenishmentActions.executeRuleHint")}`,
                      )
                    ) {
                      void executeReplenishmentRule.mutateAsync(id)
                    }
                  },
                },
                {
                  id: "delete-rule",
                  label: t("common.delete"),
                  icon: Trash2,
                  variant: "destructive",
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null && typeof window !== "undefined" && window.confirm(t("inventory.replenishmentActions.confirmDelete"))) {
                      void deleteReplenishmentRule.mutateAsync(id)
                    }
                  },
                },
              ],
            },
          },
        }
      }
      // Picking waves actions
      if (tab.id === "picking-waves") {
        return {
          ...tab,
          createForm: mergeSelectOptionsForFields(newPickingWaveForm(t), {
            warehouseId: warehouses.map((w) => ({ value: String(w.id), label: String(w.name ?? w.id) })),
          }),
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: "confirm-wave",
                  label: t("inventory.pickingWaveActions.confirm"),
                  icon: CheckCircle,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) void confirmPickingWave.mutateAsync(id)
                  },
                },
                {
                  id: "process-wave",
                  label: t("inventory.pickingWaveActions.process"),
                  icon: PackageOpen,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) void processPickingWave.mutateAsync(id)
                  },
                },
                {
                  id: "complete-wave",
                  label: t("inventory.pickingWaveActions.complete"),
                  icon: ListChecks,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) void completePickingWave.mutateAsync(id)
                  },
                },
                {
                  id: "delete-wave",
                  label: t("common.delete"),
                  icon: Trash2,
                  variant: "destructive",
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null && typeof window !== "undefined" && window.confirm(t("inventory.pickingWaveActions.confirmDelete"))) {
                      void deletePickingWave.mutateAsync(id)
                    }
                  },
                },
              ],
            },
          },
        }
      }
      // Product categories actions
      if (tab.id === "product-categories") {
        return {
          ...tab,
          createForm: mergeSelectOptionsForFields(newProductCategoryForm(t), {
            parentId: productCategoryRowsToSelectOptions(productCategories).map((o) => ({ ...o, value: String(o.value) })),
          }),
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: "delete-category",
                  label: t("common.delete"),
                  icon: Trash2,
                  variant: "destructive",
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null && typeof window !== "undefined" && window.confirm(t("inventory.categoryActions.confirmDelete"))) {
                      void deleteProductCategory.mutateAsync(id)
                    }
                  },
                },
                {
                  id: "restore-category",
                  label: t("inventory.categoryActions.restoreById"),
                  requiresSelection: false,
                  onClick: () => {
                    if (typeof window === "undefined") return
                    const raw = window.prompt(t("inventory.categoryActions.categoryIdPrompt"))
                    if (raw == null || raw.trim() === "") return
                    const categoryId = Number(raw)
                    if (!Number.isFinite(categoryId)) return
                    void restoreProductCategory.mutateAsync(categoryId)
                  },
                },
              ],
            },
          },
        }
      }
      // Stock routes actions
      if (tab.id === "routes") {
        return {
          ...tab,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: "delete-route",
                  label: t("common.delete"),
                  icon: Trash2,
                  variant: "destructive",
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null && typeof window !== "undefined" && window.confirm(t("inventory.routeActions.confirmDelete"))) {
                      void deleteStockRoute.mutateAsync(id)
                    }
                  },
                },
              ],
            },
          },
        }
      }
      // Stock rules actions
      if (tab.id === "rules") {
        return {
          ...tab,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: "delete-rule",
                  label: t("common.delete"),
                  icon: Trash2,
                  variant: "destructive",
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null && typeof window !== "undefined" && window.confirm(t("inventory.ruleActions.confirmDelete"))) {
                      void deleteStockRule.mutateAsync(id)
                    }
                  },
                },
              ],
            },
          },
        }
      }
      // Barcode rules actions
      if (tab.id === "barcode-rules") {
        return {
          ...tab,
          createForm: newBarcodeRuleForm(t),
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: "delete-barcode-rule",
                  label: t("common.delete"),
                  icon: Trash2,
                  variant: "destructive",
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null && typeof window !== "undefined" && window.confirm(t("inventory.barcodeActions.confirmDelete"))) {
                      void deleteBarcodeRule.mutateAsync(id)
                    }
                  },
                },
              ],
            },
          },
        }
      }
      // Warehouse tasks actions
      if (tab.id === "warehouse-tasks") {
        return {
          ...tab,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: "start-task",
                  label: t("inventory.taskActions.start"),
                  icon: CheckCircle,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) void startWarehouseTask.mutateAsync(id)
                  },
                },
                {
                  id: "complete-task",
                  label: t("inventory.taskActions.complete"),
                  icon: ListChecks,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) void completeWarehouseTask.mutateAsync({ taskId: id, result: {} })
                  },
                },
                {
                  id: "cancel-task",
                  label: t("inventory.taskActions.cancel"),
                  icon: XCircle,
                  variant: "destructive",
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) void cancelWarehouseTask.mutateAsync(id)
                  },
                },
                {
                  id: "delete-task",
                  label: t("common.delete"),
                  icon: Trash2,
                  variant: "destructive",
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null && typeof window !== "undefined" && window.confirm(t("inventory.taskActions.confirmDelete"))) {
                      void deleteWarehouseTask.mutateAsync(id)
                    }
                  },
                },
                {
                  id: "set-task-status",
                  label: t("inventory.taskActions.setStatus"),
                  icon: Pencil,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id == null || typeof window === "undefined") return
                    const st = window.prompt(t("inventory.taskActions.statusPrompt"))
                    if (st == null || st.trim() === "") return
                    void updateWarehouseTaskStatus.mutateAsync({ taskId: id, newStatus: st.trim() })
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
          if (tab.id === "lots") return withTransferActions(tab)
          if (tab.id === "serials") return withTransferActions(tab)
          if (tab.id === "adjustments") return withTransferActions(tab)
          if (tab.id === "locations") return withTransferActions(tab)
          if (tab.id === "quality") return withTransferActions(tab)
          if (tab.id === "replenishment") return withTransferActions(tab)
          if (tab.id === "picking-waves") return withTransferActions(tab)
          if (tab.id === "product-categories") return withTransferActions(tab)
          if (tab.id === "routes") return withTransferActions(tab)
          if (tab.id === "rules") return withTransferActions(tab)
          if (tab.id === "barcode-rules") return withTransferActions(tab)
          if (tab.id === "warehouse-tasks") return withTransferActions(tab)
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
    // Quality management
    passQualityCheck,
    failQualityCheck,
    deleteQualityCheck,
    deleteQualityAlert,
    deleteQualityPoint,
    deleteQualityTeam,
    // Replenishment
    triggerReplenishment,
    deleteReplenishmentRule,
    // Picking waves
    confirmPickingWave,
    processPickingWave,
    completePickingWave,
    deletePickingWave,
    // Product categories
    deleteProductCategory,
    // Stock routes and rules
    deleteStockRoute,
    deleteStockRule,
    // Barcode
    deleteBarcodeRule,
    // Warehouse tasks
    startWarehouseTask,
    completeWarehouseTask,
    cancelWarehouseTask,
    deleteWarehouseTask,
    updateWarehouseTaskStatus,
    executeReplenishmentRule,
    startQualityCheck,
    openQualityAlert,
    solveQualityAlert,
    createQualityAlertReason,
    updateQualityAlertReason,
    deleteQualityAlertReason,
    addMemberToQualityTeam,
    removeMemberFromQualityTeam,
    updateStockQuantQuantity,
    updateStockProductionLot,
    deleteStockProductionLot,
    updateStockProductionSerial,
    deleteStockProductionSerial,
    linkDeviceToQualityCheck,
    upsertWarehouseGeo,
    restoreProductCategory,
    updateProductSupplierInfo,
    updateProductPackaging,
    stockQuantFormConfig,
    // Data dependencies for form configs
    products,
    warehouses,
    locations,
    productCategories,
    pricelists,
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
      serials: serials as unknown as Record<string, unknown>[],
      quality: qualityChecks as unknown as Record<string, unknown>[],
      "cycle-counts": cycleCounts as unknown as Record<string, unknown>[],
      "picking-waves": pickingWaves as unknown as Record<string, unknown>[],
      "warehouse-tasks": warehouseTasks as unknown as Record<string, unknown>[],
      routes: stockRoutes as unknown as Record<string, unknown>[],
      rules: stockRules as unknown as Record<string, unknown>[],
      "stock-moves": stockMoves as unknown as Record<string, unknown>[],
      valuations: inventoryValuations as unknown as Record<string, unknown>[],
      replenishment: replenishmentRulesList as unknown as Record<string, unknown>[],
      "barcode-rules": barcodeRules as unknown as Record<string, unknown>[],
      "product-categories": productCategories as unknown as Record<string, unknown>[],
    }),
    [
      products,
      stockQuants,
      transfers,
      warehouses,
      adjustments,
      locations,
      lots,
      serials,
      qualityChecks,
      cycleCounts,
      pickingWaves,
      warehouseTasks,
      stockRoutes,
      stockRules,
      stockMoves,
      inventoryValuations,
      replenishmentRulesList,
      barcodeRules,
      productCategories,
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
    else if (action === "createQualityCheck") {
      const productRaw = formData.productId
      if (productRaw === "" || productRaw == null) return
      createQualityCheck.mutate({
        name: String(formData.name ?? "Quality Check"),
        productId: Number(productRaw),
        pointId: formData.pointId ? Number(formData.pointId) : undefined,
        lotId: formData.lotId ? Number(formData.lotId) : undefined,
        teamId: formData.teamId ? Number(formData.teamId) : undefined,
      } as never)
    }
    else if (action === "createQualityAlert") {
      const name = String(formData.name ?? "").trim()
      if (!name) return
      createQualityAlert.mutate({
        name,
        productId: formData.productId ? Number(formData.productId) : undefined,
        pickingId: formData.pickingId ? Number(formData.pickingId) : undefined,
        description: formData.description ? String(formData.description) : undefined,
        priority: formData.priority ? Number(formData.priority) : undefined,
      } as never)
    }
    else if (action === "createReplenishmentRule") {
      const productRaw = formData.productId
      const locRaw = formData.locationId
      if (productRaw === "" || productRaw == null || locRaw === "" || locRaw == null) return
      createReplenishmentRule.mutate({
        productId: Number(productRaw),
        locationId: Number(locRaw),
        minQty: Number(formData.minQty ?? 0),
        maxQty: Number(formData.maxQty ?? 0),
        qtyToOrder: formData.qtyToOrder ? Number(formData.qtyToOrder) : undefined,
        routeId: formData.routeId ? Number(formData.routeId) : undefined,
        trigger: String(formData.trigger ?? "auto"),
      } as never)
    }
    else if (action === "createPickingWave") {
      const name = String(formData.name ?? "").trim()
      if (!name) return
      createPickingWave.mutate({
        name,
        scheduledDate: formData.scheduledDate ? new Date(String(formData.scheduledDate)) : new Date(),
        warehouseId: formData.warehouseId ? Number(formData.warehouseId) : undefined,
        userId: formData.userId ? Number(formData.userId) : undefined,
        pickingTypeId: formData.pickingTypeId ? Number(formData.pickingTypeId) : undefined,
      } as never)
    }
    else if (action === "createProductCategory") {
      const name = String(formData.name ?? "").trim()
      if (!name) return
      createProductCategory.mutate({
        name,
        parentId: formData.parentId ? Number(formData.parentId) : undefined,
        removalStrategyId: formData.removalStrategyId ? Number(formData.removalStrategyId) : undefined,
        costingMethod: String(formData.costingMethod ?? "standard"),
        propertyValuation: String(formData.propertyValuation ?? "manual_periodic"),
      } as never)
    }
    else if (action === "createBarcodeRule") {
      const name = String(formData.name ?? "").trim()
      const pattern = String(formData.pattern ?? "").trim()
      if (!name || !pattern) return
      createBarcodeRule.mutate({
        name,
        pattern,
        encoding: String(formData.encoding ?? "any"),
        type: String(formData.type ?? "product"),
        sequence: Number(formData.sequence ?? 100),
      } as never)
    } else if (action === "createStockQuant") {
      const p = formData.productId
      const l = formData.locationId
      if (p === "" || p == null || l === "" || l == null) return
      createStockQuant.mutate({
        company_id: null,
        product_id: Number(p),
        product_variant_id: null,
        location_id: Number(l),
        lot_id: null,
        package_id: null,
        owner_id: null,
        quantity: Number(formData.quantity ?? 0),
        reserved_quantity: Number(formData.reservedQuantity ?? 0),
        in_date: null,
        inventory_quantity: 0,
        inventory_diff_quantity: 0,
        inventory_quantity_set: false,
        is_outdated: false,
        user_id: null,
        inventory_date: null,
        cost: Number(formData.cost ?? 0),
        cost_method: null,
        accounting_date: null,
        currency_id: null,
        accounting_entry_ids: [],
        metadata: null,
      } as never)
    } else if (action === "createWarehouse3dZone") {
      const wid = formData.warehouseId
      const lid = formData.locationId
      if (wid === "" || wid == null || lid === "" || lid == null) return
      const dt = String(formData.displayType ?? "Rack")
      createWarehouse3dZone.mutate({
        warehouseId: wid,
        locationId: lid,
        params: {
          display_type: zoneDisplayTypeForReducer(dt),
          color: String(formData.color ?? "#0e7490"),
          width: Number(formData.width ?? 10),
          height: Number(formData.height ?? 3),
          depth: Number(formData.depth ?? 8),
          rows: Math.max(0, Math.floor(Number(formData.rows ?? 4))),
          columns: Math.max(0, Math.floor(Number(formData.columns ?? 8))),
          levels: Math.max(0, Math.floor(Number(formData.levels ?? 3))),
        },
      })
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
      <FormModal
        key={supplierLineProductId != null ? `supplier-${String(supplierLineProductId)}` : "supplier-closed"}
        open={supplierLineProductId !== null}
        onOpenChange={(open) => !open && setSupplierLineProductId(null)}
        config={productSupplierLineFormConfig}
        onSubmit={async (fd) => {
          if (supplierLineProductId == null) return
          const partnerRaw = fd.partnerId
          const curRaw = fd.currencyId
          if (partnerRaw === "" || partnerRaw == null || curRaw === "" || curRaw == null) return
          const tmplRaw = fd.productTmplId
          const tmplOpt =
            tmplRaw !== "" && tmplRaw != null && String(tmplRaw).trim() !== ""
              ? Number(tmplRaw)
              : Number(supplierLineProductId)
          await createProductSupplierInfo.mutateAsync({
            partner_id: Number(partnerRaw),
            product_tmpl_id: tmplOpt,
            product_id: null,
            min_qty: Number(fd.minQty ?? 0),
            price: Number(fd.price ?? 0),
            currency_id: Number(curRaw),
            delay: Math.floor(Number(fd.delay ?? 0)),
            sequence: Math.floor(Number(fd.sequence ?? 10)),
            product_name: null,
            product_code: null,
            date_start: null,
            date_end: null,
          } as never)
          setSupplierLineProductId(null)
        }}
      />
      <FormModal
        key={packagingProductId != null ? `pkg-${String(packagingProductId)}` : "pkg-closed"}
        open={packagingProductId !== null}
        onOpenChange={(open) => !open && setPackagingProductId(null)}
        config={productPackagingFormConfig}
        onSubmit={async (fd) => {
          if (packagingProductId == null) return
          const uomRaw = fd.uomId
          const name = String(fd.name ?? "").trim()
          if (name === "" || uomRaw === "" || uomRaw == null) return
          await createProductPackaging.mutateAsync({
            productId: packagingProductId,
            params: {
              name,
              qty: Number(fd.qty ?? 1),
              uom_id: Number(uomRaw),
              barcode: fd.barcode != null && String(fd.barcode).trim() !== "" ? String(fd.barcode) : null,
              length: Number(fd.length ?? 0),
              width: Number(fd.width ?? 0),
              height: Number(fd.height ?? 0),
              weight: Number(fd.weight ?? 0),
              max_weight: Number(fd.maxWeight ?? 0),
            },
          })
          setPackagingProductId(null)
        }}
      />
    </>
  )
}

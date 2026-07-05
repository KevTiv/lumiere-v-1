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
  newQualityPointForm,
  newQualityTeamForm,
  newQualityAlertForm,
  assignQualityAlertForm,
  solveQualityAlertForm,
  blockSerialForm,
  serialDetailForm,
  lotDetailForm,
  newTraceabilityRecordForm,
  newReplenishmentRuleForm,
  newPickingWaveForm,
  newProductCategoryForm,
  newStockQuantForm,
  newWarehouse3dZoneForm,
  newProductSupplierLineForm,
  newProductPackagingForm,
  MissingOrganization,
  mergeSelectOptionsForFields,
  csvImportForm,
  ImportAssistantWizard,
  Button,
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
  useQualityTeams,
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
  useAdjustmentReasons,
  useBarcodeNomenclatures,
  useSerialLotTraceability,
  useStockTraceabilityReports,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  useCreateProductVariant,
  useCreateStockPicking,
  useCreateInventoryAdjustment,
  useCreateStockInventory,
  useCreateStockInventoryLine,
  useUpdateStockInventoryState,
  useCreateStockLocation,
  useUpdateStockLocation,
  useCreateWarehouse,
  useUpdateWarehouse,
  useDeleteWarehouse,
  useDeleteStockLocation,
  useCreateStockMove,
  useConfirmStockMove,
  useAssignStockMove,
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
  useUpdateQualityPoint,
  useDeleteQualityPoint,
  useCreateQualityTeam,
  useUpdateQualityTeam,
  useDeleteQualityTeam,
  // Barcode management
  useCreateBarcodeRule,
  useUpdateBarcodeRule,
  useDeleteBarcodeRule,
  useRecordBarcodeScan,
  useCreateBarcodeNomenclature,
  useUpdateBarcodeNomenclature,
  useDeleteBarcodeNomenclature,
  useAddRuleToNomenclature,
  useRemoveRuleFromNomenclature,
  useCreateAdjustmentReason,
  useUseSerial,
  useBlockSerial,
  useCreateStockProductionLot,
  useCreateStockProductionSerial,
  useCreateTraceabilityRecord,
  useCreateTraceabilityReport,
  useRunTraceabilityReport,
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
  useUpdateProductVariant,
  useUpdateProductInventoryData,
  useUpdateProductPricing,
  useCreateUomCategory,
  useCreateUom,
  useCreateUomConversion,
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
  useImportUomCategoryCsv,
  useImportUomCsv,
  useImportProductCategoryCsv,
  useImportProductCsv,
  useImportProductVariantCsv,
  useImportWarehouseCsv,
  useImportStockLocationCsv,
  useImportStockQuantCsv,
  useImportLotCsv,
  useUpdateWhatsappQualityScore,
} from "@lumiere/query-hooks/hooks/inventory"
import { usePricelists } from "@lumiere/query-hooks/hooks/sales"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"

type ScalarId = bigint | number | string

type InventoryCsvImportKind =
  | "uomCategory"
  | "uom"
  | "productCategory"
  | "product"
  | "productVariant"
  | "warehouse"
  | "stockLocation"
  | "stockQuant"
  | "lot"

type ProductPriceSearchState = {
  row: Record<string, unknown>
  form: FormConfig
} | null

function skillRunToPanel(result: AiSkillRunResponse): Record<string, unknown> {
  const tableArtifact = result.artifacts.find((a) => a.kind === "table")
  return {
    summary: result.summary,
    citations: result.citations,
    artifacts: result.artifacts,
    steps: result.steps,
    run_id: result.run_id,
    ...(tableArtifact?.content && typeof tableArtifact.content === "object"
      ? { rows: (tableArtifact.content as { rows?: unknown[] }).rows ?? [] }
      : {}),
  }
}

function productPriceSearchForm(row: Record<string, unknown>): FormConfig {
  return {
    id: "ai-product-price-search",
    title: "Find prices",
    description: "Search external suppliers and compare with ERP product context.",
    submitLabel: "Search prices",
    sections: [
      {
        id: "search",
        fields: [
          {
            id: "question",
            type: "textarea",
            name: "question",
            label: "Search goal",
            defaultValue: "Find competitive supplier prices and summarize best options.",
            rows: 3,
            width: "full",
          },
          {
            id: "target-price",
            type: "number",
            name: "targetPrice",
            label: "Target price (optional)",
            width: "1/2",
          },
          {
            id: "quantity",
            type: "number",
            name: "quantity",
            label: "Quantity (optional)",
            width: "1/2",
            defaultValue: 1,
          },
        ],
      },
    ],
  }
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
  Play, Sparkles,
} from "lucide-react"
import { buildCreateWarehouseParamsFromTemplate } from "@/lib/warehouse-create-params"
import {
  pickingWaveCreateParamsFromForm,
  toCreateBarcodeRuleParamsFromForm,
  toCreateAdjustmentReasonParamsFromForm,
  toCreateInventoryAdjustmentParamsFromForm,
  toCreateProductCategoryParamsFromForm,
  toCreateProductParamsFromForm,
  toCreateStockLocationParamsFromForm,
  toCreateStockMoveParams,
  toCreateStockPickingParamsFromForm,
  toCreateStockQuantParamsFromForm,
  toCreateStockTraceabilityReportParamsFromForm,
  toCreateTraceabilityRecordParamsFromForm,
  warehouse3dZoneParamsFromForm,
} from "@/lib/inventory-ext-params"
import { withDefaultsFromRow } from "@/lib/prefill-form-config"
import { stbTimestampFromDate } from "@/lib/stb-timestamp"
import { CycleCountWizard, LocationHierarchyPanel, QualityAlertsPanel } from "./cycle-count-wizard"
import { AiResultPanel } from "@/lib/ai-result-panel"
import { useRunAiSkill, type AiSkillRunResponse } from "@lumiere/query-hooks/hooks/ai-skills"

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
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const [editProductRow, setEditProductRow] = useState<Record<string, unknown> | null>(null)
  const [variantProductId, setVariantProductId] = useState<ScalarId | null>(null)
  const [editWarehouseRow, setEditWarehouseRow] = useState<Record<string, unknown> | null>(null)
  const [assignPickingId, setAssignPickingId] = useState<ScalarId | null>(null)
  const [editQualityCheckId, setEditQualityCheckId] = useState<ScalarId | null>(null)
  const [editQualityAlertId, setEditQualityAlertId] = useState<ScalarId | null>(null)
  const [assignQualityAlertId, setAssignQualityAlertId] = useState<ScalarId | null>(null)
  const [solveQualityAlertId, setSolveQualityAlertId] = useState<ScalarId | null>(null)
  const [selectedSerialRow, setSelectedSerialRow] = useState<Record<string, unknown> | null>(null)
  const [selectedLotRow, setSelectedLotRow] = useState<Record<string, unknown> | null>(null)
  const [blockSerialId, setBlockSerialId] = useState<ScalarId | null>(null)
  const [activeTab, setActiveTab] = useState<string | undefined>(undefined)
  const [wizardCycleCountId, setWizardCycleCountId] = useState<ScalarId | "">("")
  const [stockLocationFilter, setStockLocationFilter] = useState<string | null>(null)
  const [createQualityAlertOpen, setCreateQualityAlertOpen] = useState(false)
  const [editReplenishmentRuleId, setEditReplenishmentRuleId] = useState<ScalarId | null>(null)
  const [editPickingWaveId, setEditPickingWaveId] = useState<ScalarId | null>(null)
  const [editProductCategoryId, setEditProductCategoryId] = useState<ScalarId | null>(null)
  const [editStockRouteId, setEditStockRouteId] = useState<ScalarId | null>(null)
  const [editStockRuleId, setEditStockRuleId] = useState<ScalarId | null>(null)
  const [supplierLineProductId, setSupplierLineProductId] = useState<ScalarId | null>(null)
  const [packagingProductId, setPackagingProductId] = useState<ScalarId | null>(null)
  const [csvKind, setCsvKind] = useState<InventoryCsvImportKind | null>(null)
  const [csvError, setCsvError] = useState<string | null>(null)
  const [productPriceSearch, setProductPriceSearch] = useState<ProductPriceSearchState>(null)
  const [productPriceSearchError, setProductPriceSearchError] = useState<string | null>(null)
  const [productPriceSearchResult, setProductPriceSearchResult] = useState<Record<string, unknown> | null>(null)
  const runPriceSearch = useRunAiSkill()

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
  const { data: qualityTeams = [] } = useQualityTeams(orgId)
  const { data: cycleCounts = [] } = useStockCycleCounts(orgId, initialStockCycleCounts)
  const { data: pickingWaves = [] } = usePickingWaves(orgId)
  const { data: warehouseTasks = [] } = useWarehouseTasks(orgId)
  const { data: stockRoutes = [] } = useStockRoutes(orgId)
  const { data: stockRules = [] } = useStockRules(orgId)
  const { data: stockMoves = [] } = useStockMoves(orgId, initialStockMoves)
  const { data: inventoryValuations = [] } = useInventoryValuations(orgId, initialInventoryValuations)
  const { data: replenishmentRulesList = [] } = useReplenishmentRules(orgId, initialReplenishmentRules)
  const { data: barcodeRules = [] } = useBarcodeRules(orgId)
  const { data: adjustmentReasons = [] } = useAdjustmentReasons(orgId)
  const { data: barcodeNomenclatures = [] } = useBarcodeNomenclatures(orgId)
  const { data: serialLotTraceability = [] } = useSerialLotTraceability(orgId)
  const { data: stockTraceabilityReports = [] } = useStockTraceabilityReports(orgId)
  const { data: orgUsers = [] } = useOrgUsers()
  const { data: pricelists = [] } = usePricelists(orgId, initialPricelists)
  const csvImports = {
    importUomCategory: useImportUomCategoryCsv(orgId),
    importUom: useImportUomCsv(orgId),
    importProductCategory: useImportProductCategoryCsv(orgId),
    importProduct: useImportProductCsv(orgId),
    importProductVariant: useImportProductVariantCsv(orgId),
    importWarehouse: useImportWarehouseCsv(orgId, operatingCompanyId),
    importStockLocation: useImportStockLocationCsv(orgId, operatingCompanyId),
    importStockQuant: useImportStockQuantCsv(orgId, operatingCompanyId),
    importLot: useImportLotCsv(orgId, operatingCompanyId),
  }

  useEffect(() => {
    if (csvKind) setCsvError(null)
  }, [csvKind])

  const csvFormConfig = useMemo(() => {
    if (!csvKind) return null
    const titleKey: Record<InventoryCsvImportKind, string> = {
      uomCategory: "inventory.csvImport.uomCategoriesTitle",
      uom: "inventory.csvImport.uomsTitle",
      productCategory: "inventory.csvImport.productCategoriesTitle",
      product: "inventory.csvImport.productsTitle",
      productVariant: "inventory.csvImport.variantsTitle",
      warehouse: "inventory.csvImport.warehousesTitle",
      stockLocation: "inventory.csvImport.locationsTitle",
      stockQuant: "inventory.csvImport.quantsTitle",
      lot: "inventory.csvImport.lotsTitle",
    }
    return csvImportForm(t, t(titleKey[csvKind]))
  }, [csvKind, t])

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

  const traceRecordFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newTraceabilityRecordForm(t), {
        uomId: uomFieldOptions,
      }),
    [t, uomFieldOptions],
  )

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
  const createStockPicking = useCreateStockPicking(orgId, { companyId: operatingCompanyId ?? undefined })
  const createInventoryAdjustment = useCreateInventoryAdjustment(orgId)
  const createStockInventory = useCreateStockInventory(orgId, operatingCompanyId)
  const createStockInventoryLine = useCreateStockInventoryLine(orgId, operatingCompanyId)
  const updateStockInventoryState = useUpdateStockInventoryState(orgId, operatingCompanyId)
  const createStockLocation = useCreateStockLocation(orgId)
  const updateStockLocation = useUpdateStockLocation(orgId)
  const createWarehouse = useCreateWarehouse(orgId)
  const updateWarehouse = useUpdateWarehouse(orgId)
  const deleteWarehouse = useDeleteWarehouse(orgId)
  const updateProduct = useUpdateProduct(orgId)
  const deleteProduct = useDeleteProduct(orgId)
  const createProductVariant = useCreateProductVariant(orgId)
  const deleteStockLocation = useDeleteStockLocation(orgId)
  const createStockMove = useCreateStockMove(orgId, operatingCompanyId)
  const confirmStockMove = useConfirmStockMove(orgId, operatingCompanyId)
  const assignStockMove = useAssignStockMove(orgId, operatingCompanyId)
  const doneStockMove = useDoneStockMove(orgId, operatingCompanyId)
  const cancelStockMove = useCancelStockMove(orgId, operatingCompanyId)
  const assignUserToPicking = useAssignUserToPicking(orgId, operatingCompanyId)
  const confirmPicking = useConfirmStockPicking(orgId, operatingCompanyId)
  const assignPicking = useAssignStockPicking(orgId, operatingCompanyId)
  const validatePicking = useValidateStockPicking(orgId, operatingCompanyId)
  const cancelPicking = useCancelStockPicking(orgId, operatingCompanyId)
  const processAdjustment = useProcessInventoryAdjustment(orgId)
  const reserveQuant = useReserveStockQuant(orgId, operatingCompanyId)
  const unreserveQuant = useUnreserveStockQuant(orgId, operatingCompanyId)

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

  const assignQualityAlertFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(assignQualityAlertForm(t), {
        userIdentity: assignUserFieldOptions,
      }),
    [t, assignUserFieldOptions],
  )

  const qualityTeamOptions = useMemo(
    () =>
      qualityTeams.map((team) => ({
        value: String((team as Record<string, unknown>).id ?? ""),
        label: String((team as Record<string, unknown>).name ?? (team as Record<string, unknown>).id ?? ""),
      })),
    [qualityTeams],
  )

  const qualityAlertCreateFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newQualityAlertForm(t), {
        productId: productRowsToSelectOptions(products),
        teamId: qualityTeamOptions,
        pickingId: transfers.map((tr) => ({
          value: String(tr.id ?? ""),
          label: String(tr.name ?? tr.origin ?? tr.id ?? ""),
        })),
      }),
    [t, products, qualityTeamOptions, transfers],
  )

  const serialDetailModalConfig = useMemo((): FormConfig => {
    const base = serialDetailForm(t)
    if (!selectedSerialRow) return base
    return {
      ...base,
      sections: base.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) => {
          const value =
            field.name === "isLocked"
              ? selectedSerialRow.isLocked
                ? "Yes"
                : "No"
              : selectedSerialRow[field.name] != null
                ? String(selectedSerialRow[field.name])
                : field.defaultValue != null
                  ? String(field.defaultValue)
                  : undefined
          return { ...field, defaultValue: value }
        }),
      })),
    } as FormConfig
  }, [t, selectedSerialRow])

  const lotDetailModalConfig = useMemo((): FormConfig => {
    const base = lotDetailForm(t)
    if (!selectedLotRow) return base
    return {
      ...base,
      sections: base.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) => {
          const value =
            selectedLotRow[field.name] != null
              ? String(selectedLotRow[field.name])
              : field.defaultValue != null
                ? String(field.defaultValue)
                : undefined
          return { ...field, defaultValue: value }
        }),
      })),
    } as FormConfig
  }, [t, selectedLotRow])

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
  const { zones, slots, items: warehouseItems } = useWarehouse3D(orgId, operatingCompanyId, firstWarehouseId)
  const moveStockItem = useMoveStockItem3D(orgId, operatingCompanyId)

  // Quality management hooks
  const createQualityCheck = useCreateQualityCheck(orgId, operatingCompanyId)
  const passQualityCheck = usePassQualityCheck(orgId, operatingCompanyId)
  const failQualityCheck = useFailQualityCheck(orgId, operatingCompanyId)
  const deleteQualityCheck = useDeleteQualityCheck(orgId, operatingCompanyId)
  const createQualityAlert = useCreateQualityAlert(orgId, operatingCompanyId)
  const assignQualityAlert = useAssignQualityAlert(orgId, operatingCompanyId)
  const cancelQualityAlert = useCancelQualityAlert(orgId, operatingCompanyId)
  const deleteQualityAlert = useDeleteQualityAlert(orgId, operatingCompanyId)
  const createQualityPoint = useCreateQualityPoint(orgId, operatingCompanyId)
  const updateQualityPoint = useUpdateQualityPoint(orgId, operatingCompanyId)
  const deleteQualityPoint = useDeleteQualityPoint(orgId, operatingCompanyId)
  const createQualityTeam = useCreateQualityTeam(orgId, operatingCompanyId)
  const updateQualityTeam = useUpdateQualityTeam(orgId, operatingCompanyId)
  const deleteQualityTeam = useDeleteQualityTeam(orgId, operatingCompanyId)

  // Barcode hooks
  const createBarcodeRule = useCreateBarcodeRule(orgId, operatingCompanyId)
  const updateBarcodeRule = useUpdateBarcodeRule(orgId, operatingCompanyId)
  const deleteBarcodeRule = useDeleteBarcodeRule(orgId, operatingCompanyId)
  const recordBarcodeScan = useRecordBarcodeScan(orgId, operatingCompanyId)
  const createBarcodeNomenclature = useCreateBarcodeNomenclature(orgId, operatingCompanyId)
  const updateBarcodeNomenclature = useUpdateBarcodeNomenclature(orgId, operatingCompanyId)
  const deleteBarcodeNomenclature = useDeleteBarcodeNomenclature(orgId, operatingCompanyId)
  const addRuleToNomenclature = useAddRuleToNomenclature(orgId, operatingCompanyId)
  const removeRuleFromNomenclature = useRemoveRuleFromNomenclature(orgId, operatingCompanyId)
  const createAdjustmentReason = useCreateAdjustmentReason(orgId, operatingCompanyId)
  const useSerial = useUseSerial(orgId, operatingCompanyId)
  const blockSerial = useBlockSerial(orgId, operatingCompanyId)
  const createStockProductionLot = useCreateStockProductionLot(orgId, operatingCompanyId)
  const createStockProductionSerial = useCreateStockProductionSerial(orgId, operatingCompanyId)
  const createTraceabilityRecord = useCreateTraceabilityRecord(orgId, operatingCompanyId)
  const createTraceabilityReport = useCreateTraceabilityReport(orgId, operatingCompanyId)
  const runTraceabilityReport = useRunTraceabilityReport(orgId, operatingCompanyId)

  // Replenishment hooks
  const createReplenishmentRule = useCreateReplenishmentRule(orgId, operatingCompanyId)
  const updateReplenishmentRule = useUpdateReplenishmentRule(orgId, operatingCompanyId)
  const deleteReplenishmentRule = useDeleteReplenishmentRule(orgId, operatingCompanyId)
  const triggerReplenishment = useTriggerReplenishment(orgId, operatingCompanyId)

  // Picking wave hooks
  const createPickingWave = useCreatePickingWave(orgId, operatingCompanyId)
  const updatePickingWave = useUpdatePickingWave(orgId, operatingCompanyId)
  const deletePickingWave = useDeletePickingWave(orgId, operatingCompanyId)
  const confirmPickingWave = useConfirmPickingWave(orgId, operatingCompanyId)
  const processPickingWave = useProcessPickingWave(orgId, operatingCompanyId)
  const completePickingWave = useCompletePickingWave(orgId, operatingCompanyId)

  // Product category hooks
  const createProductCategory = useCreateProductCategory(orgId, operatingCompanyId)
  const updateProductCategory = useUpdateProductCategory(orgId, operatingCompanyId)
  const deleteProductCategory = useDeleteProductCategory(orgId, operatingCompanyId)

  // Stock routes and rules hooks
  const createStockRoute = useCreateStockRoute(orgId, operatingCompanyId)
  const updateStockRoute = useUpdateStockRoute(orgId, operatingCompanyId)
  const deleteStockRoute = useDeleteStockRoute(orgId, operatingCompanyId)
  const createStockRule = useCreateStockRule(orgId, operatingCompanyId)
  const updateStockRule = useUpdateStockRule(orgId, operatingCompanyId)
  const deleteStockRule = useDeleteStockRule(orgId, operatingCompanyId)

  // Warehouse task hooks
  const createWarehouseTask = useCreateWarehouseTask(orgId, operatingCompanyId)
  const deleteWarehouseTask = useDeleteWarehouseTask(orgId, operatingCompanyId)
  const startWarehouseTask = useStartWarehouseTask(orgId, operatingCompanyId)
  const completeWarehouseTask = useCompleteWarehouseTask(orgId, operatingCompanyId)
  const cancelWarehouseTask = useCancelWarehouseTask(orgId, operatingCompanyId)

  const startQualityCheck = useStartQualityCheck(orgId)
  const openQualityAlert = useOpenQualityAlert(orgId)
  const solveQualityAlert = useSolveQualityAlert(orgId)
  const createQualityAlertReason = useCreateQualityAlertReason(orgId)
  const updateQualityAlertReason = useUpdateQualityAlertReason(orgId)
  const deleteQualityAlertReason = useDeleteQualityAlertReason(orgId)
  const addMemberToQualityTeam = useAddMemberToQualityTeam(orgId)
  const removeMemberFromQualityTeam = useRemoveMemberFromQualityTeam(orgId)
  const executeReplenishmentRule = useExecuteReplenishmentRule(orgId)
  const createStockQuant = useCreateStockQuant(orgId, { companyId: operatingCompanyId ?? undefined })
  const updateStockQuantQuantity = useUpdateStockQuantQuantity(orgId, operatingCompanyId)
  const updateStockProductionLot = useUpdateStockProductionLot(orgId)
  const deleteStockProductionLot = useDeleteStockProductionLot(orgId)
  const updateStockProductionSerial = useUpdateStockProductionSerial(orgId)
  const deleteStockProductionSerial = useDeleteStockProductionSerial(orgId)
  const updateProductVariant = useUpdateProductVariant(orgId, operatingCompanyId)
  const updateProductInventoryData = useUpdateProductInventoryData(orgId, operatingCompanyId)
  const updateProductPricing = useUpdateProductPricing(orgId, operatingCompanyId)
  const createUomCategory = useCreateUomCategory(orgId, operatingCompanyId)
  const createUom = useCreateUom(orgId, operatingCompanyId)
  const createUomConversion = useCreateUomConversion(orgId, operatingCompanyId)
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
  const updateWhatsappQualityScore = useUpdateWhatsappQualityScore(orgId)

  const promptText = (message: string, defaultValue = ""): string | null => {
    if (typeof window === "undefined") return null
    const raw = window.prompt(message, defaultValue)
    if (raw == null) return null
    const text = raw.trim()
    return text === "" ? null : text
  }

  const promptScalarId = (message: string): ScalarId | null => promptText(message)

  const promptNumber = (message: string, defaultValue = "0"): number | null => {
    const raw = promptText(message, defaultValue)
    if (raw == null) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }

  const promptOptionalNumber = (message: string): number | undefined => {
    if (typeof window === "undefined") return undefined
    const raw = window.prompt(message)
    if (raw == null || raw.trim() === "") return undefined
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  }

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
      customContent: (
        <CycleCountWizard
          organizationId={organizationId}
          locations={locations}
          cycleCounts={cycleCounts}
          products={products}
          uoms={uoms}
          initialCycleCountId={wizardCycleCountId}
        />
      ),
    }),
    [t, organizationId, locations, cycleCounts, products, uoms, wizardCycleCountId],
  )

  const locationHierarchyTab = useMemo(
    () => ({
      id: "location-tree",
      label: t("inventory.locationTree.tabLabel"),
      type: "custom" as const,
      customContent: (
        <LocationHierarchyPanel
          locations={locations}
          quants={stockQuants}
          onViewQuants={(locationId) => {
            setStockLocationFilter(locationId)
            setActiveTab("stock")
          }}
        />
      ),
    }),
    [t, locations, stockQuants],
  )

  const qualityAlertsTab = useMemo(
    () => ({
      id: "quality-alerts",
      label: t("inventory.qualityAlerts.tabLabel"),
      type: "custom" as const,
      customContent: (
        <QualityAlertsPanel
          organizationId={organizationId}
          operatingCompanyId={operatingCompanyId}
          onAssignAlert={(id) => setAssignQualityAlertId(id)}
          onSolveAlert={(id) => setSolveQualityAlertId(id)}
        />
      ),
    }),
    [organizationId, operatingCompanyId],
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
                  id: "csv-uom-category",
                  label: t("inventory.csvImport.toolbarUomCategories"),
                  onClick: () => setCsvKind("uomCategory"),
                },
                {
                  id: "csv-uom",
                  label: t("inventory.csvImport.toolbarUoms"),
                  onClick: () => setCsvKind("uom"),
                },
                {
                  id: "csv-product-category",
                  label: t("inventory.csvImport.toolbarProductCategories"),
                  onClick: () => setCsvKind("productCategory"),
                },
                {
                  id: "csv-product",
                  label: t("inventory.csvImport.toolbarProducts"),
                  onClick: () => setCsvKind("product"),
                },
                {
                  id: "csv-product-variant",
                  label: t("inventory.csvImport.toolbarVariants"),
                  onClick: () => setCsvKind("productVariant"),
                },
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
                  id: "find-prices",
                  label: "Find prices",
                  icon: Sparkles,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const first = rows[0] as Record<string, unknown> | undefined
                    if (!first?.id) return
                    setProductPriceSearchError(null)
                    setProductPriceSearch({ row: first, form: productPriceSearchForm(first) })
                  },
                },
                {
                  id: "update-product-pricing",
                  label: t("inventory.productActions.updatePricing"),
                  icon: Pencil,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const productId = rows[0]?.id as ScalarId | undefined
                    if (productId == null) return
                    const standardPrice = promptOptionalNumber(t("inventory.productActions.standardPricePrompt"))
                    const listPrice = promptOptionalNumber(t("inventory.productActions.listPricePrompt"))
                    if (standardPrice == null && listPrice == null) return
                    void updateProductPricing.mutateAsync({
                      productId,
                      params: { standard_price: standardPrice, list_price: listPrice },
                    })
                  },
                },
                {
                  id: "update-product-inventory-data",
                  label: t("inventory.productActions.updateInventoryData"),
                  icon: PackageOpen,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const productId = rows[0]?.id as ScalarId | undefined
                    if (productId == null) return
                    const qtyAvailable = promptOptionalNumber(t("inventory.productActions.qtyAvailablePrompt"))
                    const virtualAvailable = promptOptionalNumber(t("inventory.productActions.virtualAvailablePrompt"))
                    if (qtyAvailable == null && virtualAvailable == null) return
                    void updateProductInventoryData.mutateAsync({
                      productId,
                      params: { qty_available: qtyAvailable, virtual_available: virtualAvailable },
                    })
                  },
                },
                {
                  id: "update-product-variant",
                  label: t("inventory.productActions.updateVariantById"),
                  requiresSelection: false,
                  onClick: () => {
                    const variantId = promptScalarId(t("inventory.productActions.variantIdPrompt"))
                    if (variantId == null) return
                    const name = promptText(t("inventory.productActions.variantNamePrompt"))
                    const standardPrice = promptOptionalNumber(t("inventory.productActions.standardPricePrompt"))
                    if (name == null && standardPrice == null) return
                    void updateProductVariant.mutateAsync({
                      variantId,
                      params: { name: name ?? undefined, standard_price: standardPrice },
                    })
                  },
                },
                {
                  id: "create-uom-category",
                  label: t("inventory.uomActions.createCategory"),
                  requiresSelection: false,
                  onClick: () => {
                    const name = promptText(t("inventory.uomActions.categoryNamePrompt"))
                    if (name == null) return
                    void createUomCategory.mutateAsync({
                      name,
                      description: null,
                      sequence: 10,
                      metadata: null,
                    })
                  },
                },
                {
                  id: "create-uom",
                  label: t("inventory.uomActions.createUom"),
                  requiresSelection: false,
                  onClick: () => {
                    const categoryId = promptScalarId(t("inventory.uomActions.categoryIdPrompt"))
                    const name = promptText(t("inventory.uomActions.uomNamePrompt"))
                    const symbol = promptText(t("inventory.uomActions.symbolPrompt"))
                    if (categoryId == null || name == null || symbol == null) return
                    void createUom.mutateAsync({
                      category_id: Number(categoryId),
                      name,
                      symbol,
                      factor: 1,
                      rounding: 0.01,
                      times_bigger: 1,
                      is_reference_unit: false,
                      is_active: true,
                      metadata: null,
                    })
                  },
                },
                {
                  id: "create-uom-conversion",
                  label: t("inventory.uomActions.createConversion"),
                  requiresSelection: false,
                  onClick: () => {
                    const categoryId = promptScalarId(t("inventory.uomActions.categoryIdPrompt"))
                    const fromUomId = promptScalarId(t("inventory.uomActions.fromUomIdPrompt"))
                    const toUomId = promptScalarId(t("inventory.uomActions.toUomIdPrompt"))
                    const factor = promptNumber(t("inventory.uomActions.factorPrompt"), "1")
                    if (categoryId == null || fromUomId == null || toUomId == null || factor == null) return
                    void createUomConversion.mutateAsync({
                      categoryId,
                      params: {
                        from_uom_id: Number(fromUomId),
                        to_uom_id: Number(toUomId),
                        factor,
                        product_id: null,
                        is_active: true,
                        metadata: null,
                      },
                    })
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
                  id: "csv-warehouse",
                  label: t("inventory.csvImport.toolbarWarehouses"),
                  onClick: () => setCsvKind("warehouse"),
                },
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
                  id: "create-stock-move",
                  label: t("inventory.stockMoveActions.create"),
                  icon: Plus,
                  requiresSelection: false,
                  onClick: () => {
                    const productId = promptScalarId(t("inventory.stockMoveActions.productIdPrompt"))
                    const productUom = promptScalarId(t("inventory.stockMoveActions.uomIdPrompt"))
                    const locationId = promptScalarId(t("inventory.stockMoveActions.locationIdPrompt"))
                    const locationDestId = promptScalarId(t("inventory.stockMoveActions.locationDestIdPrompt"))
                    const qty = promptNumber(t("inventory.stockMoveActions.quantityPrompt"), "1")
                    if (
                      productId == null ||
                      productUom == null ||
                      locationId == null ||
                      locationDestId == null ||
                      qty == null
                    ) {
                      return
                    }
                    void createStockMove.mutateAsync(
                      toCreateStockMoveParams({
                        companyId: operatingCompanyId ?? undefined,
                        name:
                          promptText(t("inventory.stockMoveActions.namePrompt"), "Manual Stock Move") ??
                          "Manual Stock Move",
                        productId: Number(productId),
                        productUom: Number(productUom),
                        quantity: qty,
                        locationId: Number(locationId),
                        locationDestId: Number(locationDestId),
                      }),
                    )
                  },
                },
                {
                  id: "confirm-move",
                  label: t("inventory.stockMoveActions.confirm"),
                  icon: CheckCircle,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) void confirmStockMove.mutateAsync(id)
                  },
                },
                {
                  id: "assign-move",
                  label: t("inventory.stockMoveActions.assign"),
                  icon: UserCircle2,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) void assignStockMove.mutateAsync(id)
                  },
                },
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
                  id: "csv-stock-quant",
                  label: t("inventory.csvImport.toolbarQuants"),
                  onClick: () => setCsvKind("stockQuant"),
                },
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
                  id: "create-stock-inventory",
                  label: t("inventory.stockInventoryActions.create"),
                  icon: Plus,
                  requiresSelection: false,
                  onClick: () => {
                    const name = promptText(t("inventory.stockInventoryActions.namePrompt"), "Cycle Count")
                    if (name == null) return
                    void createStockInventory.mutateAsync({
                      company_id: Number(operatingCompanyId ?? 0),
                      name,
                      location_ids: [],
                      product_ids: [],
                      lot_ids: [],
                      owner_ids: [],
                      package_ids: [],
                      state: "draft",
                      accounting_date: null,
                      category_id: null,
                      counted_mode: "all",
                      done_move_ids: [],
                      move_ids: [],
                      adjustment_count: 0,
                      has_account_moves: false,
                      exhausted: false,
                      prefilled_count: 0,
                      started: false,
                      is_editable: true,
                      is_stock_check: true,
                      metadata: null,
                    })
                  },
                },
                {
                  id: "create-stock-inventory-line",
                  label: t("inventory.stockInventoryActions.addLine"),
                  icon: ListChecks,
                  requiresSelection: false,
                  onClick: () => {
                    const inventoryId = promptScalarId(t("inventory.stockInventoryActions.inventoryIdPrompt"))
                    const productId = promptScalarId(t("inventory.stockInventoryActions.productIdPrompt"))
                    const uomId = promptScalarId(t("inventory.stockInventoryActions.uomIdPrompt"))
                    const locationId = promptScalarId(t("inventory.stockInventoryActions.locationIdPrompt"))
                    const qty = promptNumber(t("inventory.stockInventoryActions.productQtyPrompt"), "0")
                    if (inventoryId == null || productId == null || uomId == null || locationId == null || qty == null) return
                    void createStockInventoryLine.mutateAsync({
                      inventoryId,
                      params: {
                        product_id: Number(productId),
                        product_variant_id: null,
                        product_uom_id: Number(uomId),
                        location_id: Number(locationId),
                        location_name: null,
                        prod_lot_id: null,
                        package_id: null,
                        partner_id: null,
                        theoretical_qty: 0,
                        product_qty: qty,
                        inventory_location_id: null,
                        inventory_product_id: null,
                        inventory_prod_lot_id: null,
                        inventory_package_id: null,
                        inventory_partner_id: null,
                        package_level_id: null,
                        package_level_id_visible: false,
                        state: "draft",
                        product_tracking: "none",
                        product_barcode: null,
                        product_type: "product",
                        is_editable: true,
                        outdated: false,
                        inventory_location_id_name: null,
                        inventory_product_id_name: null,
                        theoretical_qty_text: null,
                        product_uom_category_id: null,
                        metadata: null,
                      },
                    })
                  },
                },
                {
                  id: "set-stock-inventory-state",
                  label: t("inventory.stockInventoryActions.setState"),
                  icon: Pencil,
                  requiresSelection: false,
                  onClick: () => {
                    const inventoryId = promptScalarId(t("inventory.stockInventoryActions.inventoryIdPrompt"))
                    const newState = promptText(t("inventory.stockInventoryActions.statePrompt"), "confirm")
                    if (inventoryId == null || newState == null) return
                    void updateStockInventoryState.mutateAsync({ inventoryId, newState })
                  },
                },
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
                  id: "csv-stock-location",
                  label: t("inventory.csvImport.toolbarLocations"),
                  onClick: () => setCsvKind("stockLocation"),
                },
                {
                  id: "edit-location",
                  label: t("common.edit"),
                  icon: Pencil,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const row = rows[0] as Record<string, unknown> | undefined
                    const locationId = row?.id as ScalarId | undefined
                    if (locationId == null) return
                    const name = promptText(t("inventory.locationActions.namePrompt"), String(row?.name ?? ""))
                    const barcode = promptText(t("inventory.locationActions.barcodePrompt"), String(row?.barcode ?? ""))
                    if (name == null && barcode == null) return
                    void updateStockLocation.mutateAsync({
                      locationId,
                      params: { name: name ?? undefined, barcode: barcode ?? undefined },
                    })
                  },
                },
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
                  id: "csv-lot",
                  label: t("inventory.csvImport.toolbarLots"),
                  onClick: () => setCsvKind("lot"),
                },
                {
                  id: "create-lot",
                  label: t("inventory.lotActions.create"),
                  icon: Plus,
                  requiresSelection: false,
                  onClick: () => {
                    const name = promptText(t("inventory.lotActions.namePrompt"))
                    const productId = promptScalarId(t("inventory.lotActions.productIdPrompt"))
                    if (name == null || productId == null) return
                    void createStockProductionLot.mutateAsync({
                      company_id: Number(operatingCompanyId ?? 0),
                      name,
                      product_id: Number(productId),
                      product_variant_id: null,
                      ref_: null,
                      note: null,
                      expiration_date: null,
                      use_date: null,
                      removal_date: null,
                      alert_date: null,
                      product_qty: 0,
                      location_id: null,
                      package_id: null,
                      owner_id: null,
                      is_scrap: false,
                      is_locked: false,
                      metadata: null,
                    })
                  },
                },
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
                  id: "create-serial",
                  label: t("inventory.serialActions.create"),
                  icon: Plus,
                  requiresSelection: false,
                  onClick: () => {
                    const name = promptText(t("inventory.serialActions.namePrompt"))
                    const productId = promptScalarId(t("inventory.serialActions.productIdPrompt"))
                    if (name == null || productId == null) return
                    void createStockProductionSerial.mutateAsync({
                      company_id: Number(operatingCompanyId ?? 0),
                      name,
                      product_id: Number(productId),
                      product_variant_id: null,
                      lot_id: null,
                      ref_: null,
                      note: null,
                      expiration_date: null,
                      use_date: null,
                      removal_date: null,
                      alert_date: null,
                      product_qty: 1,
                      location_id: null,
                      package_id: null,
                      owner_id: null,
                      state: "available",
                      is_scrap: false,
                      is_locked: false,
                      warranty_expiration: null,
                      warranty_start: null,
                      last_maintenance: null,
                      next_maintenance: null,
                      maintenance_count: 0,
                      metadata: null,
                    })
                  },
                },
                {
                  id: "use-serial",
                  label: t("inventory.productionSerials.actions.markInUse"),
                  icon: CheckCircle,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) void useSerial.mutateAsync(id)
                  },
                },
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
      if (tab.id === "cycle-counts") {
        return {
          ...tab,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: "open-cycle-wizard",
                  label: t("inventory.cycleCountWizard.openWizard"),
                  icon: ClipboardList,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) {
                      setWizardCycleCountId(id)
                      setActiveTab("cycle-wizard")
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
          createAction: "createQualityCheck",
          createForm: mergeSelectOptionsForFields(newQualityCheckForm(t), {
            productId: productRowsToSelectOptions(products),
            teamId: qualityTeamOptions,
          }),
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: "quality-alerts-tab",
                  label: t("inventory.qualityAlerts.tabLabel"),
                  icon: AlertTriangle,
                  requiresSelection: false,
                  onClick: () => setActiveTab("quality-alerts"),
                },
                {
                  id: "create-quality-alert",
                  label: t("inventory.forms.newQualityAlert.title"),
                  icon: Plus,
                  requiresSelection: false,
                  onClick: () => setCreateQualityAlertOpen(true),
                },
                {
                  id: "pass-check",
                  label: t("inventory.qualityActions.pass"),
                  icon: ShieldCheck,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined
                    if (id != null) void passQualityCheck.mutateAsync({ checkId: id })
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
                    if (id != null) {
                      void failQualityCheck.mutateAsync({
                        checkId: id,
                        qtyFailed: 1,
                        note: reason && reason.trim() !== "" ? reason.trim() : null,
                        pictureFail: null,
                        failureLocationId: null,
                      })
                    }
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
                  id: "update-quality-point",
                  label: t("inventory.qualityActions.updatePoint"),
                  icon: Pencil,
                  requiresSelection: false,
                  onClick: () => {
                    const pointId = promptScalarId(t("inventory.qualityActions.pointIdPrompt"))
                    if (pointId == null) return
                    const name = promptText(t("inventory.qualityActions.pointNamePrompt"))
                    const testType = promptText(t("inventory.qualityActions.testTypePrompt"))
                    if (name == null && testType == null) return
                    void updateQualityPoint.mutateAsync({
                      pointId,
                      params: { name: name ?? undefined, test_type: testType ?? undefined },
                    })
                  },
                },
                {
                  id: "update-quality-team",
                  label: t("inventory.qualityActions.updateTeam"),
                  icon: Pencil,
                  requiresSelection: false,
                  onClick: () => {
                    const teamId = promptScalarId(t("inventory.qualityActions.teamIdPrompt"))
                    if (teamId == null) return
                    const name = promptText(t("inventory.qualityActions.teamNamePrompt"))
                    const email = promptText(t("inventory.qualityActions.teamEmailPrompt"))
                    if (name == null && email == null) return
                    void updateQualityTeam.mutateAsync({
                      teamId,
                      params: { name: name ?? undefined, email: email ?? undefined },
                    })
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
          createAction: "createReplenishmentRule",
          createForm: mergeSelectOptionsForFields(newReplenishmentRuleForm(t), {
            productId: productRowsToSelectOptions(products),
            locationId: locationParentOptions,
            uomId: uomFieldOptions,
            warehouseId: warehouses.map((w) => ({
              value: String(w.id),
              label: String(w.name ?? w.id),
            })),
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
          createAction: "createPickingWave",
          createForm: mergeSelectOptionsForFields(newPickingWaveForm(t), {
            userId: assignUserFieldOptions,
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
                  id: "csv-product-category-tab",
                  label: t("inventory.csvImport.toolbarProductCategories"),
                  onClick: () => setCsvKind("productCategory"),
                },
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
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: "set-whatsapp-quality-score",
                  label: t("inventory.barcodeActions.setWhatsappQualityScore"),
                  icon: ScanLine,
                  requiresSelection: false,
                  onClick: () => {
                    const accountId = promptScalarId(t("inventory.barcodeActions.whatsappAccountIdPrompt"))
                    const qualityScore = promptText(t("inventory.barcodeActions.whatsappQualityScorePrompt"), "UNKNOWN")
                    if (accountId == null || qualityScore == null) return
                    void updateWhatsappQualityScore.mutateAsync({ accountId, qualityScore })
                  },
                },
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
      if (tab.id === "traceability-records") {
        return {
          ...tab,
          createForm: traceRecordFormConfig,
        }
      }
      if (tab.id === "barcode-nomenclatures") {
        return {
          ...tab,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: "create-barcode-nomenclature",
                  label: t("inventory.barcodeNomenclatures.actions.create"),
                  icon: Plus,
                  requiresSelection: false,
                  onClick: () => {
                    const name = promptText(t("inventory.barcodeNomenclatures.actions.namePrompt"))
                    if (name == null) return
                    void createBarcodeNomenclature.mutateAsync({
                      name,
                      description: null,
                      is_default: false,
                      upc_ean_conv: "none",
                      is_active: true,
                      metadata: null,
                    })
                  },
                },
                {
                  id: "update-barcode-nomenclature",
                  label: t("common.edit"),
                  icon: Pencil,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const row = rows[0] as Record<string, unknown> | undefined
                    const nomenclatureId = row?.id as ScalarId | undefined
                    if (nomenclatureId == null) return
                    const name = promptText(t("inventory.barcodeNomenclatures.actions.namePrompt"), String(row?.name ?? ""))
                    if (name == null) return
                    void updateBarcodeNomenclature.mutateAsync({
                      nomenclatureId,
                      params: { name, is_active: true },
                    })
                  },
                },
                {
                  id: "add-rule-to-nomenclature",
                  label: t("inventory.barcodeNomenclatures.actions.addRule"),
                  icon: Plus,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const nomenclatureId = rows[0]?.id as ScalarId | undefined
                    const ruleId = promptScalarId(t("inventory.barcodeNomenclatures.actions.ruleIdPrompt"))
                    if (nomenclatureId == null || ruleId == null) return
                    void addRuleToNomenclature.mutateAsync({ nomenclatureId, ruleId })
                  },
                },
                {
                  id: "remove-rule-from-nomenclature",
                  label: t("inventory.barcodeNomenclatures.actions.removeRule"),
                  icon: Pencil,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const nomenclatureId = rows[0]?.id as ScalarId | undefined
                    if (nomenclatureId == null || typeof window === "undefined") return
                    const raw = window.prompt(t("inventory.barcodeNomenclatures.actions.ruleIdPrompt"))
                    if (raw == null || raw.trim() === "") return
                    const ruleId = Number(raw.trim())
                    if (!Number.isFinite(ruleId)) return
                    void removeRuleFromNomenclature.mutateAsync({ nomenclatureId, ruleId })
                  },
                },
                {
                  id: "delete-barcode-nomenclature",
                  label: t("common.delete"),
                  icon: Trash2,
                  variant: "destructive",
                  requiresSelection: true,
                  onClick: (rows) => {
                    const nomenclatureId = rows[0]?.id as ScalarId | undefined
                    if (nomenclatureId == null || typeof window === "undefined") return
                    if (window.confirm(t("inventory.barcodeNomenclatures.actions.confirmDelete"))) {
                      void deleteBarcodeNomenclature.mutateAsync(nomenclatureId)
                    }
                  },
                },
              ],
            },
          },
        }
      }
      if (tab.id === "traceability-reports") {
        return {
          ...tab,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: "run-traceability-report",
                  label: t("inventory.traceabilityReports.actions.runSelected"),
                  icon: Play,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const row = rows[0] as Record<string, unknown> | undefined
                    const id = row?.id as ScalarId | undefined
                    if (id == null || String(row?.state ?? "") !== "draft") return
                    void runTraceabilityReport.mutateAsync(id)
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
          if (tab.id === "cycle-counts") return withTransferActions(tab)
          if (tab.id === "quality") return withTransferActions(tab)
          if (tab.id === "replenishment") return withTransferActions(tab)
          if (tab.id === "picking-waves") return withTransferActions(tab)
          if (tab.id === "product-categories") return withTransferActions(tab)
          if (tab.id === "routes") return withTransferActions(tab)
          if (tab.id === "rules") return withTransferActions(tab)
          if (tab.id === "barcode-rules") return withTransferActions(tab)
          if (tab.id === "adjustment-reasons") return withTransferActions(tab)
          if (tab.id === "barcode-nomenclatures") return withTransferActions(tab)
          if (tab.id === "traceability-records") return withTransferActions(tab)
          if (tab.id === "traceability-reports") return withTransferActions(tab)
          if (tab.id === "warehouse-tasks") return withTransferActions(tab)
          return tab
        }),
        cycleCountWizardTab,
        locationHierarchyTab,
        qualityAlertsTab,
        warehouse3DTab,
      ],
    } as ModuleConfig
  }, [
    moduleConfig,
    liveSections,
    cycleCountWizardTab,
    locationHierarchyTab,
    qualityAlertsTab,
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
    updateProductPricing,
    updateProductInventoryData,
    updateProductVariant,
    createUomCategory,
    createUom,
    createUomConversion,
    createStockInventory,
    createStockInventoryLine,
    updateStockInventoryState,
    updateStockLocation,
    createStockMove,
    confirmStockMove,
    assignStockMove,
    doneStockMove,
    cancelStockMove,
    // Quality management
    passQualityCheck,
    failQualityCheck,
    deleteQualityCheck,
    deleteQualityAlert,
    updateQualityPoint,
    deleteQualityPoint,
    updateQualityTeam,
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
    updateWhatsappQualityScore,
    createBarcodeNomenclature,
    updateBarcodeNomenclature,
    addRuleToNomenclature,
    deleteBarcodeNomenclature,
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
    createStockProductionLot,
    deleteStockProductionLot,
    updateStockProductionSerial,
    createStockProductionSerial,
    deleteStockProductionSerial,
    linkDeviceToQualityCheck,
    upsertWarehouseGeo,
    restoreProductCategory,
    updateProductSupplierInfo,
    updateProductPackaging,
    stockQuantFormConfig,
    traceRecordFormConfig,
    useSerial,
    removeRuleFromNomenclature,
    runTraceabilityReport,
    promptText,
    promptScalarId,
    promptNumber,
    promptOptionalNumber,
    // Data dependencies for form configs
    products,
    qualityTeamOptions,
    warehouses,
    locations,
    productCategories,
    pricelists,
    uomFieldOptions,
    locationParentOptions,
    setCsvKind,
  ])

  const filteredStockQuants = useMemo(() => {
    if (!stockLocationFilter) return stockQuants
    return stockQuants.filter((q) => String(q.locationId ?? "") === stockLocationFilter)
  }, [stockQuants, stockLocationFilter])

  const data = useMemo(
    () => ({
      products: products as unknown as Record<string, unknown>[],
      stock: filteredStockQuants as unknown as Record<string, unknown>[],
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
      "adjustment-reasons": adjustmentReasons as unknown as Record<string, unknown>[],
      "barcode-nomenclatures": barcodeNomenclatures as unknown as Record<string, unknown>[],
      "traceability-records": serialLotTraceability as unknown as Record<string, unknown>[],
      "traceability-reports": stockTraceabilityReports as unknown as Record<string, unknown>[],
    }),
    [
      products,
      stockQuants,
      filteredStockQuants,
      stockLocationFilter,
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
      adjustmentReasons,
      barcodeNomenclatures,
      serialLotTraceability,
      stockTraceabilityReports,
    ]
  )

  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>
  ) => {
    if (action === "createProduct") {
      const pricelistRaw = formData.pricelistId
      if (pricelistRaw === "" || pricelistRaw == null) return
      const pl = pricelists.find((p) => String(p.id) === String(pricelistRaw))
      if (pl == null || pl.currencyId === undefined || pl.currencyId === null) return
      const currencyId = Number(pl.currencyId)
      const productParams = toCreateProductParamsFromForm(formData, currencyId)
      if (productParams) await createProduct.mutateAsync(productParams)
    }
    else if (action === "createTransfer" || action === "createStockPicking") {
      const stockPickingParams = toCreateStockPickingParamsFromForm(formData)
      if (stockPickingParams) await createStockPicking.mutateAsync(stockPickingParams)
    }
    else if (action === "createAdjustment" || action === "createInventoryAdjustment") {
      const productRaw = formData.productId
      if (productRaw === "" || productRaw == null) return
      const productRow = products.find((p) => String(p.id) === String(productRaw))
      const uomFromProduct =
        productRow?.uomId != null
          ? Number(productRow.uomId)
          : productRow?.uomPoId != null
            ? Number(productRow.uomPoId)
            : undefined
      if (uomFromProduct == null || Number.isNaN(uomFromProduct)) return
      const adjustmentParams = toCreateInventoryAdjustmentParamsFromForm(formData, uomFromProduct)
      if (adjustmentParams) await createInventoryAdjustment.mutateAsync(adjustmentParams)
    } else if (action === "createStockLocation") {
      const stockLocationParams = toCreateStockLocationParamsFromForm(formData)
      if (stockLocationParams) await createStockLocation.mutateAsync(stockLocationParams)
    } else if (action === "createWarehouse") {
      const templateWarehouseId = formData.templateWarehouseId
      if (templateWarehouseId === "" || templateWarehouseId == null) return
      const template = warehouses.find(
        (w) => String(w.id) === String(templateWarehouseId),
      ) as Record<string, unknown> | undefined
      if (!template) return
      try {
        await createWarehouse.mutateAsync(
          buildCreateWarehouseParamsFromTemplate(template, {
            name: String(formData.name ?? "").trim(),
            code: String(formData.code ?? "").trim(),
            active: formData.active == null ? true : Boolean(formData.active),
            sequence: Number(formData.sequence ?? 0),
            // Ensures template row lookup key is visible to static form–mutation tooling
            templateWarehouseId: String(templateWarehouseId),
          }) as Record<string, unknown>,
        )
      } catch {
        return
      }
    }
    else if (action === "createQualityCheck") {
      const productRaw = formData.productId
      if (productRaw === "" || productRaw == null) return
      const qtyTested = Number(formData.qtyTested ?? 0)
      await createQualityCheck.mutateAsync({
        name: String(formData.name ?? "Quality Check"),
        testType: String(formData.testType ?? "measure"),
        productId: Number(productRaw),
        controlPointId: formData.pointId ? Number(formData.pointId) : undefined,
        lotId: formData.lotId ? Number(formData.lotId) : undefined,
        teamId: formData.teamId ? Number(formData.teamId) : undefined,
        qtyTested: Number.isFinite(qtyTested) ? qtyTested : 0,
      })
    }
    else if (action === "createQualityAlert") {
      const name = String(formData.name ?? "").trim()
      const teamRaw = formData.teamId
      if (!name || teamRaw === "" || teamRaw == null) return
      const priorityKey = String(formData.priority ?? "2")
      const priorityByValue: Record<string, string> = {
        "0": "normal",
        "1": "low",
        "2": "high",
        "3": "critical",
      }
      await createQualityAlert.mutateAsync({
        teamId: Number(teamRaw),
        params: {
          title: name,
          priority: priorityByValue[priorityKey] ?? "high",
          productId: formData.productId ? Number(formData.productId) : undefined,
          description: formData.description ? String(formData.description) : undefined,
        },
      })
    }
    else if (action === "createReplenishmentRule") {
      const productRaw = formData.productId
      const locRaw = formData.locationId
      const uomRaw = formData.uomId
      if (
        productRaw === "" ||
        productRaw == null ||
        locRaw === "" ||
        locRaw == null ||
        uomRaw === "" ||
        uomRaw == null
      ) {
        return
      }
      const qtyMultipleRaw = Number(formData.qtyMultiple ?? 1)
      const leadDaysRaw = Math.floor(Number(formData.leadDays ?? 0))
      await createReplenishmentRule.mutateAsync({
        productId: Number(productRaw),
        locationId: Number(locRaw),
        warehouseId: formData.warehouseId ? Number(formData.warehouseId) : undefined,
        uomId: Number(uomRaw),
        productMinQty: Number(formData.minQty ?? 0),
        productMaxQty: Number(formData.maxQty ?? 0),
        qtyMultiple: Number.isFinite(qtyMultipleRaw) ? qtyMultipleRaw : 1,
        leadDays: Number.isFinite(leadDaysRaw) ? leadDaysRaw : 0,
        routeId: formData.routeId ? Number(formData.routeId) : undefined,
        trigger: String(formData.trigger ?? "auto"),
        active: formData.active == null ? true : Boolean(formData.active),
      })
    }
    else if (action === "createPickingWave") {
      const name = String(formData.name ?? "").trim()
      if (!name) return
      await createPickingWave.mutateAsync(pickingWaveCreateParamsFromForm(formData))
    }
    else if (action === "createProductCategory") {
      const productCategoryParams = toCreateProductCategoryParamsFromForm(formData)
      if (productCategoryParams) await createProductCategory.mutateAsync(productCategoryParams)
    }
    else if (action === "createBarcodeRule") {
      const barcodeRuleParams = toCreateBarcodeRuleParamsFromForm(formData)
      if (barcodeRuleParams) await createBarcodeRule.mutateAsync(barcodeRuleParams)
    } else if (action === "createAdjustmentReason") {
      const adjustmentReasonParams = toCreateAdjustmentReasonParamsFromForm(formData)
      if (adjustmentReasonParams)
        await createAdjustmentReason.mutateAsync(adjustmentReasonParams as Record<string, unknown>)
    } else if (action === "createTraceabilityRecord") {
      const traceRecordParams = toCreateTraceabilityRecordParamsFromForm(formData)
      if (traceRecordParams)
        await createTraceabilityRecord.mutateAsync(traceRecordParams as Record<string, unknown>)
    } else if (action === "createTraceabilityReport") {
      const traceReportParams = toCreateStockTraceabilityReportParamsFromForm(formData)
      if (traceReportParams)
        await createTraceabilityReport.mutateAsync(traceReportParams as Record<string, unknown>)
    } else if (action === "createStockQuant") {
      const stockQuantParams = toCreateStockQuantParamsFromForm(formData)
      if (stockQuantParams) await createStockQuant.mutateAsync(stockQuantParams)
    } else if (action === "createWarehouse3dZone") {
      const wid = formData.warehouseId
      const lid = formData.locationId
      if (wid === "" || wid == null || lid === "" || lid == null) return
      await createWarehouse3dZone.mutateAsync({
        warehouseId: BigInt(String(wid)),
        locationId: BigInt(String(lid)),
        params: warehouse3dZoneParamsFromForm(formData),
      })
    }
  }

  const isFormMutationPending =
    [
      createProduct,
      createStockPicking,
      createInventoryAdjustment,
      createStockInventory,
      createStockInventoryLine,
      updateStockInventoryState,
      createStockLocation,
      updateStockLocation,
      createWarehouse,
      updateWarehouse,
      deleteWarehouse,
      updateProduct,
      deleteProduct,
      createProductVariant,
      deleteStockLocation,
      createStockMove,
      confirmStockMove,
      assignStockMove,
      doneStockMove,
      cancelStockMove,
      assignUserToPicking,
      confirmPicking,
      assignPicking,
      validatePicking,
      cancelPicking,
      processAdjustment,
      reserveQuant,
      unreserveQuant,
      moveStockItem,
      createQualityCheck,
      passQualityCheck,
      failQualityCheck,
      deleteQualityCheck,
      createQualityAlert,
      assignQualityAlert,
      cancelQualityAlert,
      deleteQualityAlert,
      createQualityPoint,
      updateQualityPoint,
      deleteQualityPoint,
      createQualityTeam,
      updateQualityTeam,
      deleteQualityTeam,
      createBarcodeRule,
      updateBarcodeRule,
      deleteBarcodeRule,
      recordBarcodeScan,
      createBarcodeNomenclature,
      updateBarcodeNomenclature,
      deleteBarcodeNomenclature,
      addRuleToNomenclature,
      removeRuleFromNomenclature,
      createAdjustmentReason,
      useSerial,
      blockSerial,
      createStockProductionLot,
      createStockProductionSerial,
      createTraceabilityRecord,
      createTraceabilityReport,
      runTraceabilityReport,
      createReplenishmentRule,
      updateReplenishmentRule,
      deleteReplenishmentRule,
      triggerReplenishment,
      createPickingWave,
      updatePickingWave,
      deletePickingWave,
      confirmPickingWave,
      processPickingWave,
      completePickingWave,
      createProductCategory,
      updateProductCategory,
      deleteProductCategory,
      createStockRoute,
      updateStockRoute,
      deleteStockRoute,
      createStockRule,
      updateStockRule,
      deleteStockRule,
      createWarehouseTask,
      deleteWarehouseTask,
      startWarehouseTask,
      completeWarehouseTask,
      cancelWarehouseTask,
      startQualityCheck,
      openQualityAlert,
      solveQualityAlert,
      createQualityAlertReason,
      updateQualityAlertReason,
      deleteQualityAlertReason,
      addMemberToQualityTeam,
      removeMemberFromQualityTeam,
      executeReplenishmentRule,
      createStockQuant,
      updateStockQuantQuantity,
      updateStockProductionLot,
      deleteStockProductionLot,
      updateStockProductionSerial,
      deleteStockProductionSerial,
      updateProductVariant,
      updateProductInventoryData,
      updateProductPricing,
      createUomCategory,
      createUom,
      createUomConversion,
      createWarehouse3dZone,
      updateWarehouse3dZone,
      deleteWarehouse3dZone,
      updateWarehouseTaskStatus,
      linkDeviceToQualityCheck,
      createProductSupplierInfo,
      updateProductSupplierInfo,
      createProductPackaging,
      updateProductPackaging,
      restoreProductCategory,
      upsertWarehouseGeo,
      updateWhatsappQualityScore,
      runPriceSearch,
    ].some((h) => h.isPending) || Object.values(csvImports).some((h) => h.isPending)

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
        isPending={isFormMutationPending}
        activeTab={activeTab}
        onActiveTabChange={(tab) => {
          setActiveTab(tab)
          if (tab !== "stock") setStockLocationFilter(null)
        }}
        onRowClick={(tabId, row) => {
          if (tabId === "serials") setSelectedSerialRow(row)
          if (tabId === "lots") setSelectedLotRow(row)
        }}
      />
      {stockLocationFilter ? (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          <span>
            {t("inventory.locationTree.filteredStock", { locationId: stockLocationFilter })}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setStockLocationFilter(null)}>
            {t("common.close")}
          </Button>
        </div>
      ) : null}
      <FormModal
        open={selectedSerialRow !== null}
        onOpenChange={(open) => !open && setSelectedSerialRow(null)}
        config={serialDetailModalConfig}
        isPending={isFormMutationPending}
        onSubmit={() => setSelectedSerialRow(null)}
        formLeadingActions={
          selectedSerialRow && !selectedSerialRow.isLocked ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => {
                const id = selectedSerialRow.id as ScalarId
                setBlockSerialId(id)
              }}
            >
              {t("inventory.serialActions.block")}
            </Button>
          ) : null
        }
      />
      <FormModal
        open={selectedLotRow !== null}
        onOpenChange={(open) => !open && setSelectedLotRow(null)}
        config={lotDetailModalConfig}
        isPending={isFormMutationPending}
        onSubmit={() => setSelectedLotRow(null)}
      />
      <FormModal
        key={blockSerialId != null ? `block-serial-${String(blockSerialId)}` : "block-serial-closed"}
        open={blockSerialId !== null}
        onOpenChange={(open) => !open && setBlockSerialId(null)}
        config={blockSerialForm(t)}
        isPending={isFormMutationPending}
        onSubmit={async (fd) => {
          if (blockSerialId == null) return
          await blockSerial.mutateAsync({
            serialId: blockSerialId,
            reason:
              fd.reason != null && String(fd.reason).trim() !== ""
                ? String(fd.reason).trim()
                : null,
          })
          setBlockSerialId(null)
          setSelectedSerialRow(null)
        }}
      />
      <FormModal
        open={createQualityAlertOpen}
        onOpenChange={setCreateQualityAlertOpen}
        config={qualityAlertCreateFormConfig}
        isPending={isFormMutationPending}
        onSubmit={async (fd) => {
          await handleFormSubmit("quality-alerts", "createQualityAlert", fd)
          setCreateQualityAlertOpen(false)
          setActiveTab("quality-alerts")
        }}
      />
      <FormModal
        key={assignQualityAlertId != null ? `assign-alert-${String(assignQualityAlertId)}` : "assign-alert-closed"}
        open={assignQualityAlertId !== null}
        onOpenChange={(open) => !open && setAssignQualityAlertId(null)}
        config={assignQualityAlertFormConfig}
        isPending={isFormMutationPending}
        onSubmit={async (fd) => {
          if (assignQualityAlertId == null) return
          const raw = fd.userIdentity
          const hex = raw != null && String(raw).trim() !== "" ? String(raw).trim() : null
          await assignQualityAlert.mutateAsync({ alertId: assignQualityAlertId, userId: hex })
          setAssignQualityAlertId(null)
        }}
      />
      <FormModal
        key={solveQualityAlertId != null ? `solve-alert-${String(solveQualityAlertId)}` : "solve-alert-closed"}
        open={solveQualityAlertId !== null}
        onOpenChange={(open) => !open && setSolveQualityAlertId(null)}
        config={solveQualityAlertForm(t)}
        isPending={isFormMutationPending}
        onSubmit={async (fd) => {
          if (solveQualityAlertId == null) return
          await solveQualityAlert.mutateAsync({
            alertId: solveQualityAlertId,
            description:
              fd.description != null && String(fd.description).trim() !== ""
                ? String(fd.description).trim()
                : null,
          })
          setSolveQualityAlertId(null)
        }}
      />
      {productPriceSearchResult ? (
        <div className="mt-4 px-4">
          <AiResultPanel
            title="Price search results"
            result={productPriceSearchResult}
            onDismiss={() => setProductPriceSearchResult(null)}
          />
        </div>
      ) : null}
      {productPriceSearch ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setProductPriceSearch(null)
              setProductPriceSearchError(null)
            }
          }}
          config={productPriceSearch.form}
          isPending={isFormMutationPending}
          closeOnSubmit={false}
          submitError={productPriceSearchError}
          onSubmit={async (formData) => {
            setProductPriceSearchError(null)
            try {
              const row = productPriceSearch.row
              const productIdRaw = row.id
              const result = await runPriceSearch.mutateAsync({
                companyId: Number(operatingCompanyId ?? 0),
                skillKey: "price_search",
                inputs: {
                  query: String(formData.question ?? "").trim(),
                  product_id: productIdRaw != null ? Number(productIdRaw) : undefined,
                  entity_type: "product",
                  entity_id: productIdRaw != null ? Number(productIdRaw) : undefined,
                  product_name: row.name != null ? String(row.name) : undefined,
                  default_code:
                    row.defaultCode != null
                      ? String(row.defaultCode)
                      : row.default_code != null
                        ? String(row.default_code)
                        : undefined,
                  target_price:
                    formData.targetPrice != null && String(formData.targetPrice).trim() !== ""
                      ? Number(formData.targetPrice)
                      : undefined,
                  quantity:
                    formData.quantity != null && String(formData.quantity).trim() !== ""
                      ? Number(formData.quantity)
                      : undefined,
                },
              })
              setProductPriceSearchResult(skillRunToPanel(result))
              setProductPriceSearch(null)
            } catch (e) {
              setProductPriceSearchError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      ) : null}
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? productFormConfig}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (quickActionForm) {
            await handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
      <FormModal
        key={editProductRow ? `edit-product-${String(editProductRow.id)}` : "edit-product-closed"}
        open={editProductRow !== null}
        onOpenChange={(open) => !open && setEditProductRow(null)}
        config={editProductModalConfig}
        isPending={isFormMutationPending}
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
        isPending={isFormMutationPending}
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
        isPending={isFormMutationPending}
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
        isPending={isFormMutationPending}
        onSubmit={async (fd) => {
          if (assignPickingId == null) return
          const raw = fd.userIdentity
          const hex =
            raw != null && String(raw).trim() !== "" ? String(raw).trim() : null
          await assignUserToPicking.mutateAsync({
            pickingId: assignPickingId,
            params: { userId: hex },
          })
        }}
      />
      <FormModal
        key={supplierLineProductId != null ? `supplier-${String(supplierLineProductId)}` : "supplier-closed"}
        open={supplierLineProductId !== null}
        onOpenChange={(open) => !open && setSupplierLineProductId(null)}
        config={productSupplierLineFormConfig}
        isPending={isFormMutationPending}
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
            partnerId: Number(partnerRaw),
            productTmplId: tmplOpt,
            minQty: Number(fd.minQty ?? 0),
            price: Number(fd.price ?? 0),
            currencyId: Number(curRaw),
            delay: Math.floor(Number(fd.delay ?? 0)),
            sequence: Math.floor(Number(fd.sequence ?? 10)),
          })
          setSupplierLineProductId(null)
        }}
      />
      <FormModal
        key={packagingProductId != null ? `pkg-${String(packagingProductId)}` : "pkg-closed"}
        open={packagingProductId !== null}
        onOpenChange={(open) => !open && setPackagingProductId(null)}
        config={productPackagingFormConfig}
        isPending={isFormMutationPending}
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
              uomId: Number(uomRaw),
              barcode:
                fd.barcode != null && String(fd.barcode).trim() !== ""
                  ? String(fd.barcode)
                  : undefined,
              length: Number(fd.length ?? 0),
              width: Number(fd.width ?? 0),
              height: Number(fd.height ?? 0),
              weight: Number(fd.weight ?? 0),
              maxWeight: Number(fd.maxWeight ?? 0),
            },
          })
          setPackagingProductId(null)
        }}
      />
      {csvKind === "product" ? (
        <ImportAssistantWizard
          key="product-assistant"
          open
          organizationId={organizationId}
          onOpenChange={(open) => !open && setCsvKind(null)}
          targetEntity="product"
          title={t("inventory.csvImport.productsTitle")}
          isImportPending={csvImports.importProduct.isPending}
          onImport={async (csvData) => {
            const pl = pricelists.find(
              (p) => p.currencyId != null && String(p.currencyId).trim() !== "",
            )
            if (pl == null || pl.currencyId == null) {
              throw new Error(t("inventory.csvImport.noPricelistCurrency"))
            }
            await csvImports.importProduct.mutateAsync({
              csvData,
              currencyId: Number(pl.currencyId),
            })
          }}
        />
      ) : null}
      {csvKind && csvKind !== "product" && csvFormConfig ? (
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
              if (csvKind === "uomCategory") await csvImports.importUomCategory.mutateAsync(text)
              else if (csvKind === "uom") await csvImports.importUom.mutateAsync(text)
              else if (csvKind === "productCategory") await csvImports.importProductCategory.mutateAsync(text)
              else if (csvKind === "productVariant") await csvImports.importProductVariant.mutateAsync(text)
              else if (csvKind === "warehouse") await csvImports.importWarehouse.mutateAsync(text)
              else if (csvKind === "stockLocation") await csvImports.importStockLocation.mutateAsync(text)
              else if (csvKind === "stockQuant") await csvImports.importStockQuant.mutateAsync(text)
              else if (csvKind === "lot") await csvImports.importLot.mutateAsync(text)
              else if (csvKind === "product") {
                const pl = pricelists.find(
                  (p) => p.currencyId != null && String(p.currencyId).trim() !== "",
                )
                if (pl == null || pl.currencyId == null) {
                  setCsvError(t("inventory.csvImport.noPricelistCurrency"))
                  return
                }
                await csvImports.importProduct.mutateAsync({
                  csvData: text,
                  currencyId: Number(pl.currencyId),
                })
              }
              setCsvKind(null)
            } catch (e) {
              setCsvError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      ) : null}
    </>
  )
}

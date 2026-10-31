'use client';
import { useStockMoveTabActions } from './stock-move-tab-actions';
import { useInventoryCountTabActions } from './inventory-count-tab-actions';
import { useProductionLotTabActions } from './production-lot-tab-actions';
import { useProductionSerialTabActions } from './production-serial-tab-actions';
import { useQualityCheckTabActions } from './quality-check-tab-actions';
import { useReplenishmentTabActions } from './replenishment-tab-actions';
import { usePickingWaveTabActions } from './picking-wave-tab-actions';
import { useStockPackageTabActions } from './stock-package-tab-actions';
import { useStockRoutingTabActions } from './stock-routing-tab-actions';
import { useBarcodeTabActions } from './barcode-tab-actions';
import { useWarehouseTaskTabActions } from './warehouse-task-tab-actions';
import {
  mapDashboardWidgets,
  withDashboardSections,
} from '@lumiere/ui/lib/dashboard-sections';
import { withInlineEdits } from '@lumiere/ui/lib/with-inline-edits';
import { inlineNumberAtLeast, requiredInlineText } from '@/lib/inline-edit-params';

import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { canUseModuleData, mergeModuleStates, moduleCollection } from '@lumiere/ui/lib/module-data-state';
import dynamic from 'next/dynamic';
import { useTranslation } from '@lumiere/i18n';
import {
  ModuleView,
  useRBAC,
  FormModal,
  CsvImportModal,
  newProductForm,
  newTransferForm,
  newInventoryAdjustmentForm,
  newStockLocationForm,
  newWarehouseForm,
  editWarehouseForm,
  editProductForm,
  newProductVariantForm,
  assignUserToPickingForm,
  buildPartialDeliveryForm,
  pickingRowActions,
  newQualityAlertForm,
  assignQualityAlertForm,
  solveQualityAlertForm,
  blockSerialForm,
  serialDetailForm,
  lotDetailForm,
  newTraceabilityRecordForm,
  newTraceabilityReportForm,
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
  productsTableConfig,
  productDetailConfig,
  productStatusBadges,
  stockQuantsTableConfig,
  stockQuantDetailConfig,
  stockLocationDetailConfig,
  transfersTableConfig,
  transferDetailConfig,
  transferStatusBadges,
  runRecordActionForRows,
  stockMovesTableConfig,
  EntityView,
  type TimeRangeValue,
  isTimestampInRange,
  percentChange,
  previousPeriodMs,
  timeRangeToMs,
} from '@lumiere/ui';
import { useErpSession } from '@lumiere/erp-session';
import { formNumber, formText, recordOptions, useFormDialog } from '@lumiere/ui';
import type {
  EntityTableConfig,
  EntityViewConfig,
  EntityRecordSheetConfig,
  FormConfig,
  FormField,
  ModuleConfig,
} from '@lumiere/ui';
import { inventoryModuleConfig } from '@/lib/module-dashboard-configs';
import { useModuleTab } from '@/hooks/use-module-tab';
import { recordOptions as linkedRecordOptions, withLinkedPickers } from '@/lib/linked-options';
import {
  ProductPackagingTab,
  ProductVariantsTab,
  ProductVendorPricesTab,
} from './product-record-read-tabs';
import { packagingOptionLabel, vendorPriceOptionLabel } from './product-record-tabs';
import {
  PRODUCT_CATALOG_TAB_IDS,
  productCatalogCategoryRows,
  productCatalogDetail,
  productCatalogRows,
  productCatalogTable,
  productCatalogWorkspace,
} from './product-catalog';
import { prepareProductCreate } from './product-create';
import {
  WAREHOUSE_TAB_IDS,
  warehouseDataStates,
  warehouseRows,
  warehouseStockDetail,
  warehouseWorkspace,
} from './warehouse-workspace';

import { useInventoryModuleSubscription } from '@/lib/module-subscription-hooks';
import { useWorkflowSurface } from '@/hooks/use-workflow-surface';
import { usePickingWorkflow } from '@lumiere/query-hooks/hooks/picking-workflow';
import { useStockQuantWorkflow } from '@lumiere/query-hooks/hooks/stock-quant-workflow';

import { useSerialBlockWorkflow } from '@lumiere/query-hooks/hooks/serial-block-workflow';
import {
  planPartialDelivery,
} from '@lumiere/erp-workflows';
import { showWorkflowToast } from '@lumiere/ui/lib/workflow-toast';
import type { KpiTileDef } from '@lumiere/ui/lib/kpi-tiles';
import { transferKpis } from './transfer-kpis';
import { groupBy } from '@/lib/utils';
import { transferRecordHref } from './transfer-record';

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
  useStockPackages,
  useWarehouseTasks,
  useStockRoutes,
  useStockRules,
  useStockMoves,
  useStockProductionSerials,
  useInventoryValuations,
  useReplenishmentRules,
  useBarcodeRules,
  useAdjustmentReasons,
  useBarcodeNomenclatures,
  useSerialLotTraceability,
  useStockTraceabilityReports,
  useInventoryExceptionsShortAtp,
  useInventoryExceptionsExpiredLots,
  useInventoryExceptionsOpenQc,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  useCreateProductVariant,
  useCreateStockPicking,
  useCreateInventoryAdjustment,
  useCreateStockLocation,
  useUpdateStockLocation,
  useCreateWarehouse,
  useUpdateWarehouse,
  useDeleteWarehouse,
  useDeleteStockLocation,
  useAssignUserToPicking,
  useReserveStockQuant,
  useUnreserveStockQuant,
  useWarehouse3D,
  useOrgUsers,
  useCreateQualityCheck,
  useCreateQualityAlert,
  useAssignQualityAlert,
  useCancelQualityAlert,
  useCreateQualityPoint,
  useDeleteQualityPoint,
  useCreateQualityTeam,
  useDeleteQualityTeam,
  useCreateBarcodeRule,
  useUpdateBarcodeRule,
  useRecordBarcodeScan,
  useCreateAdjustmentReason,
  useCreateTraceabilityRecord,
  useCreateTraceabilityReport,
  useRunTraceabilityReport,
  useCreateReplenishmentRule,
  useCreatePickingWave,
  useCreateProductCategory,
  useUpdateProductCategory,
  useRenameProductCategory,
  useDeleteProductCategory,
  useCreateStockRoute,
  useUpdateStockRoute,
  useCreateStockRule,
  useUpdateStockRule,
  useCreateWarehouseTask,
  useOpenQualityAlert,
  useSolveQualityAlert,
  useCreateStockQuant,
  useUpdateStockQuantQuantity,
  useUpdateProductVariant,
  useUpdateProductInventoryData,
  useUpdateProductPricing,
  useCreateUomCategory,
  useCreateUom,
  useCreateUomConversion,
  useCreateWarehouse3dZone,
  useUpdateWarehouse3dZone,
  useDeleteWarehouse3dZone,
  useCreateProductSupplierInfo,
  useUpdateProductSupplierInfo,
  useCreateProductPackaging,
  useProductPackagings,
  useProductSupplierInfos,
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
  useStockInventories,
} from '@lumiere/query-hooks/hooks/inventory';
import { useIotDevices } from '@lumiere/query-hooks/hooks/iot';
import { usePricelists, type ProductPricelist } from '@lumiere/query-hooks/hooks/sales';
import { useContacts } from '@lumiere/query-hooks/hooks/crm';
import { useDocuments } from '@lumiere/query-hooks/hooks/documents';
import { hasValidOrganizationId, orgBigInts } from '@/lib/org-scoped';
import { useDefaultOperatingCompanyBigInt } from '@lumiere/query-hooks/hooks/use-operating-company';
import { inventoryProductPrimaryLabel } from '@lumiere/stdb/read-models';

import type { ScalarId } from './inventory-tab-actions';

/** Swaps number fields that ask for a record id for searchable pickers (via `withLinkedPickers`). */
function recordPickerFields(
  fields: FormField[],
  options: Record<string, ReturnType<typeof linkedRecordOptions>>,
): FormField[] {
  const picked = withLinkedPickers(
    { id: 'record-picker', title: '', sections: [{ id: 'main', fields }] } as FormConfig,
    options,
  );
  return picked.sections[0].fields;
}

import { rowState } from './inventory-tab-actions';

type InventoryCsvImportKind =
  | 'uomCategory'
  | 'uom'
  | 'productCategory'
  | 'product'
  | 'productVariant'
  | 'warehouse'
  | 'stockLocation'
  | 'stockQuant'
  | 'lot';

function recordTimestampMs(row: Record<string, unknown>): number {
  const raw =
    row.writeDate ?? row.write_date ?? row.createDate ?? row.create_date;
  if (raw == null) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e15 ? n / 1000 : n;
}

import {
  pricelistRowsToSelectOptions,
  pickingTypeOptionsFromTransfers,
  locationOptionsFromQuantsAndTransfers,
  productRowsToSelectOptions,
  productCategoryRowsToSelectOptions,
  productTemplateRowsToSelectOptions,
  uomRowsToSelectOptions,
  contactRowsToVendorSelectOptions,
  documentRowsToSelectOptions,
  stockSerialRowsToSelectOptions,
  stockLotRowsToSelectOptions,
  stockLocationRowsToSelectOptions,
  warehouseRowsToSelectOptions,
  stockMoveRowsToSelectOptions,
} from '@/lib/form-lookup';
import {
  CheckCircle,
  ListChecks,
  Package,
  Pencil,
  Plus,
  Trash2,
  UserCircle2,
  UserPlus,
  XCircle,
  PackageOpen,
  FolderTree,
  Route,
  ClipboardList,
  Play,
  Sparkles,
} from 'lucide-react';
import { buildCreateWarehouseParamsFromTemplate } from '@/lib/warehouse-create-params';
import {
  pickingWaveCreateParamsFromForm,
  toCreateBarcodeRuleParamsFromForm,
  toCreateAdjustmentReasonParamsFromForm,
  toCreateInventoryAdjustmentParamsFromForm,
  toCreateProductCategoryParamsFromForm,
  toCreateStockLocationParamsFromForm,
  toCreateStockPickingParamsFromForm,
  toCreateStockQuantParamsFromForm,
  toCreateStockTraceabilityReportParamsFromForm,
  toCreateTraceabilityRecordParamsFromForm,
  warehouse3dZoneParamsFromForm,
} from '@/lib/inventory-ext-params';
import { withDefaultsFromRow } from '@/lib/prefill-form-config';

import {
  CycleCountWizard,
  LocationHierarchyPanel,
  QualityAlertsPanel,
} from './cycle-count-wizard';
import { buildEntitySelection } from '@lumiere/query-hooks/ai-ui-context';
import { useOpenErpAiChat } from '@/lib/erp-ai-context';
import type {
  Product,
  StockQuant,
  StockPicking,
  Warehouse,
  InventoryAdjustment,
  ProductCategory,
  Uom,
  StockLocation,
  StockCycleCount,
  StockMove,
  Warehouse3DZone,
  InventoryValuation,
  ReplenishmentRule,
  StockProductionSerial,
  CreateProductParams,
  CreateStockPickingParams,
  CreateInventoryAdjustmentParams,
  CreateStockLocationParams,
  CreateWarehouseParams,
  CreatePickingWaveParams,
  CreateProductCategoryParams,
  CreateBarcodeRuleParams,
  CreateAdjustmentReasonParams,
  CreateTraceabilityRecordParams,
  CreateStockTraceabilityReportParams,
  CreateStockQuantParams,
  CreateWarehouse3DZoneParams,
} from '@lumiere/stdb/types';
import { scalarToU64 } from '@lumiere/erp-shared/u64';

// WarehouseViewer uses Three.js — must be loaded client-side only, imported directly to avoid SSR barrel evaluation
const WarehouseViewer = dynamic(
  () => import('@lumiere/ui/stock-3d/warehouse-viewer'),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading 3D viewer…
      </div>
    ),
  },
);

interface InventoryClientProps {
  /** Bounded workspaces reuse Inventory's existing commands, forms and dialogs. */
  workspace?: 'inventory' | 'products' | 'warehouse';
  initialProducts?: Product[];
  initialStockQuants?: StockQuant[];
  initialTransfers?: StockPicking[];
  initialWarehouses?: Warehouse[];
  initialAdjustments?: InventoryAdjustment[];
  initialPricelists?: ProductPricelist[];
  initialProductCategories?: ProductCategory[];
  initialUoms?: Uom[];
  initialStockLocations?: StockLocation[];
  initialStockCycleCounts?: StockCycleCount[];
  initialStockMoves?: StockMove[];
  initialWarehouse3dZones?: Warehouse3DZone[];
  initialInventoryValuations?: InventoryValuation[];
  initialReplenishmentRules?: ReplenishmentRule[];
  initialStockProductionSerials?: StockProductionSerial[];
  organizationId?: number;
}

type InventoryClientLoadedProps = Omit<
  InventoryClientProps,
  'organizationId'
> & {
  organizationId: number;
};

export function InventoryClient(props: InventoryClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />;
  }
  return (
    <InventoryClientLoaded {...props} organizationId={props.organizationId} />
  );
}

function runPickingWorkflowActionForRows(
  action: {
    execute(
      recordId: string,
      context?: { navigateToNext?: boolean },
    ): Promise<unknown>;
  },
  rows: ReadonlyArray<{ id?: unknown }>,
): void {
  const navigateToNext = rows.length === 1;
  for (const row of rows) {
    if (row.id == null) continue;
    action
      .execute(String(row.id), { navigateToNext })
      .catch(() => undefined);
  }
}

function InventoryClientLoaded({
  workspace = 'inventory',
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
  useInventoryModuleSubscription();
  const { t } = useTranslation();
  const { checkPermission, permissionsReady, currentUser } = useRBAC();
  const { identity, organizationId: sessionOrganizationId } = useErpSession();
  const { askForm, cancelForm, formDialog } = useFormDialog();
  const { orgId } = orgBigInts(organizationId);
  const selectedOperatingCompanyId =
    useDefaultOperatingCompanyBigInt(organizationId);
  const operatingCompanyId = selectedOperatingCompanyId ?? 0n;
  const [quickActionForm, setQuickActionForm] = useState<{
    form: FormConfig;
    action: string;
  } | null>(null);
  const [editProductRow, setEditProductRow] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [renameCategoryRow, setRenameCategoryRow] = useState<Record<string, unknown> | null>(null);
  const renameCategory = useRenameProductCategory(orgId);
  const renameCategoryEpoch = useRef(0);
  useEffect(() => { renameCategoryEpoch.current++; setRenameCategoryRow(null); }, [identity, sessionOrganizationId, organizationId, operatingCompanyId]);
  const [variantProductId, setVariantProductId] = useState<ScalarId | null>(
    null,
  );
  const [editWarehouseRow, setEditWarehouseRow] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [assignPickingId, setAssignPickingId] = useState<ScalarId | null>(null);
  const [moveQuantRow, setMoveQuantRow] = useState<StockQuant | null>(null);
  const [moveQuantError, setMoveQuantError] = useState<string | null>(null);
  const [partialTransferPicking, setPartialTransferPicking] =
    useState<StockPicking | null>(null);
  const [partialTransferError, setPartialTransferError] = useState<string | null>(null);
  const [assignQualityAlertId, setAssignQualityAlertId] =
    useState<ScalarId | null>(null);
  const [solveQualityAlertId, setSolveQualityAlertId] =
    useState<ScalarId | null>(null);
  const [selectedSerialRow, setSelectedSerialRow] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [selectedLotRow, setSelectedLotRow] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [blockSerialId, setBlockSerialId] = useState<ScalarId | null>(null);
  // Sync the active tab with `?tab=` so record links (e.g. a receipt's
  // `/inventory?tab=transfers&filter=id:…`) land on the right tab.
  const inventoryTabIds = useMemo(
    () => workspace === 'products' ? [...PRODUCT_CATALOG_TAB_IDS] : workspace === 'warehouse' ? [...WAREHOUSE_TAB_IDS] : [
      ...inventoryModuleConfig(t).tabs.map((tab) => tab.id),
      'cycle-wizard',
      'location-tree',
      'quality-alerts',
      '3d-view',
    ],
    [t, workspace],
  );
  const { activeTab, setActiveTab } = useModuleTab(
    workspace === 'products' ? 'products' : workspace === 'warehouse' ? 'stock' : 'dashboard',
    inventoryTabIds,
  );
  const [wizardCycleCountId, setWizardCycleCountId] = useState<ScalarId | ''>(
    '',
  );
  const [stockLocationFilter, setStockLocationFilter] = useState<string | null>(
    null,
  );
  const [createQualityAlertOpen, setCreateQualityAlertOpen] = useState(false);
  const [supplierLineProductId, setSupplierLineProductId] =
    useState<ScalarId | null>(null);
  const [packagingProductId, setPackagingProductId] = useState<ScalarId | null>(
    null,
  );
  const [csvKind, setCsvKind] = useState<InventoryCsvImportKind | null>(null);
  const [dashboardTimeRange, setDashboardTimeRange] =
    useState<TimeRangeValue>('30d');
  const openErpAiChat = useOpenErpAiChat();

  const productsRead = moduleCollection(useProducts(orgId, initialProducts));
  const products = productsRead.rows;
  const productsLoading = productsRead.state.status === 'loading';
  const productCategoriesRead = moduleCollection(useProductCategories(orgId, initialProductCategories));
  const productCategories = productCategoriesRead.rows;
  const uomsRead = moduleCollection(useUoms(orgId, initialUoms));
  const uoms = uomsRead.rows;
  const { data: stockInventories = [] } = useStockInventories(orgId);
  const { data: iotDevices = [] } = useIotDevices(orgId);
  const stockQuantsRead = moduleCollection(useStockQuants(orgId, initialStockQuants));
  const stockQuants = stockQuantsRead.rows;
  const stockQuantsLoading = stockQuantsRead.state.status === 'loading';
  const transfersRead = moduleCollection(useStockPickings(orgId, initialTransfers));
  const transfers = transfersRead.rows;
  const transfersLoading = transfersRead.state.status === 'loading';
  const warehousesRead = moduleCollection(useWarehouses(orgId, initialWarehouses));
  const warehouses = warehousesRead.rows;
  const adjustmentsRead = moduleCollection(useInventoryAdjustments(orgId, initialAdjustments));
  const adjustments = adjustmentsRead.rows;
  const locationsRead = moduleCollection(useStockLocations(orgId, initialStockLocations));
  const locations = locationsRead.rows;
  const lotsRead = moduleCollection(useProductionLots(orgId));
  const lots = lotsRead.rows;
  const serialsRead = moduleCollection(useStockProductionSerials(orgId, initialStockProductionSerials));
  const serials = serialsRead.rows;
  const qualityChecksRead = moduleCollection(useQualityChecks(orgId));
  const qualityChecks = qualityChecksRead.rows;
  const { data: qualityTeams = [] } = useQualityTeams(orgId);
  const cycleCountsRead = moduleCollection(useStockCycleCounts(orgId, initialStockCycleCounts));
  const cycleCounts = cycleCountsRead.rows;
  const pickingWavesRead = moduleCollection(usePickingWaves(orgId));
  const pickingWaves = pickingWavesRead.rows;
  const stockPackagesRead = moduleCollection(useStockPackages(orgId));
  const stockPackages = stockPackagesRead.rows;
  const warehouseTasksRead = moduleCollection(useWarehouseTasks(orgId));
  const warehouseTasks = warehouseTasksRead.rows;
  const stockRoutesRead = moduleCollection(useStockRoutes(orgId));
  const stockRoutes = stockRoutesRead.rows;
  const stockRulesRead = moduleCollection(useStockRules(orgId));
  const stockRules = stockRulesRead.rows;
  const stockMovesRead = moduleCollection(useStockMoves(orgId, initialStockMoves));
  const stockMoves = stockMovesRead.rows;
  const inventoryValuationsRead = moduleCollection(useInventoryValuations(orgId, initialInventoryValuations));
  const inventoryValuations = inventoryValuationsRead.rows;
  const replenishmentRulesListRead = moduleCollection(useReplenishmentRules(orgId, initialReplenishmentRules));
  const replenishmentRulesList = replenishmentRulesListRead.rows;
  const barcodeRulesRead = moduleCollection(useBarcodeRules(orgId));
  const barcodeRules = barcodeRulesRead.rows;
  const adjustmentReasonsRead = moduleCollection(useAdjustmentReasons(orgId));
  const adjustmentReasons = adjustmentReasonsRead.rows;
  const barcodeNomenclaturesRead = moduleCollection(useBarcodeNomenclatures(orgId));
  const barcodeNomenclatures = barcodeNomenclaturesRead.rows;
  const serialLotTraceabilityRead = moduleCollection(useSerialLotTraceability(orgId));
  const serialLotTraceability = serialLotTraceabilityRead.rows;
  const stockTraceabilityReportsRead = moduleCollection(useStockTraceabilityReports(orgId));
  const stockTraceabilityReports = stockTraceabilityReportsRead.rows;
  const shortAtpExceptionsRead = moduleCollection(useInventoryExceptionsShortAtp(orgId));
  const shortAtpExceptions = shortAtpExceptionsRead.rows;
  const expiredLotExceptionsRead = moduleCollection(useInventoryExceptionsExpiredLots(orgId));
  const expiredLotExceptions = expiredLotExceptionsRead.rows;
  const openQcExceptionsRead = moduleCollection(useInventoryExceptionsOpenQc(orgId));
  const openQcExceptions = openQcExceptionsRead.rows;
  const { data: orgUsers = [] } = useOrgUsers();
  const pricelistsRead = moduleCollection(usePricelists(orgId, initialPricelists));
  const pricelists = pricelistsRead.rows;
  const { data: contacts = [] } = useContacts(orgId);
  const { data: productSupplierInfos = [] } = useProductSupplierInfos(orgId);
  const { data: productPackagings = [] } = useProductPackagings(orgId);
  const { data: erpDocuments = [] } = useDocuments(orgId);
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
  };

  const csvFormConfig = useMemo(() => {
    if (!csvKind) return null;
    const titleKey: Record<InventoryCsvImportKind, string> = {
      uomCategory: 'inventory.csvImport.uomCategoriesTitle',
      uom: 'inventory.csvImport.uomsTitle',
      productCategory: 'inventory.csvImport.productCategoriesTitle',
      product: 'inventory.csvImport.productsTitle',
      productVariant: 'inventory.csvImport.variantsTitle',
      warehouse: 'inventory.csvImport.warehousesTitle',
      stockLocation: 'inventory.csvImport.locationsTitle',
      stockQuant: 'inventory.csvImport.quantsTitle',
      lot: 'inventory.csvImport.lotsTitle',
    };
    return csvImportForm(t, t(titleKey[csvKind]));
  }, [csvKind, t]);

  const pricelistFieldOptions = useMemo(() => {
    const fromApi = pricelistRowsToSelectOptions(pricelists);
    if (fromApi.length > 0) return fromApi;
    return [
      { value: '', label: t('common.lookup.noPricelists'), disabled: true },
    ];
  }, [pricelists, t]);

  const categoryFieldOptions = useMemo(() => {
    const fromApi = productCategoryRowsToSelectOptions(productCategories);
    if (fromApi.length > 0) return fromApi;
    return [
      { value: '', label: t('common.lookup.noCategories'), disabled: true },
    ];
  }, [productCategories, t]);

  const uomFieldOptions = useMemo(() => {
    const fromApi = uomRowsToSelectOptions(uoms);
    if (fromApi.length > 0) return fromApi;
    return [{ value: '', label: t('common.lookup.noUoms'), disabled: true }];
  }, [uoms, t]);

  const uomPoFieldOptions = useMemo(() => {
    const base = uomRowsToSelectOptions(uoms);
    if (base.length === 0)
      return [{ value: '', label: t('common.lookup.noUoms'), disabled: true }];
    return [
      {
        value: '',
        label: t('inventory.forms.newProduct.fields.uomPoSameAsSales'),
      },
      ...base,
    ];
  }, [uoms, t]);

  const productSelectOptions = useMemo(() => {
    const fromApi = productRowsToSelectOptions(products);
    if (fromApi.length > 0) return fromApi;
    return [
      { value: '', label: t('common.lookup.noProducts'), disabled: true },
    ];
  }, [products, t]);

  const productTemplateSelectOptions = useMemo(
    () =>
      productTemplateRowsToSelectOptions(products as Record<string, unknown>[]),
    [products],
  );

  const vendorSelectOptions = useMemo(() => {
    const fromApi = contactRowsToVendorSelectOptions(
      contacts as Record<string, unknown>[],
    );
    if (fromApi.length > 0) return fromApi;
    return [{ value: '', label: t('common.lookup.noVendors'), disabled: true }];
  }, [contacts, t]);

  const vendorNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const contact of contacts as Record<string, unknown>[]) {
      const name = String(contact.displayName ?? contact.name ?? '').trim();
      if (contact.id != null && name) map.set(String(contact.id), name);
    }
    return map;
  }, [contacts]);

  const documentSelectOptions = useMemo(
    () =>
      documentRowsToSelectOptions(erpDocuments as Record<string, unknown>[]),
    [erpDocuments],
  );

  const serialSelectOptions = useMemo(
    () => stockSerialRowsToSelectOptions(serials as Record<string, unknown>[]),
    [serials],
  );

  const lotSelectOptions = useMemo(
    () => stockLotRowsToSelectOptions(lots as Record<string, unknown>[]),
    [lots],
  );

  const stockMoveSelectOptions = useMemo(
    () => stockMoveRowsToSelectOptions(stockMoves as Record<string, unknown>[]),
    [stockMoves],
  );

  const traceRecordFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newTraceabilityRecordForm(t), {
        productId: productSelectOptions,
        documentId: documentSelectOptions,
        uomId: uomFieldOptions,
        serialId: serialSelectOptions,
        lotId: lotSelectOptions,
        moveId: stockMoveSelectOptions,
        partnerId: vendorSelectOptions,
      }),
    [
      t,
      productSelectOptions,
      documentSelectOptions,
      uomFieldOptions,
      serialSelectOptions,
      lotSelectOptions,
      stockMoveSelectOptions,
      vendorSelectOptions,
    ],
  );

  const productFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newProductForm(t), {
        pricelistId: pricelistFieldOptions,
        categId: categoryFieldOptions,
        uomId: uomFieldOptions,
        uomPoId: uomPoFieldOptions,
      }),
    [
      t,
      pricelistFieldOptions,
      categoryFieldOptions,
      uomFieldOptions,
      uomPoFieldOptions,
    ],
  );

  const transferFieldOptions = useMemo(() => {
    const picking = pickingTypeOptionsFromTransfers(transfers);
    const locs = locationOptionsFromQuantsAndTransfers(stockQuants, transfers);
    const emptyPicking =
      picking.length > 0
        ? picking
        : [
            {
              value: '',
              label: t('common.lookup.noStockMoves'),
              disabled: true,
            },
          ];
    const emptyLocs =
      locs.length > 0
        ? locs
        : [
            {
              value: '',
              label: t('common.lookup.noStockMoves'),
              disabled: true,
            },
          ];
    return { picking, locs, emptyPicking, emptyLocs };
  }, [transfers, stockQuants, t]);

  const transferFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newTransferForm(t), {
        pickingTypeId: transferFieldOptions.emptyPicking,
        locationId: transferFieldOptions.emptyLocs,
        locationDestId: transferFieldOptions.emptyLocs,
      }),
    [t, transferFieldOptions],
  );

  const traceabilityReportFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newTraceabilityReportForm(t), {
        productIds: productSelectOptions,
        lotIds: lotSelectOptions,
        serialIds: serialSelectOptions,
        locationIds: stockLocationRowsToSelectOptions(locations),
        warehouseIds: warehouseRowsToSelectOptions(warehouses),
        partnerIds: linkedRecordOptions(contacts, (contact) => contact.displayName ?? contact.name),
        pickingTypeIds: transferFieldOptions.picking,
      }),
    [
      t,
      productSelectOptions,
      lotSelectOptions,
      serialSelectOptions,
      locations,
      warehouses,
      contacts,
      transferFieldOptions,
    ],
  );

  const adjustmentFieldOptions = useMemo(() => {
    const prod = productRowsToSelectOptions(products);
    const locs = locationOptionsFromQuantsAndTransfers(stockQuants, transfers);
    return {
      product:
        prod.length > 0
          ? prod
          : [
              {
                value: '',
                label: t('common.lookup.noProducts'),
                disabled: true,
              },
            ],
      location:
        locs.length > 0
          ? locs
          : [
              {
                value: '',
                label: t('common.lookup.noStockMoves'),
                disabled: true,
              },
            ],
    };
  }, [products, stockQuants, transfers, t]);

  const adjustmentFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newInventoryAdjustmentForm(t), {
        productId: adjustmentFieldOptions.product,
        locationId: adjustmentFieldOptions.location,
      }),
    [t, adjustmentFieldOptions],
  );

  const createProduct = useCreateProduct(orgId);
  const createStockPicking = useCreateStockPicking(orgId, {
    companyId: operatingCompanyId ?? undefined,
  });
  const createInventoryAdjustment = useCreateInventoryAdjustment(orgId);

  const createStockLocation = useCreateStockLocation(orgId);
  const updateStockLocation = useUpdateStockLocation(orgId);
  const createWarehouse = useCreateWarehouse(orgId, selectedOperatingCompanyId);
  const updateWarehouse = useUpdateWarehouse(orgId, selectedOperatingCompanyId);
  const deleteWarehouse = useDeleteWarehouse(orgId, selectedOperatingCompanyId);
  const updateProduct = useUpdateProduct(orgId);
  const deleteProduct = useDeleteProduct(orgId);
  const createProductVariant = useCreateProductVariant(orgId);
  const deleteStockLocation = useDeleteStockLocation(orgId);

  const assignUserToPicking = useAssignUserToPicking(orgId, operatingCompanyId);
  const workflowSurface = useWorkflowSurface({ organizationId });
  const stockQuantWorkflow = useStockQuantWorkflow(
    orgId,
    operatingCompanyId,
    {
      navigate: workflowSurface.navigate,
      notify: workflowSurface.notify,
      record: workflowSurface.record,
    },
  );
  const pickingWorkflow = usePickingWorkflow(
    orgId,
    operatingCompanyId,
    {
      confirm: t('inventory.transferActions.confirm'),
      assign: t('inventory.transferActions.assign'),
      validate: t('inventory.transferActions.validate'),
      // Partial delivery is a Sales fulfillment form; transfers only pack, validate in full or cancel.
      partialValidate: t('sales.fulfillment.actions.partialValidate'),
      pack: t('sales.fulfillment.actions.pack'),
      cancel: t('inventory.transferActions.cancel'),
    },
    {
      navigate: workflowSurface.navigate,
      notify: workflowSurface.notify,
      record: workflowSurface.record,
    },
  );

  const reserveQuant = useReserveStockQuant(orgId, operatingCompanyId);
  const unreserveQuant = useUnreserveStockQuant(orgId, operatingCompanyId);

  const locationParentOptions = useMemo(() => {
    const opts = locations.map((loc) => ({
      value: String(loc.id),
      label: String(loc.completeName ?? loc.name ?? loc.id),
    }));
    return [
      {
        value: '',
        label: t('inventory.forms.newStockLocation.fields.parentNone'),
      },
      ...opts,
    ];
  }, [locations, t]);

  const stockLocationFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newStockLocationForm(t), {
        parentLocationId: locationParentOptions,
      }),
    [t, locationParentOptions],
  );

  const warehouseTemplateOptions = useMemo(() => {
    if (warehouses.length === 0)
      return [
        { value: '', label: t('common.lookup.noWarehouses'), disabled: true },
      ];
    return warehouses.map((w) => ({
      value: String(w.id),
      label: `${String(w.name ?? '')} (${String(w.code ?? w.id)})`,
    }));
  }, [warehouses, t]);

  const warehouseFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newWarehouseForm(t), {
        templateWarehouseId: warehouseTemplateOptions,
      }),
    [t, warehouseTemplateOptions],
  );

  const assignUserFieldOptions = useMemo(() => {
    const rows = orgUsers as Record<string, unknown>[];
    const opts = rows
      .map((u) => {
        const id = String(u.identity ?? u.userIdentity ?? '');
        if (!id) return null;
        return {
          value: id,
          label: String(u.name ?? u.email ?? u.username ?? id).slice(0, 80),
        };
      })
      .filter((x): x is { value: string; label: string } => x != null);
    return [{ value: '', label: '—' }, ...opts];
  }, [orgUsers]);

  const assignUserFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(assignUserToPickingForm(t), {
        userIdentity: assignUserFieldOptions,
      }),
    [t, assignUserFieldOptions],
  );

  const assignQualityAlertFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(assignQualityAlertForm(t), {
        userIdentity: assignUserFieldOptions,
      }),
    [t, assignUserFieldOptions],
  );

  const qualityTeamOptions = useMemo(
    () =>
      qualityTeams.map((team) => ({
        value: String(team.id ?? ''),
        label: String(
          team.name ??
            team.id ??
            '',
        ),
      })),
    [qualityTeams],
  );

  const qualityAlertCreateFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newQualityAlertForm(t), {
        productId: productRowsToSelectOptions(products),
        teamId: qualityTeamOptions,
        pickingId: transfers.map((tr) => ({
          value: String(tr.id ?? ''),
          label: String(tr.name ?? tr.origin ?? tr.id ?? ''),
        })),
      }),
    [t, products, qualityTeamOptions, transfers],
  );

  const serialDetailModalConfig = useMemo((): FormConfig => {
    const base = serialDetailForm(t);
    if (!selectedSerialRow) return base;
    return {
      ...base,
      sections: base.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) => {
          const value =
            field.name === 'isLocked'
              ? selectedSerialRow.isLocked
                ? 'Yes'
                : 'No'
              : selectedSerialRow[field.name] != null
                ? String(selectedSerialRow[field.name])
                : field.defaultValue != null
                  ? String(field.defaultValue)
                  : undefined;
          return { ...field, defaultValue: value };
        }),
      })),
    } as FormConfig;
  }, [t, selectedSerialRow]);

  const lotDetailModalConfig = useMemo((): FormConfig => {
    const base = lotDetailForm(t);
    if (!selectedLotRow) return base;
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
                : undefined;
          return { ...field, defaultValue: value };
        }),
      })),
    } as FormConfig;
  }, [t, selectedLotRow]);

  const editProductModalConfig = useMemo(() => {
    if (!editProductRow) return editProductForm(t);
    return withDefaultsFromRow(editProductForm(t), editProductRow);
  }, [t, editProductRow]);

  const qcLocationOptions = useMemo(() => {
    const opts = locations.map((loc) => ({
      value: String(loc.id),
      label: String(loc.completeName ?? loc.name ?? loc.id),
    }));
    return [
      { value: '', label: t('inventory.forms.editWarehouse.fields.qcStockLocNone') },
      ...opts,
    ];
  }, [locations, t]);

  const editWarehouseModalConfig = useMemo(() => {
    const base = mergeSelectOptionsForFields(editWarehouseForm(t), {
      whQcStockLocId: qcLocationOptions,
    });
    if (!editWarehouseRow) return base;
    return withDefaultsFromRow(base, editWarehouseRow);
  }, [t, editWarehouseRow, qcLocationOptions]);

  // 3D viewer — use first warehouse found (or 0n as a no-op before warehouses load)
  const firstWarehouseId = warehouses[0]?.id
    ? BigInt(String(warehouses[0].id))
    : 0n;
  const {
    zones,
    slots,
    items: warehouseItems,
  } = useWarehouse3D(orgId, operatingCompanyId, firstWarehouseId);

  // Quality management hooks
  const createQualityCheck = useCreateQualityCheck(orgId, operatingCompanyId);

  const createQualityAlert = useCreateQualityAlert(orgId, operatingCompanyId);
  const assignQualityAlert = useAssignQualityAlert(orgId, operatingCompanyId);
  const cancelQualityAlert = useCancelQualityAlert(orgId, operatingCompanyId);
  const createQualityPoint = useCreateQualityPoint(orgId, operatingCompanyId);

  const deleteQualityPoint = useDeleteQualityPoint(orgId, operatingCompanyId);
  const createQualityTeam = useCreateQualityTeam(orgId, operatingCompanyId);

  const deleteQualityTeam = useDeleteQualityTeam(orgId, operatingCompanyId);

  // Barcode hooks
  const createBarcodeRule = useCreateBarcodeRule(orgId, operatingCompanyId);
  const updateBarcodeRule = useUpdateBarcodeRule(orgId, operatingCompanyId);

  const recordBarcodeScan = useRecordBarcodeScan(orgId, operatingCompanyId);

  const createAdjustmentReason = useCreateAdjustmentReason(
    orgId,
    operatingCompanyId,
  );

  const blockSerial = useSerialBlockWorkflow(orgId, workflowSurface);

  const createTraceabilityRecord = useCreateTraceabilityRecord(
    orgId,
    operatingCompanyId,
  );
  const createTraceabilityReport = useCreateTraceabilityReport(
    orgId,
    operatingCompanyId,
  );
  const runTraceabilityReport = useRunTraceabilityReport(
    orgId,
    operatingCompanyId,
  );

  // Replenishment hooks
  const createReplenishmentRule = useCreateReplenishmentRule(
    orgId,
    operatingCompanyId,
  );

  // Picking wave hooks
  const createPickingWave = useCreatePickingWave(orgId, operatingCompanyId);

  // Product category hooks
  const createProductCategory = useCreateProductCategory(
    orgId,
    operatingCompanyId,
  );
  const updateProductCategory = useUpdateProductCategory(
    orgId,
    operatingCompanyId,
  );
  const deleteProductCategory = useDeleteProductCategory(
    orgId,
    operatingCompanyId,
  );

  // Stock routes and rules hooks
  const createStockRoute = useCreateStockRoute(orgId, operatingCompanyId);
  const updateStockRoute = useUpdateStockRoute(orgId, operatingCompanyId);

  const createStockRule = useCreateStockRule(orgId, operatingCompanyId);
  const updateStockRule = useUpdateStockRule(orgId, operatingCompanyId);

  // Warehouse task hooks
  const createWarehouseTask = useCreateWarehouseTask(orgId, operatingCompanyId);

  const openQualityAlert = useOpenQualityAlert(
    orgId,
    selectedOperatingCompanyId,
  );
  const solveQualityAlert = useSolveQualityAlert(
    orgId,
    selectedOperatingCompanyId,
  );

  const createStockQuant = useCreateStockQuant(orgId, {
    companyId: operatingCompanyId ?? undefined,
  });
  const updateStockQuantQuantity = useUpdateStockQuantQuantity(
    orgId,
    operatingCompanyId,
  );

  const updateProductVariant = useUpdateProductVariant(
    orgId,
    operatingCompanyId,
  );
  const updateProductInventoryData = useUpdateProductInventoryData(
    orgId,
    operatingCompanyId,
  );
  const updateProductPricing = useUpdateProductPricing(
    orgId,
    operatingCompanyId,
  );
  const createUomCategory = useCreateUomCategory(orgId, operatingCompanyId);
  const createUom = useCreateUom(orgId, operatingCompanyId);
  const createUomConversion = useCreateUomConversion(orgId, operatingCompanyId);
  const createWarehouse3dZone = useCreateWarehouse3dZone(orgId);
  const updateWarehouse3dZone = useUpdateWarehouse3dZone(orgId);
  const deleteWarehouse3dZone = useDeleteWarehouse3dZone(orgId);

  const createProductSupplierInfo = useCreateProductSupplierInfo(orgId);
  const updateProductSupplierInfo = useUpdateProductSupplierInfo(orgId);
  const createProductPackaging = useCreateProductPackaging(orgId);
  const updateProductPackaging = useUpdateProductPackaging(orgId);
  const restoreProductCategory = useRestoreProductCategory(orgId);
  const upsertWarehouseGeo = useUpsertWarehouseGeo(orgId);

  // Field labels for the action dialogs below.
  const lbl = useMemo(
    () => ({
      product: t('inventory.byRecord.product', { defaultValue: 'Product' }),
      uom: t('inventory.byRecord.uom', { defaultValue: 'Unit of measure' }),
      fromUom: t('inventory.byRecord.fromUom', { defaultValue: 'From unit' }),
      toUom: t('inventory.byRecord.toUom', { defaultValue: 'To unit' }),
      category: t('inventory.byRecord.uomCategory', { defaultValue: 'Category' }),
      sourceLocation: t('inventory.byRecord.sourceLocation', { defaultValue: 'Source location' }),
      destLocation: t('inventory.byRecord.destLocation', { defaultValue: 'Destination location' }),
      location: t('inventory.byRecord.location', { defaultValue: 'Location' }),
      quarantineLocation: t('inventory.byRecord.quarantineLocation', { defaultValue: 'Quarantine location' }),
      inventory: t('inventory.byRecord.inventoryCount', { defaultValue: 'Inventory count' }),
      device: t('inventory.byRecord.device', { defaultValue: 'IoT device' }),
      rule: t('inventory.byRecord.barcodeRule', { defaultValue: 'Barcode rule' }),
      status: t('inventory.byRecord.status', { defaultValue: 'Status' }),
      failReason: t('inventory.byRecord.failReason', { defaultValue: 'Reason for failure' }),
      whatsappAccount: t('inventory.byRecord.whatsappAccountId', { defaultValue: 'WhatsApp account ID' }),
      qualityRating: t('inventory.byRecord.qualityRating', { defaultValue: 'Quality rating' }),
    }),
    [t],
  );

  // UoM categories have no list query yet, so offer the categories of the
  // units that already exist, named after their first few units.
  const uomCategoryOptions = useMemo(() => {
    const unitsByCategory = new Map<string, string[]>();
    for (const uom of uoms as Record<string, unknown>[]) {
      const categoryId = String(uom.categoryId ?? uom.category_id ?? '');
      if (categoryId === '') continue;
      unitsByCategory.set(categoryId, [
        ...(unitsByCategory.get(categoryId) ?? []),
        String(uom.name ?? uom.id),
      ]);
    }
    return [...unitsByCategory].map(([value, names]) => ({
      value,
      label: names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : ''),
    }));
  }, [uoms]);

  const stockInventoryOptions = useMemo(
    () =>
      recordOptions(stockInventories as Record<string, unknown>[], (inv) =>
        inv.state
          ? `${String(inv.name ?? `#${inv.id}`)} (${String(inv.state)})`
          : String(inv.name ?? `#${inv.id}`),
      ),
    [stockInventories],
  );

  const iotDeviceOptions = useMemo(
    () =>
      recordOptions(iotDevices as Record<string, unknown>[], (device) =>
        String(device.name ?? `#${device.id}`),
      ),
    [iotDevices],
  );

  const barcodeRuleOptions = useMemo(
    () =>
      recordOptions(barcodeRules as Record<string, unknown>[], (rule) =>
        String(rule.name ?? `#${rule.id}`),
      ),
    [barcodeRules],
  );

  const stockInventoryStateOptions = useMemo(
    () =>
      (['draft', 'confirm', 'validate', 'cancel'] as const).map((state) => ({
        value: state,
        label: t(`inventory.inventoryAdjustments.states.${state}`),
      })),
    [t],
  );

  const warehouseTaskStatusOptions = useMemo(
    () => [
      { value: 'pending', label: t('inventory.byRecord.taskPending', { defaultValue: 'Pending' }) },
      { value: 'in_progress', label: t('inventory.byRecord.taskInProgress', { defaultValue: 'In progress' }) },
      { value: 'done', label: t('inventory.byRecord.taskDone', { defaultValue: 'Done' }) },
      { value: 'cancelled', label: t('inventory.byRecord.taskCancelled', { defaultValue: 'Cancelled' }) },
    ],
    [t],
  );

  const stockOnHandLocationOptions = useMemo(() => {
    const opts = locations.map((loc) => ({
      value: String(loc.id),
      label: String(loc.completeName ?? loc.name ?? loc.id),
    }));
    return opts.length > 0
      ? opts
      : [{ value: '', label: t('common.lookup.noStockMoves'), disabled: true }];
  }, [locations, t]);

  const stockQuantFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newStockQuantForm(t), {
        productId: productRowsToSelectOptions(products),
        locationId: stockOnHandLocationOptions,
      }),
    [t, products, stockOnHandLocationOptions],
  );

  const openCreateProduct = useCallback(
    () =>
      setQuickActionForm({ form: productFormConfig, action: 'createProduct' }),
    [productFormConfig],
  );

  const openCreateTransfer = useCallback(
    () =>
      setQuickActionForm({
        form: transferFormConfig,
        action: 'createStockPicking',
      }),
    [transferFormConfig],
  );

  const openCreateStockQuant = useCallback(
    () =>
      setQuickActionForm({
        form: stockQuantFormConfig,
        action: 'createStockQuant',
      }),
    [stockQuantFormConfig],
  );

  const productLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of products) {
      const row = product as Record<string, unknown>;
      map.set(
        String(row.id),
        inventoryProductPrimaryLabel(row) || String(row.name ?? row.id),
      );
    }
    return map;
  }, [products]);

  const assignedMovesForPartialTransfer = useMemo(() => {
    if (!partialTransferPicking) return [];
    const pickingId = String(partialTransferPicking.id ?? '');
    return stockMoves.filter(
      (move) =>
        String(move.pickingId ?? '') === pickingId &&
        move.state.toLowerCase() === 'assigned',
    );
  }, [partialTransferPicking, stockMoves]);

  const partialTransferFormConfig = useMemo(() => {
    if (!partialTransferPicking) return null;
    const pickingName = String(
      partialTransferPicking.name ??
        partialTransferPicking.origin ??
        partialTransferPicking.id ??
        '',
    );
    return buildPartialDeliveryForm(
      t,
      pickingName,
      assignedMovesForPartialTransfer.map((move) => {
        const moveId = String(move.id ?? '');
        const productId = String(move.productId);
        return {
          moveId,
          productLabel:
            productLabelById.get(productId) ?? `Product ${productId}`,
          orderedQty: move.productUomQty,
        };
      }),
    );
  }, [
    partialTransferPicking,
    assignedMovesForPartialTransfer,
    productLabelById,
    t,
  ]);

  const locationLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const location of locations) {
      map.set(
        String(location.id),
        String(location.completeName ?? location.name ?? location.id),
      );
    }
    return map;
  }, [locations]);

  const moveQuantFormConfig = useMemo((): FormConfig | null => {
    if (!moveQuantRow) return null;
    const sourceLocationId = String(moveQuantRow.locationId);
    const targetOptions = locations
      .filter(
        (location) =>
          location.active !== false && String(location.id) !== sourceLocationId,
      )
      .map((location) => ({
        value: String(location.id),
        label: String(location.completeName ?? location.name ?? location.id),
      }));
    const available = Number(
      moveQuantRow.availableQuantity ?? moveQuantRow.quantity ?? 0,
    );
    return {
      id: 'move-stock-quant',
      title: t('inventory.forms.newTransfer.title'),
      description: t('inventory.forms.newTransfer.description'),
      submitLabel: t('common.save'),
      cancelLabel: t('common.cancel'),
      sections: [
        {
          id: 'move-stock-quant',
          fields: [
            {
              id: 'targetLocationId',
              name: 'targetLocationId',
              type: 'select',
              label: t('inventory.forms.newTransfer.fields.locationDestId'),
              required: true,
              width: 'full',
              options:
                targetOptions.length > 0
                  ? targetOptions
                  : [
                      {
                        value: '',
                        label: t('common.lookup.noStockMoves'),
                        disabled: true,
                      },
                    ],
            },
            {
              id: 'quantity',
              name: 'quantity',
              type: 'number',
              label: t('inventory.stockOnHand.columns.availableQuantity'),
              required: true,
              width: '1/2',
              defaultValue: Math.min(1, Math.max(available, 0)),
            },
          ],
        },
      ],
    };
  }, [moveQuantRow, locations, t]);

  const productsEntityConfig = useMemo((): EntityViewConfig => {
    const table = productsTableConfig(t, {
      formatProductDisplayName: workspace === 'products' ? undefined : inventoryProductPrimaryLabel,
      onEmptyAction: openCreateProduct,
    });
    const base = workspace === 'products' ? productCatalogTable(table, productCategories, t) : table;
    const view = base.view as EntityTableConfig;
    return withInlineEdits(
      {
        ...base,
        view: {
          ...view,
          emptyState: {
            ...view.emptyState,
            onAction: openCreateProduct,
          },
        },
      },
      {
        name: {
          kind: 'text',
          canEdit: workspace === 'products' ? () => permissionsReady !== false && checkPermission('product', 'write').allowed : undefined,
          save: async (row, value) => {
            const name = requiredInlineText(
              value,
              t('inventory.inlineEdit.nameRequired', { defaultValue: 'A product needs a name' }),
            );
            await updateProduct.mutateAsync({ productId: row.id as string | number, params: { name } });
          },
        },
        standardPrice: {
          kind: 'number',
          canEdit: workspace === 'products' ? () => permissionsReady !== false && checkPermission('product', 'write').allowed : undefined,
          save: async (row, value) => {
            const standardPrice = inlineNumberAtLeast(
              value,
              0,
              t('inventory.inlineEdit.priceInvalid', { defaultValue: 'Enter a price of 0 or more' }),
            );
            await updateProduct.mutateAsync({ productId: row.id as string | number, params: { standardPrice } });
          },
        },
      },
    );
  }, [t, openCreateProduct, updateProduct, workspace, productCategories, checkPermission, permissionsReady]);

  const stockEntityConfig = useMemo((): EntityViewConfig => {
    const base = stockQuantsTableConfig(t, {
      onEmptyAction: openCreateStockQuant,
    });
    const view = base.view as EntityTableConfig;
    return {
      ...base,
      view: {
        ...view,
        emptyState: {
          ...view.emptyState,
          onAction: openCreateStockQuant,
        },
        actions: [
          ...(view.actions ?? []),
          {
            id: 'move-stock-quant',
            label: t('inventory.forms.newTransfer.title'),
            icon: Route,
            requiresSelection: true,
            isApplicable: (rows) =>
              rows.length === 1 &&
              Number(
                rows[0]?.availableQuantity ??
                  rows[0]?.available_quantity ??
                  rows[0]?.quantity ??
                  0,
              ) > 0,
            onClick: (rows) => {
              const selectedId = rows[0]?.id;
              const quant = stockQuants.find(
                (row) => String(row.id) === String(selectedId),
              );
              if (!quant) return;
              setMoveQuantError(null);
              setMoveQuantRow(quant);
            },
          },
        ],
      },
    };
  }, [t, openCreateStockQuant, stockQuants]);

  const transfersEntityConfig = useMemo((): EntityViewConfig => {
    const base = transfersTableConfig(t, { onEmptyAction: openCreateTransfer });
    const view = base.view as EntityTableConfig;
    return {
      ...base,
      view: {
        ...view,
        emptyState: {
          ...view.emptyState,
          onAction: openCreateTransfer,
        },
      },
    };
  }, [t, openCreateTransfer]);

  const productRecordSheet = useMemo((): EntityRecordSheetConfig => {
    const status = productStatusBadges(t);
    return {
      titleKey: 'sheetTitle',
      statusKey: 'type',
      statusBadgeVariants: status.badgeVariants,
      statusBadgeLabels: status.badgeLabels,
      detailConfig: workspace === 'products' ? productCatalogDetail(productDetailConfig(t), t) : productDetailConfig(t),
      auditTableName: 'product',
      discussion: {},
      customTabs: [
        {
          id: 'variants',
          label: t('inventory.productTabs.variants.title', { defaultValue: 'Variants' }),
          content: (record) => <ProductVariantsTab orgId={orgId} record={record} />,
        },
        {
          id: 'vendor-prices',
          label: t('inventory.productTabs.vendors.title', { defaultValue: 'Vendor prices' }),
          content: (record) => (
            <ProductVendorPricesTab orgId={orgId} record={record} vendorNameById={vendorNameById} />
          ),
        },
        {
          id: 'packaging',
          label: t('inventory.productTabs.packaging.title', { defaultValue: 'Packaging' }),
          content: (record) => <ProductPackagingTab orgId={orgId} record={record} />,
        },
      ],
    };
  }, [t, orgId, vendorNameById, workspace]);

  const stockQuantRecordSheet = useMemo((): EntityRecordSheetConfig => {
    const baseDetail = workspace === 'warehouse' ? warehouseStockDetail(stockQuantDetailConfig(t), t) : stockQuantDetailConfig(t);
    const detailConfig = {
      ...baseDetail,
      sections: baseDetail.sections.map((section) =>
        section.id === 'stock'
          ? {
              ...section,
              fields: section.fields.map((field) => {
                if (field.key === 'productId') {
                  return {
                    ...field,
                    render: (
                      _value: unknown,
                      record: Record<string, unknown>,
                    ) => {
                      const productId = record.productId ?? record.product_id;
                      if (productId == null) return '—';
                      return (
                        productLabelById.get(String(productId)) ?? '(deleted)'
                      );
                    },
                  };
                }
                if (field.key === 'locationId') {
                  return {
                    ...field,
                    render: (
                      _value: unknown,
                      record: Record<string, unknown>,
                    ) => {
                      const locationId =
                        record.locationId ?? record.location_id;
                      if (locationId == null) return '—';
                      return (
                        locationLabelById.get(String(locationId)) ?? '(deleted)'
                      );
                    },
                  };
                }
                return field;
              }),
            }
          : section,
      ),
    };
    return {
      titleKey: 'sheetTitle',
      detailConfig,
      auditTableName: 'stock_quant',
    };
  }, [t, productLabelById, locationLabelById, workspace]);

  const locationRecordSheet = useMemo((): EntityRecordSheetConfig => ({
    titleKey: 'name',
    detailConfig: stockLocationDetailConfig(t),
    auditTableName: 'stock_location',
  }), [t]);

  const transferRecordSheet = useMemo((): EntityRecordSheetConfig => {
    const status = transferStatusBadges(t);
    const movesConfig = stockMovesTableConfig(t);
    const baseDetail = transferDetailConfig(t);
    const detailConfig = {
      ...baseDetail,
      sections: baseDetail.sections.map((section) =>
        section.id === 'locations'
          ? {
              ...section,
              fields: section.fields.map((field) => {
                if (field.key === 'locationId') {
                  return {
                    ...field,
                    render: (
                      _value: unknown,
                      record: Record<string, unknown>,
                    ) => {
                      const locationId =
                        record.locationId ?? record.location_id;
                      if (locationId == null) return '—';
                      const cached = locationLabelById.get(String(locationId));
                      if (cached != null) return cached;
                      const embedded =
                        record.locationIdName ?? record.location_id_name;
                      return embedded != null ? String(embedded) : '(deleted)';
                    },
                  };
                }
                if (field.key === 'locationDestId') {
                  return {
                    ...field,
                    render: (
                      _value: unknown,
                      record: Record<string, unknown>,
                    ) => {
                      const locationId =
                        record.locationDestId ?? record.location_dest_id;
                      if (locationId == null) return '—';
                      const cached = locationLabelById.get(String(locationId));
                      if (cached != null) return cached;
                      const embedded =
                        record.locationDestIdName ??
                        record.location_dest_id_name;
                      return embedded != null ? String(embedded) : '(deleted)';
                    },
                  };
                }
                return field;
              }),
            }
          : section,
      ),
    };
    return {
      titleKey: 'sheetTitle',
      statusKey: 'state',
      statusBadgeVariants: status.badgeVariants,
      statusBadgeLabels: status.badgeLabels,
      detailConfig,
      auditTableName: 'stock_picking',
      discussion: {},
      openHref: transferRecordHref,
      customTabs: [
        {
          id: 'moves',
          label: t('inventory.stockMoves.title'),
          content: (record) => {
            const pickingId = String(record.id ?? '');
            const moves = (stockMoves as Record<string, unknown>[]).filter(
              (move) => String(move.pickingId ?? move.picking_id) === pickingId,
            );
            return (
              <EntityView
                config={{
                  ...movesConfig,
                  title: '',
                  description: undefined,
                }}
                data={moves}
                useCard={false}
              />
            );
          },
        },
      ],
    };
  }, [t, stockMoves, locationLabelById]);

  const warehouse3dZoneFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newWarehouse3dZoneForm(t), {
        warehouseId: warehouses.map((w) => ({
          value: String(w.id),
          label: String(w.name ?? w.id),
        })),
        locationId: stockOnHandLocationOptions,
      }),
    [t, warehouses, stockOnHandLocationOptions],
  );

  const currencyIdFromPricelistsOptions = useMemo(() => {
    const seen = new Set<number>();
    const opts: { value: string; label: string }[] = [];
    for (const p of pricelists) {
      const cid = p.currencyId;
      if (cid == null) continue;
      const n = Number(cid);
      if (seen.has(n)) continue;
      seen.add(n);
      opts.push({
        value: String(n),
        label: `${String(p.name ?? 'Pricelist')} (${n})`,
      });
    }
    return opts.length > 0
      ? opts
      : [{ value: '', label: t('common.lookup.noPricelists'), disabled: true }];
  }, [pricelists, t]);

  const productSupplierLineFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newProductSupplierLineForm(t), {
        productTmplId: productTemplateSelectOptions,
        partnerId: vendorSelectOptions,
        currencyId: currencyIdFromPricelistsOptions,
      }),
    [
      t,
      productTemplateSelectOptions,
      vendorSelectOptions,
      currencyIdFromPricelistsOptions,
    ],
  );

  const productPackagingFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newProductPackagingForm(t), {
        uomId: uomFieldOptions,
      }),
    [t, uomFieldOptions],
  );

  const moduleConfig = useMemo(() => inventoryModuleConfig(t), [t]);

  // Only render the 3D viewer on the client to avoid SSR/hydration tree mismatches
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);

  const liveSections = useMemo(() => {
    const { startMs, endMs } = timeRangeToMs(dashboardTimeRange);
    const previousRange = previousPeriodMs(dashboardTimeRange);
    const inCurrentRange = (row: Record<string, unknown>) =>
      isTimestampInRange(recordTimestampMs(row), startMs, endMs);
    const inPreviousRange = (row: Record<string, unknown>) =>
      isTimestampInRange(
        recordTimestampMs(row),
        previousRange.startMs,
        previousRange.endMs,
      );

    const totalSkus = products.length;
    const stockValue = stockQuants.reduce(
      (s, q) => s + Number(q.value ?? 0),
      0,
    );
    const zeroStock = stockQuants.filter(
      (q) => Number(q.availableQuantity ?? 0) <= 0,
    ).length;
    const pendingTransfers = transfers.filter(
      (transfer) =>
        String(transfer.state) === 'confirmed' ||
        String(transfer.state) === 'assigned',
    ).length;
    const currentTransfers = transfers.filter((transfer) =>
      inCurrentRange(transfer as Record<string, unknown>),
    ).length;
    const previousTransfers = transfers.filter((transfer) =>
      inPreviousRange(transfer as Record<string, unknown>),
    ).length;
    const currentAdjustments = adjustments.filter((a) =>
      inCurrentRange(a as Record<string, unknown>),
    ).length;
    const previousAdjustments = adjustments.filter((a) =>
      inPreviousRange(a as Record<string, unknown>),
    ).length;

    return mapDashboardWidgets(moduleConfig, (w) => {
      if (w.type === 'stat-cards') {
        return {
          ...w,
          data: {
            stats: [
              {
                label: t('inventory.dashboard.totalSKUs'),
                value: totalSkus.toString(),
                icon: 'Package',
              },
              {
                label: t('inventory.dashboard.stockValue'),
                value: `$${stockValue.toLocaleString()}`,
                icon: 'DollarSign',
              },
              {
                label: t('inventory.dashboard.zeroStockAlerts'),
                value: zeroStock.toString(),
                change: percentChange(currentAdjustments, previousAdjustments),
                icon: 'AlertTriangle',
              },
              {
                label: t('inventory.dashboard.pendingTransfers'),
                value: pendingTransfers.toString(),
                change: percentChange(currentTransfers, previousTransfers),
                icon: 'Truck',
              },
            ],
          },
        };
      }
      if (w.type === 'quick-actions') {
        const handlers: Record<string, () => void> = {
          create_product: () =>
            setQuickActionForm({
              form: productFormConfig,
              action: 'createProduct',
            }),
          create_transfer: () =>
            setQuickActionForm({
              form: transferFormConfig,
              action: 'createStockPicking',
            }),
          create_adjustment: () =>
            setQuickActionForm({
              form: adjustmentFormConfig,
              action: 'createInventoryAdjustment',
            }),
        };
        return {
          ...w,
          data: {
            ...w.data,
            actions: w.data.actions.map((a) => ({
              ...a,
              onClick: handlers[a.id],
            })),
          },
        };
      }
      if (w.id === 'inv-by-category') {
        // Group by costMethod as a proxy for category
        const byType = groupBy(stockQuants, (q) =>
          String(q.costMethod ?? 'Standard'),
        );
        const colors = ['#6366f1', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444'];
        const allQty = stockQuants.reduce(
          (s, q) => s + Number(q.availableQuantity ?? 0),
          0,
        );
        const metrics = Object.entries(byType)
          .map(([label, quants]) => ({
            label,
            value: Math.round(
              quants.reduce((s, q) => s + Number(q.availableQuantity ?? 0), 0),
            ),
            max: Math.max(1, Math.round(allQty)),
            color: '#6366f1',
          }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 5)
          .map((m, i) => ({ ...m, color: colors[i] ?? '#6366f1' }));
        return { ...w, data: { metrics } };
      }
      if (w.id === 'inv-movements') {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const nowMs = Date.now();
        const sevenDaysAgo = nowMs - 7 * 86400000;
        const dayIn: Record<string, number> = {};
        const dayOut: Record<string, number> = {};
        const orderedDays: string[] = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date(nowMs - i * 86400000);
          const label = days[d.getDay()];
          if (!orderedDays.includes(label)) orderedDays.push(label);
          dayIn[label] = 0;
          dayOut[label] = 0;
        }
        for (const t of transfers) {
          const ms = Number(t.scheduledDate ?? 0) / 1000;
          if (ms < sevenDaysAgo || ms > nowMs) continue;
          const label = days[new Date(ms).getDay()];
          if (
            String(t.pickingCode ?? '')
              .toLowerCase()
              .includes('in')
          ) {
            dayIn[label] = (dayIn[label] ?? 0) + 1;
          } else {
            dayOut[label] = (dayOut[label] ?? 0) + 1;
          }
        }
        const values = orderedDays.map((day) => ({
          day,
          In: dayIn[day] ?? 0,
          Out: dayOut[day] ?? 0,
        }));
        return {
          ...w,
          data: { ...(w.data as Record<string, unknown>), values },
        };
      }
      if (w.id === 'inventory-stock-turnover') {
        const movesByProduct = groupBy(
          stockMoves as Record<string, unknown>[],
          (m) => {
            const pid = String(m.productId ?? m.product_id ?? '');
            const product = products.find((p) => String(p.id) === pid);
            return String(
              product?.name ??
                t('inventory.dashboard.productFallback', { id: pid.slice(-4) }),
            );
          },
        );
        const values = Object.entries(movesByProduct)
          .map(([product, moves]) => ({ product, Moves: moves.length }))
          .sort((a, b) => b.Moves - a.Moves)
          .slice(0, 6);
        return {
          ...w,
          title: t('inventory.dashboard.stockTurnover'),
          data: { ...(w.data as Record<string, unknown>), values },
        };
      }
      if (w.id === 'inv-low-stock-table') {
        const lowStock = stockQuants
          .filter((q) => Number(q.availableQuantity ?? 0) <= 0)
          .slice(0, 5)
          .map((q) => {
            const product = products.find((p) => p.id === q.productId);
            return {
              sku: String(
                product?.defaultCode ??
                  t('inventory.dashboard.skuFallback', {
                    id: String(q.productId).slice(-4),
                  }),
              ),
              name: String(
                product?.name ??
                  t('inventory.dashboard.productFallback', {
                    id: String(q.productId).slice(-4),
                  }),
              ),
              qty: Math.round(Number(q.availableQuantity ?? 0)),
              reorder: '—',
              status: 'Critical',
            };
          });
        return {
          ...w,
          data: { ...(w.data as Record<string, unknown>), rows: lowStock },
        };
      }
      if (w.id === 'inventory-exception-queue-cards') {
        return {
          ...w,
          data: {
            stats: [
              {
                label: 'Short ATP',
                value: String(shortAtpExceptions.length),
                icon: 'AlertTriangle',
                testId: 'inventory-queue-short-atp',
              },
              {
                label: 'Expired lots',
                value: String(expiredLotExceptions.length),
                icon: 'AlertCircle',
                testId: 'inventory-queue-expired-lots',
              },
              {
                label: 'Open QC fails',
                value: String(openQcExceptions.length),
                icon: 'ShieldAlert',
                testId: 'inventory-queue-open-qc',
              },
            ],
          },
        };
      }
      return w;
    });
  }, [
    products,
    stockQuants,
    transfers,
    adjustments,
    stockMoves,
    shortAtpExceptions,
    expiredLotExceptions,
    openQcExceptions,
    dashboardTimeRange,
    t,
    moduleConfig,
    productFormConfig,
    transferFormConfig,
    adjustmentFormConfig,
  ]);

  const warehouse3DTab = useMemo(
    () => ({
      id: '3d-view',
      label: t('inventory.3dView'),
      type: 'custom' as const,
      customContent: isMounted ? (
        <div className="flex flex-col gap-2 h-[calc(100vh-12rem)]">
          <div className="flex flex-wrap gap-2 shrink-0 items-center">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                setQuickActionForm({
                  form: warehouse3dZoneFormConfig,
                  action: 'createWarehouse3dZone',
                })
              }
            >
              {t('inventory.z3dActions.addZone')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                const values = await askForm({
                  title: t('inventory.z3dActions.editZone'),
                  fields: [
                    {
                    id: 'zoneId',
                    name: 'zoneId',
                    label: t('inventory.byRecord.zone', { defaultValue: 'Zone' }),
                    type: 'select',
                    required: true,
                    options: recordOptions(zones, (zone) => zone.name || `#${zone.id}`),
                  },
                    {
                      id: 'color',
                      name: 'color',
                      label: t('inventory.byRecord.color', { defaultValue: 'Color (hex)' }),
                      type: 'text',
                      placeholder: '#3b82f6',
                    },
                  ],
                });
                if (!values) return;
                const color = formText(values.color);
                try {
                  await updateWarehouse3dZone.mutateAsync({
                    zoneId: Number(values.zoneId),
                    params: color ? { color } : {},
                  });
                } catch (error) {
                  showWorkflowToast({
                    kind: 'error',
                    title: t('inventory.z3dActions.editZone'),
                    description:
                      error instanceof Error ? error.message : undefined,
                  });
                }
              }}
            >
              {t('inventory.z3dActions.editZone')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={async () => {
                const values = await askForm({
                  title: t('inventory.z3dActions.deleteZone'),
                  submitLabel: t('inventory.byRecord.deactivate', { defaultValue: 'Deactivate' }),
                  fields: [{
                    id: 'zoneId',
                    name: 'zoneId',
                    label: t('inventory.byRecord.zone', { defaultValue: 'Zone' }),
                    type: 'select',
                    required: true,
                    options: recordOptions(zones, (zone) => zone.name || `#${zone.id}`),
                  }],
                });
                if (!values) return;
                try {
                  await deleteWarehouse3dZone.mutateAsync(Number(values.zoneId));
                } catch (error) {
                  showWorkflowToast({
                    kind: 'error',
                    title: t('inventory.z3dActions.deleteZone'),
                    description:
                      error instanceof Error ? error.message : undefined,
                  });
                }
              }}
            >
              {t('inventory.z3dActions.deleteZone')}
            </Button>
          </div>
          <div className="flex-1 min-h-0">
            <WarehouseViewer
              zones={zones}
              slots={slots}
              items={warehouseItems}
              warehouseName={
                warehouses[0]?.name ? String(warehouses[0].name) : undefined
              }
              onMoveItem={(itemId, targetSlotId) => {
                void stockQuantWorkflow
                  .move({
                    quantId: String(itemId),
                    targetLocationId: String(targetSlotId),
                    quantity: 1,
                  })
                  .catch(() => undefined);
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
      stockQuantWorkflow,
      t,
      isMounted,
      warehouse3dZoneFormConfig,
      updateWarehouse3dZone,
      deleteWarehouse3dZone,
    ],
  );

  const cycleCountWizardTab = useMemo(
    () => ({
      id: 'cycle-wizard',
      label: t('inventory.cycleCountWizard.tabLabel'),
      type: 'custom' as const,
      customContent: (
        <CycleCountWizard
          key={`${organizationId}:${selectedOperatingCompanyId ?? ''}:${currentUser?.id ?? ''}`}
          organizationId={organizationId}
          operatingCompanyId={selectedOperatingCompanyId}
          locations={locations}
          cycleCounts={cycleCounts}
          products={products}
          uoms={uoms}
          initialCycleCountId={wizardCycleCountId}
        />
      ),
    }),
    [
      t,
      organizationId,
      selectedOperatingCompanyId,
      currentUser?.id,
      locations,
      cycleCounts,
      products,
      uoms,
      wizardCycleCountId,
    ],
  );

  const locationHierarchyTab = useMemo(
    () => ({
      id: 'location-tree',
      label: t('inventory.locationTree.tabLabel'),
      type: 'custom' as const,
      customContent: (
        <LocationHierarchyPanel
          locations={locations}
          quants={stockQuants}
          onViewQuants={(locationId) => {
            setStockLocationFilter(locationId);
            setActiveTab('stock');
          }}
        />
      ),
    }),
    [t, locations, stockQuants],
  );

  const qualityAlertsTab = useMemo(
    () => ({
      id: 'quality-alerts',
      label: t('inventory.qualityAlerts.tabLabel'),
      type: 'custom' as const,
      customContent: (
        <QualityAlertsPanel
          organizationId={organizationId}
          operatingCompanyId={operatingCompanyId}
          selectedCompanyId={selectedOperatingCompanyId}
          onAssignAlert={(id) => setAssignQualityAlertId(id)}
          onSolveAlert={(id) => setSolveQualityAlertId(id)}
        />
      ),
    }),
    [organizationId, operatingCompanyId, selectedOperatingCompanyId],
  );

  const stockMoveTabActions = useStockMoveTabActions({
    orgId,
    operatingCompanyId,
    askForm,
    productSelectOptions,
    uomFieldOptions,
    stockOnHandLocationOptions,
  });
  const inventoryCountTabActions = useInventoryCountTabActions({
    orgId,
    operatingCompanyId,
    askForm,
    adjustmentFormConfig,
    stockInventoryOptions,
    productSelectOptions,
    uomFieldOptions,
    stockOnHandLocationOptions,
    stockInventoryStateOptions,
  });
  const productionLotTabActions = useProductionLotTabActions({
    orgId,
    operatingCompanyId,
    askForm,
    productSelectOptions,
    setCsvKind,
  });
  const productionSerialTabActions = useProductionSerialTabActions({
    orgId,
    operatingCompanyId,
    askForm,
    productSelectOptions,
    workflowSurface,
  });
  const qualityCheckTabActions = useQualityCheckTabActions({
    orgId,
    operatingCompanyId,
    selectedOperatingCompanyId,
    askForm,
    workflowSurface,
    products,
    warehouses,
    qualityTeamOptions,
    stockOnHandLocationOptions,
    iotDeviceOptions,
    setActiveTab,
    setCreateQualityAlertOpen,
  });
  const replenishmentTabActions = useReplenishmentTabActions({
    orgId,
    operatingCompanyId,
    workflowSurface,
    products,
    warehouses,
    locationParentOptions,
    uomFieldOptions,
  });
  const pickingWaveTabActions = usePickingWaveTabActions({
    orgId,
    operatingCompanyId,
    assignUserFieldOptions,
  });
  const stockPackageTabActions = useStockPackageTabActions({
    orgId,
    operatingCompanyId,
  });
  const stockRoutingTabActions = useStockRoutingTabActions({
    orgId,
    operatingCompanyId,
  });
  const barcodeTabActions = useBarcodeTabActions({
    orgId,
    operatingCompanyId,
    askForm,
    barcodeRuleOptions,
  });
  const warehouseTaskTabActions = useWarehouseTaskTabActions({
    orgId,
    selectedOperatingCompanyId,
    askForm,
    warehouseTaskStatusOptions,
  });

  const config = useMemo(() => {
    const withTransferActions = (
      tab: (typeof moduleConfig.tabs)[number],
    ): (typeof moduleConfig.tabs)[number] => {
      if (
        tab.type !== 'entity' ||
        !tab.entityConfig ||
        tab.entityConfig.view.mode !== 'table'
      ) {
        return tab;
      }
      const v = tab.entityConfig.view as EntityTableConfig;
      if (tab.id === 'transfers') {
        return {
          ...tab,
          createForm: transferFormConfig,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: pickingRowActions(
                t,
                {
                  // Every selected transfer qualifies (the toolbar requires it), so each one is run.
                  confirm: (rows) =>
                    runPickingWorkflowActionForRows(pickingWorkflow.confirm, rows),
                  assign: (rows) =>
                    runPickingWorkflowActionForRows(pickingWorkflow.assign, rows),
                  'partial-validate': (rows) => {
                    const selectedId = rows[0]?.id;
                    const picking = transfers.find(
                      (row) => String(row.id) === String(selectedId),
                    );
                    if (!picking) return;
                    setPartialTransferError(null);
                    setPartialTransferPicking(picking);
                  },
                  'assign-user': (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id != null) setAssignPickingId(id);
                  },
                  pack: (rows) => runRecordActionForRows(pickingWorkflow.pack, rows),
                  validate: (rows) =>
                    runPickingWorkflowActionForRows(pickingWorkflow.validate, rows),
                  cancel: (rows) => runRecordActionForRows(pickingWorkflow.cancel, rows),
                },
                {
                  confirm: CheckCircle,
                  assign: UserCircle2,
                  'assign-user': UserPlus,
                  pack: Package,
                  validate: ListChecks,
                  cancel: XCircle,
                },
              ),
            },
          },
        };
      }
      if (tab.id === 'products') {
        return {
          ...tab,
          createForm: productFormConfig,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: 'csv-uom-category',
                  label: t('inventory.csvImport.toolbarUomCategories'),
                  onClick: () => setCsvKind('uomCategory'),
                },
                {
                  id: 'csv-uom',
                  label: t('inventory.csvImport.toolbarUoms'),
                  onClick: () => setCsvKind('uom'),
                },
                {
                  id: 'csv-product-category',
                  label: t('inventory.csvImport.toolbarProductCategories'),
                  onClick: () => setCsvKind('productCategory'),
                },
                {
                  id: 'csv-product',
                  label: t('inventory.csvImport.toolbarProducts'),
                  onClick: () => setCsvKind('product'),
                },
                {
                  id: 'csv-product-variant',
                  label: t('inventory.csvImport.toolbarVariants'),
                  onClick: () => setCsvKind('productVariant'),
                },
                {
                  id: 'edit-product',
                  label: t('common.edit'),
                  icon: Pencil,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const row = rows[0] as Record<string, unknown> | undefined;
                    if (row) setEditProductRow(row);
                  },
                },
                {
                  id: 'delete-product',
                  label: t('common.delete'),
                  icon: Trash2,
                  variant: 'destructive',
                  requiresSelection: true,
                  successMessage: t('common.actionCompleted', { action: t('common.delete') }),
                  confirm: {
                    title: t('common.delete'),
                    description: t('inventory.productActions.confirmDelete'),
                    confirmLabel: t('common.confirm'),
                    cancelLabel: t('common.cancel'),
                  },
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id == null) return;
                    await deleteProduct.mutateAsync(id);
                  },
                },
                {
                  id: 'add-variant',
                  label: t('inventory.productActions.addVariant'),
                  icon: Plus,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id != null) setVariantProductId(id);
                  },
                },
                {
                  id: 'add-supplier-line',
                  label: t('inventory.productActions.addSupplierLine'),
                  icon: PackageOpen,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id != null) setSupplierLineProductId(id);
                  },
                },
                {
                  id: 'add-packaging',
                  label: t('inventory.productActions.addPackaging'),
                  icon: FolderTree,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id != null) setPackagingProductId(id);
                  },
                },
                {
                  id: 'ask-ai',
                  label: 'Ask AI',
                  icon: Sparkles,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const first = rows[0] as
                      | Record<string, unknown>
                      | undefined;
                    if (!first?.id) return;
                    openErpAiChat({
                      selection: buildEntitySelection({
                        activeTab: 'products',
                        entityType: 'product',
                        row: first,
                      }),
                    });
                  },
                },
                {
                  id: 'update-product-pricing',
                  label: t('inventory.productActions.updatePricing'),
                  icon: Pencil,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const row = rows[0] as Record<string, unknown> | undefined;
                    const productId = row?.id as ScalarId | undefined;
                    if (productId == null) return;
                    const values = await askForm({
                      title: t('inventory.productActions.updatePricing'),
                      fields: [
                        {
                          id: 'standardPrice',
                          name: 'standardPrice',
                          label: t('inventory.productActions.standardPricePrompt'),
                          type: 'number',
                          min: 0,
                          step: 0.01,
                          defaultValue: formNumber(row?.standardPrice),
                        },
                        {
                          id: 'listPrice',
                          name: 'listPrice',
                          label: t('inventory.productActions.listPricePrompt'),
                          type: 'number',
                          min: 0,
                          step: 0.01,
                          defaultValue: formNumber(row?.listPrice),
                        },
                      ],
                    });
                    if (!values) return;
                    const standardPrice = formNumber(values.standardPrice);
                    const listPrice = formNumber(values.listPrice);
                    if (standardPrice == null && listPrice == null) return;
                    await updateProductPricing.mutateAsync({
                      productId,
                      params: { standardPrice, listPrice },
                    });
                  },
                },
                {
                  id: 'update-product-inventory-data',
                  label: t('inventory.productActions.updateInventoryData'),
                  icon: PackageOpen,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const row = rows[0] as Record<string, unknown> | undefined;
                    const productId = row?.id as ScalarId | undefined;
                    if (productId == null) return;
                    const values = await askForm({
                      title: t('inventory.productActions.updateInventoryData'),
                      fields: [
                        {
                          id: 'qtyAvailable',
                          name: 'qtyAvailable',
                          label: t('inventory.productActions.qtyAvailablePrompt'),
                          type: 'number',
                          defaultValue: formNumber(row?.qtyAvailable),
                        },
                        {
                          id: 'virtualAvailable',
                          name: 'virtualAvailable',
                          label: t('inventory.productActions.virtualAvailablePrompt'),
                          type: 'number',
                          defaultValue: formNumber(row?.virtualAvailable),
                        },
                      ],
                    });
                    if (!values) return;
                    const qtyAvailable = formNumber(values.qtyAvailable);
                    const virtualAvailable = formNumber(values.virtualAvailable);
                    if (qtyAvailable == null && virtualAvailable == null) return;
                    await updateProductInventoryData.mutateAsync({
                      productId,
                      params: { qtyAvailable, virtualAvailable },
                    });
                  },
                },
                {
                  id: 'update-product-variant',
                  label: t('inventory.productActions.updateVariantById'),
                  requiresSelection: false,
                  onClick: async () => {
                    const values = await askForm({
                      title: t('inventory.productActions.updateVariantById'),
                      fields: [
                        {
                          id: 'recordId',
                          name: 'recordId',
                          label: t('inventory.byRecord.variantId', { defaultValue: 'Variant ID' }),
                          type: 'number',
                          required: true,
                          min: 1,
                        },
                        { id: 'name', name: 'name', label: t('inventory.byRecord.name', { defaultValue: 'Name' }), type: 'text' },
                        { id: 'standardPrice', name: 'standardPrice', label: t('inventory.byRecord.standardPrice', { defaultValue: 'Standard price' }), type: 'number', min: 0, step: 0.01 },
                      ],
                    });
                    if (!values) return;
                    const name = formText(values.name);
                    const standardPrice = formNumber(values.standardPrice);
                    if (name == null && standardPrice == null) return;
                    await updateProductVariant.mutateAsync({
                      variantId: Number(values.recordId),
                      params: { name, standardPrice },
                    });
                  },
                },
                {
                  id: 'create-uom-category',
                  label: t('inventory.uomActions.createCategory'),
                  requiresSelection: false,
                  onClick: async () => {
                    const values = await askForm({
                      title: t('inventory.uomActions.createCategory'),
                      fields: [
                        {
                          id: 'name',
                          name: 'name',
                          label: t('inventory.uomActions.categoryNamePrompt'),
                          type: 'text',
                          required: true,
                        },
                      ],
                    });
                    const name = formText(values?.name);
                    if (name == null) return;
                    await createUomCategory.mutateAsync({
                      name,
                      description: null,
                      sequence: 10,
                      metadata: null,
                    });
                  },
                },
                {
                  id: 'create-uom',
                  label: t('inventory.uomActions.createUom'),
                  requiresSelection: false,
                  onClick: async () => {
                    const values = await askForm({
                      title: t('inventory.uomActions.createUom'),
                      fields: [
                        uomCategoryOptions.length > 0
                          ? {
                              id: 'categoryId',
                              name: 'categoryId',
                              label: lbl.category,
                              type: 'select',
                              required: true,
                              options: uomCategoryOptions,
                            }
                          : {
                              // No units exist yet, so there is nothing to pick from.
                              id: 'categoryId',
                              name: 'categoryId',
                              label: t('inventory.uomActions.categoryIdPrompt'),
                              type: 'number',
                              required: true,
                              min: 1,
                            },
                        {
                          id: 'name',
                          name: 'name',
                          label: t('inventory.uomActions.uomNamePrompt'),
                          type: 'text',
                          required: true,
                        },
                        {
                          id: 'symbol',
                          name: 'symbol',
                          label: t('inventory.uomActions.symbolPrompt'),
                          type: 'text',
                          required: true,
                        },
                      ],
                    });
                    if (!values) return;
                    const categoryId = formNumber(values.categoryId);
                    const name = formText(values.name);
                    const symbol = formText(values.symbol);
                    if (categoryId == null || name == null || symbol == null)
                      return;
                    await createUom.mutateAsync({
                      category_id: categoryId,
                      name,
                      symbol,
                      factor: 1,
                      rounding: 0.01,
                      times_bigger: 1,
                      is_reference_unit: false,
                      is_active: true,
                      metadata: null,
                    });
                  },
                },
                {
                  id: 'create-uom-conversion',
                  label: t('inventory.uomActions.createConversion'),
                  requiresSelection: false,
                  onClick: async () => {
                    const values = await askForm({
                      title: t('inventory.uomActions.createConversion'),
                      description: t('inventory.byRecord.uomConversionHint', {
                        defaultValue: 'Both units must be in the same category.',
                      }),
                      fields: [
                        {
                          id: 'fromUomId',
                          name: 'fromUomId',
                          label: lbl.fromUom,
                          type: 'select',
                          required: true,
                          options: uomFieldOptions,
                        },
                        {
                          id: 'toUomId',
                          name: 'toUomId',
                          label: lbl.toUom,
                          type: 'select',
                          required: true,
                          options: uomFieldOptions,
                        },
                        {
                          id: 'factor',
                          name: 'factor',
                          label: t('inventory.uomActions.factorPrompt'),
                          type: 'number',
                          required: true,
                          defaultValue: 1,
                          step: 0.000001,
                        },
                      ],
                    });
                    if (!values) return;
                    const fromUom = (uoms as Record<string, unknown>[]).find(
                      (u) => String(u.id) === String(values.fromUomId),
                    );
                    const categoryId = fromUom?.categoryId ?? fromUom?.category_id;
                    const factor = formNumber(values.factor);
                    if (categoryId == null || factor == null) return;
                    await createUomConversion.mutateAsync({
                      categoryId: categoryId as ScalarId,
                      params: {
                        from_uom_id: Number(values.fromUomId),
                        to_uom_id: Number(values.toUomId),
                        factor,
                        product_id: null,
                        is_active: true,
                        metadata: null,
                      },
                    });
                  },
                },
                {
                  id: 'update-supplier-line',
                  label: t('inventory.productActions.updateSupplierLineById'),
                  requiresSelection: false,
                  onClick: async () => {
                    const values = await askForm({
                      title: t('inventory.productActions.updateSupplierLineById'),
                      fields: recordPickerFields(
                        [
                          {
                            id: 'recordId',
                            name: 'recordId',
                            label: t('inventory.byRecord.supplierLineId', { defaultValue: 'Supplier line ID' }),
                            type: 'number',
                            required: true,
                            min: 1,
                          },
                          { id: 'price', name: 'price', label: t('inventory.byRecord.price', { defaultValue: 'Price' }), type: 'number', min: 0, step: 0.01 },
                          { id: 'minQty', name: 'minQty', label: t('inventory.byRecord.minQty', { defaultValue: 'Minimum quantity' }), type: 'number', min: 0 },
                        ],
                        {
                          recordId: linkedRecordOptions(productSupplierInfos as Record<string, unknown>[], (row) =>
                            vendorPriceOptionLabel(row, vendorNameById, productLabelById),
                          ),
                        },
                      ),
                    });
                    if (!values) return;
                    await updateProductSupplierInfo.mutateAsync({
                      supplierInfoId: Number(values.recordId),
                      params: { price: formNumber(values.price), minQty: formNumber(values.minQty) },
                    });
                  },
                },
                {
                  id: 'update-packaging-row',
                  label: t('inventory.productActions.updatePackagingById'),
                  requiresSelection: false,
                  onClick: async () => {
                    const values = await askForm({
                      title: t('inventory.productActions.updatePackagingById'),
                      fields: recordPickerFields(
                        [
                          {
                            id: 'recordId',
                            name: 'recordId',
                            label: t('inventory.byRecord.packagingId', { defaultValue: 'Packaging ID' }),
                            type: 'number',
                            required: true,
                            min: 1,
                          },
                          { id: 'name', name: 'name', label: t('inventory.byRecord.name', { defaultValue: 'Name' }), type: 'text', required: true },
                        ],
                        {
                          recordId: linkedRecordOptions(productPackagings as Record<string, unknown>[], (row) =>
                            packagingOptionLabel(row, productLabelById),
                          ),
                        },
                      ),
                    });
                    if (!values) return;
                    await updateProductPackaging.mutateAsync({
                      packagingId: Number(values.recordId),
                      params: { name: formText(values.name) },
                    });
                  },
                },
              ],
            },
          },
        };
      }
      if (tab.id === 'warehouses') {
        return {
          ...tab,
          createForm: warehouseFormConfig,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: 'csv-warehouse',
                  label: t('inventory.csvImport.toolbarWarehouses'),
                  onClick: () => setCsvKind('warehouse'),
                },
                {
                  id: 'edit-warehouse',
                  label: t('common.edit'),
                  icon: Pencil,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const row = rows[0] as Record<string, unknown> | undefined;
                    if (row) setEditWarehouseRow(row);
                  },
                },
                {
                  id: 'delete-warehouse',
                  label: t('common.delete'),
                  icon: Trash2,
                  variant: 'destructive',
                  requiresSelection: true,
                  successMessage: t('common.actionCompleted', { action: t('common.delete') }),
                  confirm: {
                    title: t('common.delete'),
                    description: t('inventory.warehouseActions.confirmDelete'),
                    confirmLabel: t('common.confirm'),
                    cancelLabel: t('common.cancel'),
                  },
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id == null) return;
                    await deleteWarehouse.mutateAsync(id);
                  },
                },
                {
                  id: 'warehouse-geo',
                  label: t('inventory.warehouseActions.setGeo'),
                  icon: Route,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id == null) return;
                    const values = await askForm({
                      title: t('inventory.warehouseActions.setGeo'),
                      fields: [
                        {
                          id: 'latitude',
                          name: 'latitude',
                          label: t('inventory.warehouseActions.geoLatPrompt'),
                          type: 'number',
                          required: true,
                          min: -90,
                          max: 90,
                          width: '1/2',
                        },
                        {
                          id: 'longitude',
                          name: 'longitude',
                          label: t('inventory.warehouseActions.geoLngPrompt'),
                          type: 'number',
                          required: true,
                          min: -180,
                          max: 180,
                          width: '1/2',
                        },
                        {
                          id: 'address',
                          name: 'address',
                          label: t('inventory.warehouseActions.geoAddressPrompt'),
                          type: 'text',
                        },
                      ],
                    });
                    if (!values) return;
                    const latitude = formNumber(values.latitude);
                    const longitude = formNumber(values.longitude);
                    if (latitude == null || longitude == null) return;
                    await upsertWarehouseGeo.mutateAsync({
                      warehouseId: id,
                      latitude,
                      longitude,
                      address: formText(values.address) ?? null,
                    });
                  },
                },
              ],
            },
          },
        };
      }
      if (tab.id === 'stock-moves') return stockMoveTabActions.configureTab(tab);
      if (tab.id === 'stock') {
        return {
          ...tab,
          createForm: stockQuantFormConfig,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                // Keep the stock tab's own actions (move-stock-quant).
                ...(v.actions ?? []),
                {
                  id: 'csv-stock-quant',
                  label: t('inventory.csvImport.toolbarQuants'),
                  onClick: () => setCsvKind('stockQuant'),
                },
                {
                  id: 'reserve-qty',
                  label: t('inventory.stockActions.reserve'),
                  icon: CheckCircle,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id != null)
                      await reserveQuant.mutateAsync({
                        quantId: id,
                        reserveQty: 1,
                      });
                  },
                },
                {
                  id: 'unreserve-qty',
                  label: t('inventory.stockActions.unreserve'),
                  icon: XCircle,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id != null)
                      await unreserveQuant.mutateAsync({
                        quantId: id,
                        unreserveQty: 1,
                      });
                  },
                },
                {
                  id: 'set-quant-qty',
                  label: t('inventory.stockActions.setQuantity'),
                  icon: Pencil,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const row = rows[0] as Record<string, unknown> | undefined;
                    const id = row?.id as ScalarId | undefined;
                    if (id == null) return;
                    const values = await askForm({
                      title: t('inventory.stockActions.setQuantity'),
                      fields: [
                        {
                          id: 'quantity',
                          name: 'quantity',
                          label: t('inventory.stockActions.quantityPrompt'),
                          type: 'number',
                          required: true,
                          defaultValue: formNumber(row?.quantity) ?? 0,
                        },
                      ],
                    });
                    if (!values) return;
                    const qty = formNumber(values.quantity);
                    if (qty == null) return;
                    await updateStockQuantQuantity.mutateAsync({
                      quantId: id,
                      quantity: qty,
                    });
                  },
                },
              ],
            },
          },
        };
      }
      if (tab.id === 'adjustments') return inventoryCountTabActions.configureTab(tab);
      if (tab.id === 'locations') {
        return {
          ...tab,
          createForm: stockLocationFormConfig,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: 'csv-stock-location',
                  label: t('inventory.csvImport.toolbarLocations'),
                  onClick: () => setCsvKind('stockLocation'),
                },
                {
                  id: 'edit-location',
                  label: t('common.edit'),
                  icon: Pencil,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const row = rows[0] as Record<string, unknown> | undefined;
                    const locationId = row?.id as ScalarId | undefined;
                    if (locationId == null) return;
                    const values = await askForm({
                      title: t('common.edit'),
                      fields: [
                        {
                          id: 'name',
                          name: 'name',
                          label: t('inventory.locationActions.namePrompt'),
                          type: 'text',
                          defaultValue: String(row?.name ?? ''),
                        },
                        {
                          id: 'barcode',
                          name: 'barcode',
                          label: t('inventory.locationActions.barcodePrompt'),
                          type: 'text',
                          defaultValue: String(row?.barcode ?? ''),
                        },
                      ],
                    });
                    if (!values) return;
                    const name = formText(values.name);
                    const barcode = formText(values.barcode);
                    if (name == null && barcode == null) return;
                    await updateStockLocation.mutateAsync({
                      locationId,
                      params: { name, barcode },
                    });
                  },
                },
                {
                  id: 'delete-location',
                  label: t('common.delete'),
                  variant: 'destructive',
                  requiresSelection: true,
                  successMessage: t('common.actionCompleted', { action: t('common.delete') }),
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id != null) await deleteStockLocation.mutateAsync(id);
                  },
                },
              ],
            },
          },
        };
      }
      if (tab.id === 'lots') return productionLotTabActions.configureTab(tab);
      if (tab.id === 'serials') return productionSerialTabActions.configureTab(tab);
      if (tab.id === 'cycle-counts') {
        return {
          ...tab,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: 'open-cycle-wizard',
                  label: t('inventory.cycleCountWizard.openWizard'),
                  icon: ClipboardList,
                  requiresSelection: true,
                  onClick: (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id != null) {
                      setWizardCycleCountId(id);
                      setActiveTab('cycle-wizard');
                    }
                  },
                },
              ],
            },
          },
        };
      }
      // Quality checks actions
      if (tab.id === 'quality') return qualityCheckTabActions.configureTab(tab);
      // Replenishment rules actions
      if (tab.id === 'replenishment') return replenishmentTabActions.configureTab(tab);
      // Picking waves actions
      if (tab.id === 'picking-waves') return pickingWaveTabActions.configureTab(tab);
      // Stock package actions
      if (tab.id === 'stock-packages') return stockPackageTabActions.configureTab(tab);
      // Product categories actions
      if (tab.id === 'product-categories') {
        return {
          ...tab,
          createForm: mergeSelectOptionsForFields(newProductCategoryForm(t), {
            parentId: productCategoryRowsToSelectOptions(productCategories).map(
              (o) => ({ ...o, value: String(o.value) }),
            ),
          }),
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: 'csv-product-category-tab',
                  label: t('inventory.csvImport.toolbarProductCategories'),
                  onClick: () => setCsvKind('productCategory'),
                },
                {
                  id: 'rename-category',
                  label: t('inventory.categoryActions.rename'),
                  permission: { resource: 'product_category', action: 'write' },
                  requiresSelection: true,
                  onClick: (rows) => { if (permissionsReady !== false && checkPermission('product_category', 'write').allowed && rows.length === 1) { renameCategoryEpoch.current++; setRenameCategoryRow(rows[0]!); } },
                },
                {
                  id: 'delete-category',
                  label: t('common.delete'),
                  icon: Trash2,
                  variant: 'destructive',
                  requiresSelection: true,
                  successMessage: t('common.actionCompleted', { action: t('common.delete') }),
                  confirm: {
                    title: t('common.delete'),
                    description: t('inventory.categoryActions.confirmDelete'),
                    confirmLabel: t('common.confirm'),
                    cancelLabel: t('common.cancel'),
                  },
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id == null) return;
                    await deleteProductCategory.mutateAsync(id);
                  },
                },
                {
                  id: 'restore-category',
                  label: t('inventory.categoryActions.restoreById'),
                  requiresSelection: false,
                  onClick: async () => {
                    const deleted = (productCategories as Record<string, unknown>[]).filter(
                      (row) => row.deletedAt != null || row.deleted_at != null,
                    );
                    const values = await askForm({
                      title: t('inventory.categoryActions.restoreById'),
                      fields: [
                        {
                          id: 'categoryId',
                          name: 'categoryId',
                          label: t('inventory.byRecord.category', { defaultValue: 'Archived category' }),
                          type: 'select',
                          required: true,
                          options: recordOptions(deleted, (row) => String(row.name ?? row.id)),
                        },
                      ],
                    });
                    if (!values) return;
                    await restoreProductCategory.mutateAsync(Number(values.categoryId));
                  },
                },
              ],
            },
          },
        };
      }
      // Stock routes actions
      if (tab.id === 'routes') return stockRoutingTabActions.configureTab(tab);
      // Stock rules actions
      if (tab.id === 'rules') return stockRoutingTabActions.configureTab(tab);
      // Barcode rules actions
      if (tab.id === 'barcode-rules') return barcodeTabActions.configureTab(tab);
      if (tab.id === 'traceability-records') {
        return {
          ...tab,
          createForm: traceRecordFormConfig,
        };
      }
      if (tab.id === 'barcode-nomenclatures') return barcodeTabActions.configureTab(tab);
      if (tab.id === 'traceability-reports') {
        return {
          ...tab,
          createForm: traceabilityReportFormConfig,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: 'run-traceability-report',
                  label: t('inventory.traceabilityReports.actions.runSelected'),
                  icon: Play,
                  requiresSelection: true,
                  isApplicable: (rows) =>
                    rows.every((row) => ['draft'].includes(rowState(row, 'state'))),
                  successMessage: t('common.actionCompleted', { action: t('inventory.traceabilityReports.actions.runSelected') }),
                  onClick: async (rows) => {
                    const row = rows[0] as Record<string, unknown> | undefined;
                    const id = row?.id as ScalarId | undefined;
                    if (id == null || String(row?.state ?? '') !== 'draft')
                      return;
                    await runTraceabilityReport.mutateAsync(id);
                  },
                },
              ],
            },
          },
        };
      }
      // Warehouse tasks actions
      if (tab.id === 'warehouse-tasks') return warehouseTaskTabActions.configureTab(tab);
      return tab;
    };

    const configured: ModuleConfig = {
      ...moduleConfig,
      tabs: [
        ...withDashboardSections(moduleConfig, liveSections).tabs.map((tab) => {
          if (tab.id === 'products') {
            return withTransferActions({
              ...tab,
              entityConfig: productsEntityConfig,
              recordSheet: productRecordSheet,
            });
          }
          if (tab.id === 'transfers') {
            return withTransferActions({
              ...tab,
              entityConfig: transfersEntityConfig,
              recordSheet: transferRecordSheet,
            });
          }
          if (tab.id === 'warehouses') return withTransferActions(tab);
          if (tab.id === 'stock-moves') return withTransferActions(tab);
          if (tab.id === 'stock') {
            return withTransferActions({
              ...tab,
              entityConfig: stockEntityConfig,
              recordSheet: stockQuantRecordSheet,
            });
          }
          if (tab.id === 'lots') return withTransferActions(tab);
          if (tab.id === 'serials') return withTransferActions(tab);
          if (tab.id === 'adjustments') return withTransferActions(tab);
          if (tab.id === 'locations') return withTransferActions({ ...tab, recordSheet: locationRecordSheet });
          if (tab.id === 'cycle-counts') return withTransferActions(tab);
          if (tab.id === 'quality') return withTransferActions(tab);
          if (tab.id === 'replenishment') return withTransferActions(tab);
          if (tab.id === 'picking-waves') return withTransferActions(tab);
          if (tab.id === 'stock-packages') return withTransferActions(tab);
          if (tab.id === 'product-categories') return withTransferActions(tab);
          if (tab.id === 'routes') return withTransferActions(tab);
          if (tab.id === 'rules') return withTransferActions(tab);
          if (tab.id === 'barcode-rules') return withTransferActions(tab);
          if (tab.id === 'adjustment-reasons') return withTransferActions(tab);
          if (tab.id === 'barcode-nomenclatures')
            return withTransferActions(tab);
          if (tab.id === 'traceability-records')
            return withTransferActions(tab);
          if (tab.id === 'traceability-reports')
            return withTransferActions(tab);
          if (tab.id === 'warehouse-tasks') return withTransferActions(tab);
          return tab;
        }),
        cycleCountWizardTab,
        locationHierarchyTab,
        qualityAlertsTab,
        warehouse3DTab,
      ],
    };
    if (workspace === 'products') return productCatalogWorkspace(configured, t);
    if (workspace === 'warehouse') return warehouseWorkspace(configured, t, locations);
    return configured;
  }, [
    workspace,
    stockMoveTabActions,
    inventoryCountTabActions,
    productionLotTabActions,
    productionSerialTabActions,
    qualityCheckTabActions,
    replenishmentTabActions,
    pickingWaveTabActions,
    stockPackageTabActions,
    stockRoutingTabActions,
    barcodeTabActions,
    warehouseTaskTabActions,
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
    productsEntityConfig,
    stockEntityConfig,
    transfersEntityConfig,
    productRecordSheet,
    stockQuantRecordSheet,
    locationRecordSheet,
    transferRecordSheet,
    t,
    pickingWorkflow,
    reserveQuant,
    unreserveQuant,
    deleteStockLocation,
    deleteProduct,
    openErpAiChat,
    deleteWarehouse,
    updateProductPricing,
    updateProductInventoryData,
    updateProductVariant,
    createUomCategory,
    createUom,
    createUomConversion,
    updateStockLocation,
    // Quality management
    deleteQualityPoint,
    deleteQualityTeam,
    // Picking waves
    // Product categories
    permissionsReady,
    checkPermission,
    deleteProductCategory,
    // Stock routes and rules
    // Barcode
    // Warehouse tasks
    openQualityAlert,
    solveQualityAlert,
    updateStockQuantQuantity,
    upsertWarehouseGeo,
    restoreProductCategory,
    updateProductSupplierInfo,
    updateProductPackaging,
    productSupplierInfos,
    productPackagings,
    vendorNameById,
    productLabelById,
    stockQuantFormConfig,
    traceRecordFormConfig,
    runTraceabilityReport,
    askForm,
    lbl,
    operatingCompanyId,
    uoms,
    uomCategoryOptions,
    stockInventoryOptions,
    stockInventoryStateOptions,
    iotDeviceOptions,
    barcodeRuleOptions,
    warehouseTaskStatusOptions,
    productSelectOptions,
    stockOnHandLocationOptions,
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
    transfers,
  ]);

  const filteredStockQuants = useMemo(() => {
    if (!stockLocationFilter) return stockQuants;
    return stockQuants.filter(
      (q) => String(q.locationId ?? '') === stockLocationFilter,
    );
  }, [stockQuants, stockLocationFilter]);

  const data = useMemo(
    () => ({
      products: (workspace === 'products' ? productCatalogRows(products, productCategories, uoms) : products).map((row) => ({
        ...row,
        sheetTitle:
          inventoryProductPrimaryLabel(row) || String(row.name ?? row.id ?? ''),
      })),
      stock: (workspace === 'warehouse' ? warehouseRows(filteredStockQuants, products, locations, uoms) : filteredStockQuants).map((row) => {
        const record = row as Record<string, unknown>;
        const productId = record.productId ?? record.product_id;
        const locationId = record.locationId ?? record.location_id;
        const productLabel =
          productId != null
            ? (productLabelById.get(String(productId)) ?? '(deleted)')
            : undefined;
        const locationLabel =
          locationId != null
            ? (locationLabelById.get(String(locationId)) ?? '(deleted)')
            : undefined;
        return {
          ...record,
          sheetTitle:
            (workspace === 'warehouse'
              ? [record.warehouseProductName, record.warehouseLocationName]
              : [productLabel, locationLabel]).filter(Boolean).join(' · ') ||
            String(record.id ?? ''),
        };
      }) as unknown as Record<string, unknown>[],
      transfers: (transfers as Record<string, unknown>[]).map((row) => ({
        ...row,
        sheetTitle: String(row.name ?? row.origin ?? row.id ?? ''),
      })),
      warehouses: warehouses as unknown as Record<string, unknown>[],
      adjustments: adjustments as unknown as Record<string, unknown>[],
      locations: locations as unknown as Record<string, unknown>[],
      lots: workspace === 'warehouse' ? warehouseRows(lots, products, []) : lots as unknown as Record<string, unknown>[],
      serials: workspace === 'warehouse' ? warehouseRows(serials, products, locations) : serials as unknown as Record<string, unknown>[],
      quality: qualityChecks as unknown as Record<string, unknown>[],
      'cycle-counts': workspace === 'warehouse' ? warehouseRows(cycleCounts, [], locations) : cycleCounts as unknown as Record<string, unknown>[],
      'picking-waves': pickingWaves as unknown as Record<string, unknown>[],
      'stock-packages': stockPackages as unknown as Record<string, unknown>[],
      'warehouse-tasks': warehouseTasks as unknown as Record<string, unknown>[],
      routes: stockRoutes as unknown as Record<string, unknown>[],
      rules: stockRules as unknown as Record<string, unknown>[],
      'stock-moves': workspace === 'warehouse' ? warehouseRows(stockMoves, products, locations, uoms) : stockMoves as unknown as Record<string, unknown>[],
      valuations: inventoryValuations as unknown as Record<string, unknown>[],
      replenishment: replenishmentRulesList as unknown as Record<
        string,
        unknown
      >[],
      'barcode-rules': barcodeRules as unknown as Record<string, unknown>[],
      'product-categories': workspace === 'products' ? productCatalogCategoryRows(productCategories) : productCategories as unknown as Record<
        string,
        unknown
      >[],
      'adjustment-reasons': adjustmentReasons as unknown as Record<
        string,
        unknown
      >[],
      'barcode-nomenclatures': barcodeNomenclatures as unknown as Record<
        string,
        unknown
      >[],
      'traceability-records': serialLotTraceability as unknown as Record<
        string,
        unknown
      >[],
      'traceability-reports': stockTraceabilityReports as unknown as Record<
        string,
        unknown
      >[],
    }),
    [
      workspace,
      uoms,
      products,
      productLabelById,
      locationLabelById,
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
      stockPackages,
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
    ],
  );

  const kpiStrips = useMemo<Record<string, { tiles: KpiTileDef[]; loading?: boolean }>>(
    () => ({
      transfers: {
        tiles: transferKpis(data.transfers, { t, now: new Date(), currencyCodeById: new Map() }),
        loading: transfersLoading,
      },
    }),
    [data.transfers, transfersLoading, t],
  );

  const sourceDataState = {
    dashboard: mergeModuleStates([
      productsRead.state, stockQuantsRead.state, transfersRead.state, adjustmentsRead.state, stockMovesRead.state,
      shortAtpExceptionsRead.state, expiredLotExceptionsRead.state, openQcExceptionsRead.state,
    ]),
    products: workspace === 'products'
      ? mergeModuleStates([productsRead.state, productCategoriesRead.state, uomsRead.state])
      : productsRead.state,
    'product-categories': productCategoriesRead.state,
    uoms: uomsRead.state,
    stock: stockQuantsRead.state,
    transfers: transfersRead.state,
    'stock-moves': stockMovesRead.state,
    warehouses: warehousesRead.state,
    adjustments: adjustmentsRead.state,
    locations: locationsRead.state,
    lots: lotsRead.state,
    serials: serialsRead.state,
    quality: qualityChecksRead.state,
    'cycle-counts': cycleCountsRead.state,
    'picking-waves': pickingWavesRead.state,
    'stock-packages': stockPackagesRead.state,
    'warehouse-tasks': warehouseTasksRead.state,
    routes: stockRoutesRead.state,
    rules: stockRulesRead.state,
    valuations: inventoryValuationsRead.state,
    replenishment: replenishmentRulesListRead.state,
    'barcode-rules': barcodeRulesRead.state,
    'barcode-nomenclatures': barcodeNomenclaturesRead.state,
    'adjustment-reasons': adjustmentReasonsRead.state,
    'traceability-records': serialLotTraceabilityRead.state,
    'traceability-reports': stockTraceabilityReportsRead.state,
    'cycle-wizard': mergeModuleStates([locationsRead.state, cycleCountsRead.state, productsRead.state]),
    'location-tree': locationsRead.state,
    'quality-alerts': qualityChecksRead.state,
  };
  const dataState = workspace === 'warehouse' ? warehouseDataStates(sourceDataState) : sourceDataState;
  type InventoryTab = keyof typeof dataState;
  const tabUsable = (tab: string | undefined) =>
    tab == null || !(tab in dataState) || canUseModuleData(dataState[tab as InventoryTab]);
  const actionTabs: Record<string, InventoryTab> = {
    createProduct: 'products', createTransfer: 'transfers', createStockPicking: 'transfers',
    createStockLocation: 'locations', createWarehouse: 'warehouses', createQualityCheck: 'quality',
    createAdjustment: 'adjustments', createInventoryAdjustment: 'adjustments',
    createQualityAlert: 'quality-alerts', createReplenishmentRule: 'replenishment',
    createPickingWave: 'picking-waves', createProductCategory: 'product-categories',
    createBarcodeRule: 'barcode-rules', createAdjustmentReason: 'adjustment-reasons',
    createTraceabilityRecord: 'traceability-records', createTraceabilityReport: 'traceability-reports',
    createStockQuant: 'stock',
  };
  const csvTabs: Partial<Record<InventoryCsvImportKind, InventoryTab>> = {
    productCategory: 'product-categories', product: 'products', productVariant: 'products',
    warehouse: 'warehouses', stockLocation: 'locations', stockQuant: 'stock', lot: 'lots',
  };
  const quickActionUsable = quickActionForm == null || tabUsable(actionTabs[quickActionForm.action]);
  const csvSourceTab = csvKind == null ? undefined : csvTabs[csvKind];
  const csvSourceState = csvSourceTab == null ? undefined : dataState[csvSourceTab];
  const productsUsable = tabUsable('products');
  const categoriesUsable = tabUsable('product-categories');
  useEffect(() => { if (!categoriesUsable) setRenameCategoryRow(null); }, [categoriesUsable]);
  const warehousesUsable = tabUsable('warehouses');
  const stockUsable = tabUsable('stock');
  const transfersUsable = tabUsable('transfers');
  const serialsUsable = tabUsable('serials');
  const lotsUsable = tabUsable('lots');
  const qualityUsable = tabUsable('quality');
  // Prompted row commands act on the active tab's rows.
  const activeTabUsable = tabUsable(activeTab);
  useEffect(() => {
    // Dialogs close when the collection their rows came from is denied or fails.
    if (!quickActionUsable) setQuickActionForm(null);
    if (!productsUsable) {
      setEditProductRow(null);
      setVariantProductId(null);
      setSupplierLineProductId(null);
      setPackagingProductId(null);
    }
    if (!warehousesUsable) setEditWarehouseRow(null);
    if (!stockUsable) setMoveQuantRow(null);
    if (!transfersUsable) {
      setPartialTransferPicking(null);
      setAssignPickingId(null);
    }
    if (!serialsUsable) {
      setSelectedSerialRow(null);
      setBlockSerialId(null);
    }
    if (!lotsUsable) setSelectedLotRow(null);
    if (!qualityUsable) {
      setCreateQualityAlertOpen(false);
      setAssignQualityAlertId(null);
      setSolveQualityAlertId(null);
    }
    if (!activeTabUsable) cancelForm();
  }, [
    quickActionUsable, productsUsable, warehousesUsable, stockUsable, transfersUsable,
    serialsUsable, lotsUsable, qualityUsable, activeTabUsable, cancelForm,
  ]);

  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (!tabUsable(actionTabs[action])) throw new Error('Required data is unavailable. Refresh and try again.');
    if (action === 'createProduct') {
      const productParams = prepareProductCreate(formData, pricelists, pricelistsRead.state, t);
      await createProduct.mutateAsync(productParams as unknown as CreateProductParams);
    } else if (action === 'createTransfer' || action === 'createStockPicking') {
      const stockPickingParams = toCreateStockPickingParamsFromForm(formData);
      if (!stockPickingParams) throw new Error(t('inventory.warehouseWorkspace.requiredValues', { defaultValue: 'Complete the required fields using available records. Your entries have been retained.' }));
      await createStockPicking.mutateAsync(
        stockPickingParams as unknown as CreateStockPickingParams,
      );
    } else if (
      action === 'createAdjustment' ||
      action === 'createInventoryAdjustment'
    ) {
      const productRaw = formData.productId;
      if (productRaw === '' || productRaw == null) throw new Error(t('inventory.warehouseWorkspace.requiredValues', { defaultValue: 'Complete the required fields using available records. Your entries have been retained.' }));
      const productRow = products.find(
        (p) => String(p.id) === String(productRaw),
      );
      const uomFromProduct =
        productRow?.uomId != null
          ? Number(productRow.uomId)
          : productRow?.uomPoId != null
            ? Number(productRow.uomPoId)
            : undefined;
      if (uomFromProduct == null || Number.isNaN(uomFromProduct)) throw new Error(t('inventory.warehouseWorkspace.requiredValues', { defaultValue: 'Complete the required fields using available records. Your entries have been retained.' }));
      const adjustmentParams = toCreateInventoryAdjustmentParamsFromForm(
        formData,
        uomFromProduct,
      );
      if (!adjustmentParams) throw new Error(t('inventory.warehouseWorkspace.requiredValues', { defaultValue: 'Complete the required fields using available records. Your entries have been retained.' }));
      await createInventoryAdjustment.mutateAsync(
        adjustmentParams as unknown as CreateInventoryAdjustmentParams,
      );
    } else if (action === 'createStockLocation') {
      const stockLocationParams = toCreateStockLocationParamsFromForm(formData);
      if (!stockLocationParams) throw new Error(t('inventory.warehouseWorkspace.requiredValues', { defaultValue: 'Complete the required fields using available records. Your entries have been retained.' }));
      await createStockLocation.mutateAsync(
        stockLocationParams as unknown as CreateStockLocationParams,
      );
    } else if (action === 'createWarehouse') {
      const templateWarehouseId = formData.templateWarehouseId;
      if (templateWarehouseId === '' || templateWarehouseId == null) throw new Error(t('inventory.warehouseWorkspace.setupRequired', { defaultValue: 'Choose an available warehouse template. The first warehouse needs authorized setup before this form can be used.' }));
      const template = warehouses.find(
        (w) => String(w.id) === String(templateWarehouseId),
      ) as Record<string, unknown> | undefined;
      if (!template) throw new Error(t('inventory.warehouseWorkspace.setupRequired', { defaultValue: 'Choose an available warehouse template. The first warehouse needs authorized setup before this form can be used.' }));
      await createWarehouse.mutateAsync(
        buildCreateWarehouseParamsFromTemplate(template, {
          name: String(formData.name ?? '').trim(),
          code: String(formData.code ?? '').trim(),
          active: formData.active == null ? true : Boolean(formData.active),
          sequence: Number(formData.sequence ?? 0),
          // Ensures template row lookup key is visible to static form–mutation tooling
          templateWarehouseId: String(templateWarehouseId),
        }) as unknown as CreateWarehouseParams,
      );
    } else if (action === 'createQualityCheck') {
      const productRaw = formData.productId;
      if (productRaw === '' || productRaw == null) return;
      const qtyTested = Number(formData.qtyTested ?? 0);
      await createQualityCheck.mutateAsync({
        name: String(formData.name ?? 'Quality Check'),
        testType: String(formData.testType ?? 'measure'),
        productId: BigInt(Number(productRaw)),
        productVariantId: undefined,
        pickingId: undefined,
        moveLineId: undefined,
        controlPointId: formData.pointId ? BigInt(Number(formData.pointId)) : undefined,
        lotId: formData.lotId ? BigInt(Number(formData.lotId)) : undefined,
        teamId: formData.teamId ? BigInt(Number(formData.teamId)) : undefined,
        userId: undefined,
        qtyTested: Number.isFinite(qtyTested) ? qtyTested : 0,
        toleranceMin: undefined,
        toleranceMax: undefined,
        normUnit: undefined,
        metadata: undefined,
      });
    } else if (action === 'createQualityAlert') {
      const name = String(formData.name ?? '').trim();
      const teamRaw = formData.teamId;
      if (!name || teamRaw === '' || teamRaw == null) return;
      const priorityKey = String(formData.priority ?? '2');
      const priorityByValue: Record<string, string> = {
        '0': 'normal',
        '1': 'low',
        '2': 'high',
        '3': 'critical',
      };
      await createQualityAlert.mutateAsync({
        teamId: Number(teamRaw),
        params: {
          title: name,
          priority: priorityByValue[priorityKey] ?? 'high',
          productId: formData.productId
            ? BigInt(Number(formData.productId))
            : undefined,
          productVariantId: undefined,
          lotId: undefined,
          reasonId: undefined,
          workcenterId: undefined,
          description: formData.description
            ? String(formData.description)
            : undefined,
          metadata: undefined,
        },
      });
    } else if (action === 'createReplenishmentRule') {
      const productRaw = formData.productId;
      const locRaw = formData.locationId;
      const uomRaw = formData.uomId;
      if (
        productRaw === '' ||
        productRaw == null ||
        locRaw === '' ||
        locRaw == null ||
        uomRaw === '' ||
        uomRaw == null
      ) {
        throw new Error(t('inventory.warehouseWorkspace.requiredValues', { defaultValue: 'Complete the required fields using available records. Your entries have been retained.' }));
      }
      const qtyMultipleRaw = Number(formData.qtyMultiple ?? 1);
      const leadDaysRaw = Math.floor(Number(formData.leadDays ?? 0));
      await createReplenishmentRule.mutateAsync({
        productId: Number(productRaw),
        locationId: Number(locRaw),
        warehouseId: formData.warehouseId
          ? Number(formData.warehouseId)
          : undefined,
        uomId: Number(uomRaw),
        productMinQty: Number(formData.minQty ?? 0),
        productMaxQty: Number(formData.maxQty ?? 0),
        qtyMultiple: Number.isFinite(qtyMultipleRaw) ? qtyMultipleRaw : 1,
        leadDays: Number.isFinite(leadDaysRaw) ? leadDaysRaw : 0,
        routeId: formData.routeId ? Number(formData.routeId) : undefined,
        trigger: String(formData.trigger ?? 'auto'),
        active: formData.active == null ? true : Boolean(formData.active),
      });
    } else if (action === 'createPickingWave') {
      const name = String(formData.name ?? '').trim();
      if (!name) return;
      await createPickingWave.mutateAsync(
        pickingWaveCreateParamsFromForm(formData) as unknown as CreatePickingWaveParams,
      );
    } else if (action === 'createProductCategory') {
      const productCategoryParams =
        toCreateProductCategoryParamsFromForm(formData);
      if (productCategoryParams)
        await createProductCategory.mutateAsync(
          productCategoryParams as unknown as CreateProductCategoryParams,
        );
    } else if (action === 'createBarcodeRule') {
      const barcodeRuleParams = toCreateBarcodeRuleParamsFromForm(formData);
      if (barcodeRuleParams)
        await createBarcodeRule.mutateAsync(
          barcodeRuleParams as unknown as CreateBarcodeRuleParams,
        );
    } else if (action === 'createAdjustmentReason') {
      const adjustmentReasonParams =
        toCreateAdjustmentReasonParamsFromForm(formData);
      if (adjustmentReasonParams)
        await createAdjustmentReason.mutateAsync(
          adjustmentReasonParams as unknown as CreateAdjustmentReasonParams,
        );
    } else if (action === 'createTraceabilityRecord') {
      const traceRecordParams =
        toCreateTraceabilityRecordParamsFromForm(formData);
      if (traceRecordParams)
        await createTraceabilityRecord.mutateAsync(
          traceRecordParams as unknown as CreateTraceabilityRecordParams,
        );
    } else if (action === 'createTraceabilityReport') {
      const traceReportParams =
        toCreateStockTraceabilityReportParamsFromForm(formData);
      if (traceReportParams)
        await createTraceabilityReport.mutateAsync(
          traceReportParams as unknown as CreateStockTraceabilityReportParams,
        );
    } else if (action === 'createStockQuant') {
      const stockQuantParams = toCreateStockQuantParamsFromForm(formData);
      if (!stockQuantParams) throw new Error(t('inventory.warehouseWorkspace.requiredValues', { defaultValue: 'Complete the required fields using available records. Your entries have been retained.' }));
      await createStockQuant.mutateAsync(
        stockQuantParams as unknown as CreateStockQuantParams,
      );
    } else if (action === 'createWarehouse3dZone') {
      const wid = formData.warehouseId;
      const lid = formData.locationId;
      if (wid === '' || wid == null || lid === '' || lid == null) return;
      await createWarehouse3dZone.mutateAsync({
        warehouseId: BigInt(String(wid)),
        locationId: BigInt(String(lid)),
        params: warehouse3dZoneParamsFromForm(
          formData,
        ) as unknown as CreateWarehouse3DZoneParams,
      });
    }
  };

  const isFormMutationPending =
    [
      stockMoveTabActions,
      inventoryCountTabActions,
      productionLotTabActions,
      productionSerialTabActions,
      qualityCheckTabActions,
      replenishmentTabActions,
      pickingWaveTabActions,
      stockRoutingTabActions,
      barcodeTabActions,
      warehouseTaskTabActions,
      createProduct,
      createStockPicking,
      createInventoryAdjustment,
      createStockLocation,
      updateStockLocation,
      createWarehouse,
      updateWarehouse,
      deleteWarehouse,
      updateProduct,
      deleteProduct,
      createProductVariant,
      deleteStockLocation,
      assignUserToPicking,
      pickingWorkflow,
      reserveQuant,
      unreserveQuant,
      stockQuantWorkflow,
      createQualityCheck,
      createQualityAlert,
      assignQualityAlert,
      cancelQualityAlert,
      createQualityPoint,
      deleteQualityPoint,
      createQualityTeam,
      deleteQualityTeam,
      createBarcodeRule,
      updateBarcodeRule,
      recordBarcodeScan,
      createAdjustmentReason,
      blockSerial,
      createTraceabilityRecord,
      createTraceabilityReport,
      runTraceabilityReport,
      createReplenishmentRule,
      createPickingWave,
      createProductCategory,
      updateProductCategory,
      deleteProductCategory,
      createStockRoute,
      updateStockRoute,
      createStockRule,
      updateStockRule,
      createWarehouseTask,
      openQualityAlert,
      solveQualityAlert,
      createStockQuant,
      updateStockQuantQuantity,
      updateProductVariant,
      updateProductInventoryData,
      updateProductPricing,
      createUomCategory,
      createUom,
      createUomConversion,
      createWarehouse3dZone,
      updateWarehouse3dZone,
      deleteWarehouse3dZone,
      createProductSupplierInfo,
      updateProductSupplierInfo,
      createProductPackaging,
      updateProductPackaging,
      restoreProductCategory,
      upsertWarehouseGeo,
    ].some((h) => h.isPending) ||
    Object.values(csvImports).some((h) => h.isPending);

  return (
    <>
      {activeTabUsable && formDialog}
      {/* A record selection must not outlive its actor, organization, or company. */}
      <ModuleView
        key={`${identity ?? 'anonymous'}:${sessionOrganizationId ?? 'no-organization'}:${organizationId}:${operatingCompanyId}`}
        config={config}
        data={data}
        dataLoading={{
          products: productsLoading,
          stock: stockQuantsLoading,
          transfers: transfersLoading,
        }}
        dataState={dataState}
        kpiStrips={kpiStrips}
        onFormSubmit={handleFormSubmit}
        isPending={isFormMutationPending}
        activeTab={activeTab}
        dashboardTimeRange={dashboardTimeRange}
        onDashboardTimeRangeChange={setDashboardTimeRange}
        onActiveTabChange={(tab) => {
          setActiveTab(tab);
          if (tab !== 'stock') setStockLocationFilter(null);
        }}
        onRowClick={(tabId, row) => {
          if (tabId === 'serials') setSelectedSerialRow(row);
          if (tabId === 'lots') setSelectedLotRow(row);
        }}
      />
      {stockLocationFilter ? (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          <span>
            {t('inventory.locationTree.filteredStock', {
              locationId: stockLocationFilter,
            })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setStockLocationFilter(null)}
          >
            {t('common.close')}
          </Button>
        </div>
      ) : null}
      <FormModal
        open={selectedSerialRow !== null && serialsUsable}
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
              data-testid="serial-detail-block-button"
              onClick={() => {
                const id = selectedSerialRow.id as ScalarId;
                setBlockSerialId(id);
              }}
            >
              {t('inventory.serialActions.block')}
            </Button>
          ) : null
        }
      />
      <FormModal
        open={selectedLotRow !== null && lotsUsable}
        onOpenChange={(open) => !open && setSelectedLotRow(null)}
        config={lotDetailModalConfig}
        isPending={isFormMutationPending}
        onSubmit={() => setSelectedLotRow(null)}
      />
      <FormModal
        key={
          blockSerialId != null
            ? `block-serial-${String(blockSerialId)}`
            : 'block-serial-closed'
        }
        open={blockSerialId !== null && serialsUsable}
        onOpenChange={(open) => !open && setBlockSerialId(null)}
        config={blockSerialForm(t)}
        isPending={isFormMutationPending}
        onSubmit={async (fd) => {
          if (blockSerialId == null) return;
          await blockSerial.block({
            serialId: String(blockSerialId),
            reason:
              fd.reason != null && String(fd.reason).trim() !== ''
                ? String(fd.reason).trim()
                : undefined,
          });
          setBlockSerialId(null);
          setSelectedSerialRow(null);
        }}
      />
      <FormModal
        open={createQualityAlertOpen && qualityUsable}
        onOpenChange={setCreateQualityAlertOpen}
        config={qualityAlertCreateFormConfig}
        isPending={isFormMutationPending}
        onSubmit={async (fd) => {
          await handleFormSubmit('quality-alerts', 'createQualityAlert', fd);
          setCreateQualityAlertOpen(false);
          setActiveTab('quality-alerts');
        }}
      />
      <FormModal
        key={
          assignQualityAlertId != null
            ? `assign-alert-${String(assignQualityAlertId)}`
            : 'assign-alert-closed'
        }
        open={assignQualityAlertId !== null && qualityUsable}
        onOpenChange={(open) => !open && setAssignQualityAlertId(null)}
        config={assignQualityAlertFormConfig}
        isPending={isFormMutationPending}
        onSubmit={async (fd) => {
          if (assignQualityAlertId == null) return;
          const raw = fd.userIdentity;
          const hex =
            raw != null && String(raw).trim() !== ''
              ? String(raw).trim()
              : null;
          await assignQualityAlert.mutateAsync({
            alertId: assignQualityAlertId,
            userId: hex,
          });
          setAssignQualityAlertId(null);
        }}
      />
      <FormModal
        key={
          solveQualityAlertId != null
            ? `solve-alert-${String(solveQualityAlertId)}`
            : 'solve-alert-closed'
        }
        open={solveQualityAlertId !== null && qualityUsable}
        onOpenChange={(open) => !open && setSolveQualityAlertId(null)}
        config={solveQualityAlertForm(t)}
        isPending={isFormMutationPending}
        onSubmit={async (fd) => {
          if (solveQualityAlertId == null) return;
          await solveQualityAlert.mutateAsync({
            alertId: solveQualityAlertId,
            description:
              fd.description != null && String(fd.description).trim() !== ''
                ? String(fd.description).trim()
                : null,
          });
          setSolveQualityAlertId(null);
        }}
      />
      <FormModal
        open={quickActionForm !== null && quickActionUsable}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? productFormConfig}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (quickActionForm) {
            await handleFormSubmit(
              'dashboard',
              quickActionForm.action,
              formData,
            );
            setQuickActionForm(null);
          }
        }}
      />
      <FormModal
        key={`rename-category-${identity}-${sessionOrganizationId}-${operatingCompanyId}-${String(renameCategoryRow?.id ?? 'closed')}`}
        open={renameCategoryRow !== null && categoriesUsable}
        onOpenChange={(open) => { if (!open) { renameCategoryEpoch.current++; setRenameCategoryRow(null); } }}
        config={{
          ...newProductCategoryForm(t),
          id: 'rename-product-category', title: t('inventory.categoryActions.rename'),
          description: t('inventory.categoryActions.renameDescription'),
          sections: [{ id: 'category-name', fields: [{
            id: 'name', name: 'name', type: 'text', required: true,
            label: t('inventory.forms.newProductCategory.fields.name'),
            defaultValue: String(renameCategoryRow?.name ?? ''),
          }] }],
        }}
        draft={false}
        isPending={renameCategory.isPending}
        submissionDisabled={permissionsReady === false || !checkPermission('product_category', 'write').allowed}
        onSubmit={async (fd) => {
          if (!renameCategoryRow || !categoriesUsable || permissionsReady === false || !checkPermission('product_category', 'write').allowed) throw new Error('Category unavailable.');
          const epoch = renameCategoryEpoch.current;
          await renameCategory.mutateAsync({ categoryId: renameCategoryRow.id as ScalarId,
            previousName: String(renameCategoryRow.name ?? ''), name: String(fd.name ?? '') });
          if (epoch === renameCategoryEpoch.current) setRenameCategoryRow(null);
        }}
      />
      <FormModal
        key={
          editProductRow
            ? `edit-product-${String(editProductRow.id)}`
            : 'edit-product-closed'
        }
        open={editProductRow !== null && productsUsable}
        onOpenChange={(open) => !open && setEditProductRow(null)}
        config={editProductModalConfig}
        isPending={isFormMutationPending}
        onSubmit={async (fd) => {
          if (!editProductRow) return;
          const id = editProductRow.id as ScalarId;
          await updateProduct.mutateAsync({
            productId: id,
            params: {
              name:
                fd.name != null && String(fd.name).trim() !== ''
                  ? String(fd.name)
                  : undefined,
              standardPrice:
                fd.standardPrice != null && fd.standardPrice !== ''
                  ? Number(fd.standardPrice)
                  : undefined,
              listPrice:
                fd.listPrice != null && fd.listPrice !== ''
                  ? Number(fd.listPrice)
                  : undefined,
              description:
                fd.description != null && String(fd.description).trim() !== ''
                  ? String(fd.description)
                  : undefined,
              saleOk: fd.saleOk != null ? Boolean(fd.saleOk) : undefined,
              purchaseOk:
                fd.purchaseOk != null ? Boolean(fd.purchaseOk) : undefined,
              active: fd.active != null ? Boolean(fd.active) : undefined,
              isPublished:
                fd.isPublished != null ? Boolean(fd.isPublished) : undefined,
            },
          });
        }}
      />
      <FormModal
        key={
          variantProductId != null
            ? `variant-${String(variantProductId)}`
            : 'variant-closed'
        }
        open={variantProductId !== null && productsUsable}
        onOpenChange={(open) => !open && setVariantProductId(null)}
        config={newProductVariantForm(t)}
        isPending={isFormMutationPending}
        onSubmit={async (fd) => {
          if (variantProductId == null) return;
          await createProductVariant.mutateAsync({
            productTmplId: variantProductId,
            params: {
              name: String(fd.name ?? '').trim(),
              attributeValueIds: [],
              standardPrice: Number(fd.standardPrice ?? 0),
              lstPrice: Number(fd.lstPrice ?? fd.standardPrice ?? 0),
              defaultCode: fd.defaultCode ? String(fd.defaultCode) : undefined,
              barcode: fd.barcode ? String(fd.barcode) : undefined,
            },
          });
        }}
      />
      <FormModal
        key={
          editWarehouseRow
            ? `edit-wh-${String(editWarehouseRow.id)}`
            : 'edit-wh-closed'
        }
        open={editWarehouseRow !== null && warehousesUsable}
        onOpenChange={(open) => !open && setEditWarehouseRow(null)}
        config={editWarehouseModalConfig}
        isPending={isFormMutationPending}
        onSubmit={async (fd) => {
          if (!editWarehouseRow) return;
          const id = editWarehouseRow.id as ScalarId;
          // "Not configured" clears the QC location only when one is set.
          const qcStockLocRaw = fd.whQcStockLocId;
          const whQcStockLocId =
            qcStockLocRaw == null || String(qcStockLocRaw).trim() === ''
              ? undefined
              : scalarToU64(String(qcStockLocRaw));
          const clearWhQcStockLocId =
            whQcStockLocId === undefined && editWarehouseRow.whQcStockLocId != null
              ? true
              : undefined;
          await updateWarehouse.mutateAsync({
            warehouseId: id,
            params: {
              whQcStockLocId,
              clearWhQcStockLocId,
              name:
                fd.name != null && String(fd.name).trim() !== ''
                  ? String(fd.name)
                  : undefined,
              code:
                fd.code != null && String(fd.code).trim() !== ''
                  ? String(fd.code)
                  : undefined,
              active: fd.active != null ? Boolean(fd.active) : undefined,
              receptionSteps:
                fd.receptionSteps != null &&
                String(fd.receptionSteps).trim() !== ''
                  ? String(fd.receptionSteps)
                  : undefined,
              deliverySteps:
                fd.deliverySteps != null &&
                String(fd.deliverySteps).trim() !== ''
                  ? String(fd.deliverySteps)
                  : undefined,
              manufactureSteps:
                fd.manufactureSteps != null &&
                String(fd.manufactureSteps).trim() !== ''
                  ? String(fd.manufactureSteps)
                  : undefined,
              buyToResupply:
                fd.buyToResupply != null
                  ? Boolean(fd.buyToResupply)
                  : undefined,
              manufactureToResupply:
                fd.manufactureToResupply != null
                  ? Boolean(fd.manufactureToResupply)
                  : undefined,
              crossdock:
                fd.crossdock != null ? Boolean(fd.crossdock) : undefined,
              sequence:
                fd.sequence != null && fd.sequence !== ''
                  ? Number(fd.sequence)
                  : undefined,
              metadata:
                fd.metadata != null && String(fd.metadata).trim() !== ''
                  ? String(fd.metadata)
                  : undefined,
            },
          });
        }}
      />
      {moveQuantRow != null && stockUsable && moveQuantFormConfig ? (
        <FormModal
          key={`move-quant-${String(moveQuantRow.id ?? '')}`}
          open
          onOpenChange={(open) => {
            if (!open) {
              setMoveQuantRow(null);
              setMoveQuantError(null);
            }
          }}
          config={moveQuantFormConfig}
          closeOnSubmit={false}
          submitError={moveQuantError}
          isPending={stockQuantWorkflow.isPending}
          onSubmit={async (formData) => {
            setMoveQuantError(null);
            const quantId = moveQuantRow.id;
            const targetLocationId = formData.targetLocationId;
            const quantity = Number(formData.quantity);
            if (
              quantId == null ||
              targetLocationId == null ||
              targetLocationId === '' ||
              !Number.isFinite(quantity)
            ) {
              setMoveQuantError(t('common.validation.required'));
              return;
            }
            try {
              await stockQuantWorkflow.move(
                {
                  quantId: String(quantId),
                  targetLocationId: String(targetLocationId),
                  quantity,
                },
                { navigateToNext: true },
              );
              setMoveQuantRow(null);
            } catch (error) {
              setMoveQuantError(
                error instanceof Error ? error.message : String(error),
              );
            }
          }}
        />
      ) : null}
      {partialTransferPicking != null && transfersUsable && partialTransferFormConfig ? (
        <FormModal
          key={`partial-transfer-${String(partialTransferPicking.id ?? '')}`}
          open
          onOpenChange={(open) => {
            if (!open) {
              setPartialTransferPicking(null);
              setPartialTransferError(null);
            }
          }}
          config={partialTransferFormConfig}
          closeOnSubmit={false}
          submitError={partialTransferError}
          isPending={pickingWorkflow.isPending}
          onSubmit={async (formData) => {
            setPartialTransferError(null);
            if (assignedMovesForPartialTransfer.length === 0) {
              setPartialTransferError(
                t('sales.forms.partialDelivery.errors.noAssignedMoves'),
              );
              return;
            }
            const pickingId = partialTransferPicking.id;
            if (pickingId == null) return;
            const plan = planPartialDelivery(
              assignedMovesForPartialTransfer.map((move) => ({
                moveId: String(move.id),
                orderedQty: move.productUomQty,
              })),
              formData,
            );
            if (!plan.ok) {
              setPartialTransferError(
                t(`sales.forms.partialDelivery.errors.${plan.error}`),
              );
              return;
            }
            try {
              await pickingWorkflow.partialValidate.execute(
                {
                  pickingId: String(pickingId),
                  shortMoves: plan.shortMoves,
                  createBackorder: formData.createBackorder === true,
                },
                { navigateToNext: true },
              );
              setPartialTransferPicking(null);
            } catch (error) {
              setPartialTransferError(
                error instanceof Error ? error.message : String(error),
              );
            }
          }}
        />
      ) : null}
      <FormModal
        key={
          assignPickingId != null
            ? `assign-${String(assignPickingId)}`
            : 'assign-closed'
        }
        open={assignPickingId !== null && transfersUsable}
        onOpenChange={(open) => !open && setAssignPickingId(null)}
        config={assignUserFormConfig}
        isPending={isFormMutationPending}
        onSubmit={async (fd) => {
          if (assignPickingId == null) return;
          const raw = fd.userIdentity;
          const hex =
            raw != null && String(raw).trim() !== ''
              ? String(raw).trim()
              : null;
          await assignUserToPicking.mutateAsync({
            pickingId: assignPickingId,
            params: { userId: hex },
          });
        }}
      />
      <FormModal
        key={
          supplierLineProductId != null
            ? `supplier-${String(supplierLineProductId)}`
            : 'supplier-closed'
        }
        open={supplierLineProductId !== null && productsUsable}
        onOpenChange={(open) => !open && setSupplierLineProductId(null)}
        config={productSupplierLineFormConfig}
        isPending={isFormMutationPending}
        onSubmit={async (fd) => {
          if (supplierLineProductId == null) return;
          const partnerRaw = fd.partnerId;
          const curRaw = fd.currencyId;
          if (
            partnerRaw === '' ||
            partnerRaw == null ||
            curRaw === '' ||
            curRaw == null
          )
            return;
          const tmplRaw = fd.productTmplId;
          const tmplOpt =
            tmplRaw !== '' && tmplRaw != null && String(tmplRaw).trim() !== ''
              ? Number(tmplRaw)
              : Number(supplierLineProductId);
          await createProductSupplierInfo.mutateAsync({
            partnerId: Number(partnerRaw),
            productTmplId: tmplOpt,
            minQty: Number(fd.minQty ?? 0),
            price: Number(fd.price ?? 0),
            currencyId: Number(curRaw),
            delay: Math.floor(Number(fd.delay ?? 0)),
            sequence: Math.floor(Number(fd.sequence ?? 10)),
          });
          setSupplierLineProductId(null);
        }}
      />
      <FormModal
        key={
          packagingProductId != null
            ? `pkg-${String(packagingProductId)}`
            : 'pkg-closed'
        }
        open={packagingProductId !== null && productsUsable}
        onOpenChange={(open) => !open && setPackagingProductId(null)}
        config={productPackagingFormConfig}
        isPending={isFormMutationPending}
        onSubmit={async (fd) => {
          if (packagingProductId == null) return;
          const uomRaw = fd.uomId;
          const name = String(fd.name ?? '').trim();
          if (name === '' || uomRaw === '' || uomRaw == null) return;
          await createProductPackaging.mutateAsync({
            productId: packagingProductId,
            params: {
              name,
              qty: Number(fd.qty ?? 1),
              uomId: Number(uomRaw),
              barcode:
                fd.barcode != null && String(fd.barcode).trim() !== ''
                  ? String(fd.barcode)
                  : undefined,
              length: Number(fd.length ?? 0),
              width: Number(fd.width ?? 0),
              height: Number(fd.height ?? 0),
              weight: Number(fd.weight ?? 0),
              maxWeight: Number(fd.maxWeight ?? 0),
            },
          });
          setPackagingProductId(null);
        }}
      />
      {csvKind === 'product' ? (
        <ImportAssistantWizard
          sourceState={csvSourceState}
          key="product-assistant"
          open
          organizationId={organizationId}
          onOpenChange={(open) => !open && setCsvKind(null)}
          targetEntity="product"
          title={t('inventory.csvImport.productsTitle')}
          isImportPending={csvImports.importProduct.isPending}
          onImport={async (csvData) => {
            const pl = pricelists.find(
              (p) => p.currencyId != null && String(p.currencyId).trim() !== '',
            );
            if (pl == null || pl.currencyId == null) {
              throw new Error(t('inventory.csvImport.noPricelistCurrency'));
            }
            await csvImports.importProduct.mutateAsync({
              csvData,
              currencyId: Number(pl.currencyId),
            });
          }}
        />
      ) : null}
      {csvKind && csvKind !== 'product' && csvFormConfig ? (
        <CsvImportModal
          sourceState={csvSourceState}
          trackedImport={{ companyId: operatingCompanyId }}
          organizationId={orgId}
          tableName={{ uomCategory: "uom_category", uom: "uom", productCategory: "product_category", product: "product", productVariant: "product_variant", warehouse: "warehouse", stockLocation: "stock_location", stockQuant: "stock_quant", lot: "stock_production_lot" }[csvKind]}
          key={csvKind}
          onClose={() => setCsvKind(null)}
          config={csvFormConfig}
          isPending={isFormMutationPending}
          onImport={async (text) => {
            if (csvKind === 'uomCategory')
              await csvImports.importUomCategory.mutateAsync(text);
            else if (csvKind === 'uom')
              await csvImports.importUom.mutateAsync(text);
            else if (csvKind === 'productCategory')
              await csvImports.importProductCategory.mutateAsync(text);
            else if (csvKind === 'productVariant')
              await csvImports.importProductVariant.mutateAsync(text);
            else if (csvKind === 'warehouse')
              await csvImports.importWarehouse.mutateAsync(text);
            else if (csvKind === 'stockLocation')
              await csvImports.importStockLocation.mutateAsync(text);
            else if (csvKind === 'stockQuant')
              await csvImports.importStockQuant.mutateAsync(text);
            else if (csvKind === 'lot')
              await csvImports.importLot.mutateAsync(text);
          }}
        />
      ) : null}
    </>
  );
}

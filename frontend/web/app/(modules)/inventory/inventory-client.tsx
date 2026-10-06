'use client';
import {
  mapDashboardWidgets,
  withDashboardSections,
} from '@lumiere/ui/lib/dashboard-sections';

import { useMemo, useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useTranslation } from '@lumiere/i18n';
import {
  ModuleView,
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
  productsTableConfig,
  productDetailConfig,
  productStatusBadges,
  stockQuantsTableConfig,
  stockQuantDetailConfig,
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
import { formNumber, formText, recordOptions, useFormDialog } from '@lumiere/ui';
import type {
  EntityTableConfig,
  EntityViewConfig,
  EntityRecordSheetConfig,
  FormConfig,
  ModuleConfig,
} from '@lumiere/ui';
import { inventoryModuleConfig } from '@/lib/module-dashboard-configs';
import { useModuleTab } from '@/hooks/use-module-tab';
import { useInventoryModuleSubscription } from '@/lib/module-subscription-hooks';
import { useWorkflowSurface } from '@/hooks/use-workflow-surface';
import { usePickingWorkflow } from '@lumiere/query-hooks/hooks/picking-workflow';
import { useStockQuantWorkflow } from '@lumiere/query-hooks/hooks/stock-quant-workflow';
import { useQualityCheckFailWorkflow } from '@lumiere/query-hooks/hooks/quality-check-fail-workflow';
import { useReplenishmentExecutionWorkflow } from '@lumiere/query-hooks/hooks/replenishment-execution-workflow';
import { useSerialReserveWorkflow } from '@lumiere/query-hooks/hooks/serial-reserve-workflow';
import { useSerialUseWorkflow } from '@lumiere/query-hooks/hooks/serial-use-workflow';
import { useSerialBlockWorkflow } from '@lumiere/query-hooks/hooks/serial-block-workflow';
import { planPartialDelivery } from '@lumiere/erp-workflows';
import { groupBy } from '@/lib/utils';
import { InventoryOpsPanel } from './inventory-ops-panel';
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
  useInventoryExceptionsShortAtp,
  useInventoryExceptionsExpiredLots,
  useInventoryExceptionsOpenQc,
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
  useAssignUserToPicking,
  useProcessInventoryAdjustment,
  useReserveStockQuant,
  useUnreserveStockQuant,
  useWarehouse3D,
  useOrgUsers,
  // Quality management
  useCreateQualityCheck,
  usePassQualityCheck,
  useCreateQualityAlert,
  useAssignQualityAlert,
  useCancelQualityAlert,
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
  useCreateStockProductionLot,
  useCreateStockProductionSerial,
  useCreateTraceabilityRecord,
  useCreateTraceabilityReport,
  useRunTraceabilityReport,
  // Replenishment
  useCreateReplenishmentRule,
  useScheduleReplenishmentRun,
  useCancelReplenishmentRun,
  // Picking waves
  useCreatePickingWave,
  useConfirmPickingWave,
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
  useStockInventories,
} from '@lumiere/query-hooks/hooks/inventory';
import { useIotDevices } from '@lumiere/query-hooks/hooks/iot';
import { usePricelists, type ProductPricelist } from '@lumiere/query-hooks/hooks/sales';
import { useContacts } from '@lumiere/query-hooks/hooks/crm';
import { useDocuments } from '@lumiere/query-hooks/hooks/documents';
import { hasValidOrganizationId, orgBigInts } from '@/lib/org-scoped';
import { useDefaultOperatingCompanyBigInt } from '@lumiere/query-hooks/hooks/use-operating-company';
import { inventoryProductPrimaryLabel } from '@lumiere/stdb/read-models';

type ScalarId = bigint | number | string;

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
  ShieldCheck,
  AlertTriangle,
  ScanLine,
  RefreshCw,
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
  toCreateProductParamsFromForm,
  toCreateStockLocationParamsFromForm,
  toCreateStockMoveParams,
  toCreateStockPickingParamsFromForm,
  toCreateStockQuantParamsFromForm,
  toCreateStockTraceabilityReportParamsFromForm,
  toCreateTraceabilityRecordParamsFromForm,
  warehouse3dZoneParamsFromForm,
} from '@/lib/inventory-ext-params';
import { withDefaultsFromRow } from '@/lib/prefill-form-config';
import { stbTimestampFromDate } from '@/lib/stb-timestamp';
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
  const { askForm, formDialog } = useFormDialog();
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
    () => [
      ...inventoryModuleConfig(t).tabs.map((tab) => tab.id),
      'cycle-wizard',
      'location-tree',
      'quality-alerts',
      '3d-view',
    ],
    [t],
  );
  const { activeTab, setActiveTab } = useModuleTab(
    'dashboard',
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

  const { data: products = [], isLoading: productsLoading } = useProducts(
    orgId,
    initialProducts,
  );
  const { data: productCategories = [] } = useProductCategories(
    orgId,
    initialProductCategories,
  );
  const { data: uoms = [] } = useUoms(orgId, initialUoms);
  const { data: stockInventories = [] } = useStockInventories(orgId);
  const { data: iotDevices = [] } = useIotDevices(orgId);
  const { data: stockQuants = [], isLoading: stockQuantsLoading } =
    useStockQuants(orgId, initialStockQuants);
  const { data: transfers = [], isLoading: transfersLoading } =
    useStockPickings(orgId, initialTransfers);
  const { data: warehouses = [] } = useWarehouses(orgId, initialWarehouses);
  const { data: adjustments = [] } = useInventoryAdjustments(
    orgId,
    initialAdjustments,
  );
  const { data: locations = [] } = useStockLocations(
    orgId,
    initialStockLocations,
  );
  const { data: lots = [] } = useProductionLots(orgId);
  const { data: serials = [] } = useStockProductionSerials(
    orgId,
    initialStockProductionSerials,
  );
  const { data: qualityChecks = [] } = useQualityChecks(orgId);
  const { data: qualityTeams = [] } = useQualityTeams(orgId);
  const { data: cycleCounts = [] } = useStockCycleCounts(
    orgId,
    initialStockCycleCounts,
  );
  const { data: pickingWaves = [] } = usePickingWaves(orgId);
  const { data: warehouseTasks = [] } = useWarehouseTasks(orgId);
  const { data: stockRoutes = [] } = useStockRoutes(orgId);
  const { data: stockRules = [] } = useStockRules(orgId);
  const { data: stockMoves = [] } = useStockMoves(orgId, initialStockMoves);
  const { data: inventoryValuations = [] } = useInventoryValuations(
    orgId,
    initialInventoryValuations,
  );
  const { data: replenishmentRulesList = [] } = useReplenishmentRules(
    orgId,
    initialReplenishmentRules,
  );
  const { data: barcodeRules = [] } = useBarcodeRules(orgId);
  const { data: adjustmentReasons = [] } = useAdjustmentReasons(orgId);
  const { data: barcodeNomenclatures = [] } = useBarcodeNomenclatures(orgId);
  const { data: serialLotTraceability = [] } = useSerialLotTraceability(orgId);
  const { data: stockTraceabilityReports = [] } =
    useStockTraceabilityReports(orgId);
  const { data: shortAtpExceptions = [] } =
    useInventoryExceptionsShortAtp(orgId);
  const { data: expiredLotExceptions = [] } =
    useInventoryExceptionsExpiredLots(orgId);
  const { data: openQcExceptions = [] } = useInventoryExceptionsOpenQc(orgId);
  const { data: orgUsers = [] } = useOrgUsers();
  const { data: pricelists = [] } = usePricelists(orgId, initialPricelists);
  const { data: contacts = [] } = useContacts(orgId);
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
  const createStockInventory = useCreateStockInventory(
    orgId,
    operatingCompanyId,
  );
  const createStockInventoryLine = useCreateStockInventoryLine(
    orgId,
    operatingCompanyId,
  );
  const updateStockInventoryState = useUpdateStockInventoryState(
    orgId,
    operatingCompanyId,
  );
  const createStockLocation = useCreateStockLocation(orgId);
  const updateStockLocation = useUpdateStockLocation(orgId);
  const createWarehouse = useCreateWarehouse(orgId, selectedOperatingCompanyId);
  const updateWarehouse = useUpdateWarehouse(orgId, selectedOperatingCompanyId);
  const deleteWarehouse = useDeleteWarehouse(orgId, selectedOperatingCompanyId);
  const updateProduct = useUpdateProduct(orgId);
  const deleteProduct = useDeleteProduct(orgId);
  const createProductVariant = useCreateProductVariant(orgId);
  const deleteStockLocation = useDeleteStockLocation(orgId);
  const createStockMove = useCreateStockMove(orgId, operatingCompanyId);
  const confirmStockMove = useConfirmStockMove(orgId, operatingCompanyId);
  const assignStockMove = useAssignStockMove(orgId, operatingCompanyId);
  const doneStockMove = useDoneStockMove(orgId, operatingCompanyId);
  const cancelStockMove = useCancelStockMove(orgId, operatingCompanyId);
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
  const processAdjustment = useProcessInventoryAdjustment(orgId);
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
        value: String((team as Record<string, unknown>).id ?? ''),
        label: String(
          (team as Record<string, unknown>).name ??
            (team as Record<string, unknown>).id ??
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
  const passQualityCheck = usePassQualityCheck(orgId, operatingCompanyId);
  const failQualityCheck = useQualityCheckFailWorkflow(
    orgId,
    operatingCompanyId ?? 0n,
    workflowSurface,
  );
  const createQualityAlert = useCreateQualityAlert(orgId, operatingCompanyId);
  const assignQualityAlert = useAssignQualityAlert(orgId, operatingCompanyId);
  const cancelQualityAlert = useCancelQualityAlert(orgId, operatingCompanyId);
  const createQualityPoint = useCreateQualityPoint(orgId, operatingCompanyId);
  const updateQualityPoint = useUpdateQualityPoint(orgId, operatingCompanyId);
  const deleteQualityPoint = useDeleteQualityPoint(orgId, operatingCompanyId);
  const createQualityTeam = useCreateQualityTeam(orgId, operatingCompanyId);
  const updateQualityTeam = useUpdateQualityTeam(orgId, operatingCompanyId);
  const deleteQualityTeam = useDeleteQualityTeam(orgId, operatingCompanyId);

  // Barcode hooks
  const createBarcodeRule = useCreateBarcodeRule(orgId, operatingCompanyId);
  const updateBarcodeRule = useUpdateBarcodeRule(orgId, operatingCompanyId);
  const deleteBarcodeRule = useDeleteBarcodeRule(orgId, operatingCompanyId);
  const recordBarcodeScan = useRecordBarcodeScan(orgId, operatingCompanyId);
  const createBarcodeNomenclature = useCreateBarcodeNomenclature(
    orgId,
    operatingCompanyId,
  );
  const updateBarcodeNomenclature = useUpdateBarcodeNomenclature(
    orgId,
    operatingCompanyId,
  );
  const deleteBarcodeNomenclature = useDeleteBarcodeNomenclature(
    orgId,
    operatingCompanyId,
  );
  const addRuleToNomenclature = useAddRuleToNomenclature(
    orgId,
    operatingCompanyId,
  );
  const removeRuleFromNomenclature = useRemoveRuleFromNomenclature(
    orgId,
    operatingCompanyId,
  );
  const createAdjustmentReason = useCreateAdjustmentReason(
    orgId,
    operatingCompanyId,
  );
  const useSerial = useSerialUseWorkflow(orgId, workflowSurface);
  const blockSerial = useSerialBlockWorkflow(orgId, workflowSurface);
  const reserveSerial = useSerialReserveWorkflow(orgId, workflowSurface);
  const createStockProductionLot = useCreateStockProductionLot(
    orgId,
    operatingCompanyId,
  );
  const createStockProductionSerial = useCreateStockProductionSerial(
    orgId,
    operatingCompanyId,
  );
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
  const confirmPickingWave = useConfirmPickingWave(orgId, operatingCompanyId);
  const completePickingWave = useCompletePickingWave(orgId, operatingCompanyId);

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
  const deleteStockRoute = useDeleteStockRoute(orgId, operatingCompanyId);
  const createStockRule = useCreateStockRule(orgId, operatingCompanyId);
  const updateStockRule = useUpdateStockRule(orgId, operatingCompanyId);
  const deleteStockRule = useDeleteStockRule(orgId, operatingCompanyId);

  // Warehouse task hooks
  const createWarehouseTask = useCreateWarehouseTask(orgId, operatingCompanyId);
  const startWarehouseTask = useStartWarehouseTask(
    orgId,
    selectedOperatingCompanyId,
  );
  const completeWarehouseTask = useCompleteWarehouseTask(
    orgId,
    selectedOperatingCompanyId,
  );
  const cancelWarehouseTask = useCancelWarehouseTask(
    orgId,
    selectedOperatingCompanyId,
  );

  const startQualityCheck = useStartQualityCheck(
    orgId,
    selectedOperatingCompanyId,
  );
  const openQualityAlert = useOpenQualityAlert(
    orgId,
    selectedOperatingCompanyId,
  );
  const solveQualityAlert = useSolveQualityAlert(
    orgId,
    selectedOperatingCompanyId,
  );
  const createQualityAlertReason = useCreateQualityAlertReason(orgId);
  const updateQualityAlertReason = useUpdateQualityAlertReason(orgId);
  const deleteQualityAlertReason = useDeleteQualityAlertReason(orgId);
  const addMemberToQualityTeam = useAddMemberToQualityTeam(orgId);
  const removeMemberFromQualityTeam = useRemoveMemberFromQualityTeam(orgId);
  const executeReplenishmentRule = useReplenishmentExecutionWorkflow(
    orgId,
    operatingCompanyId,
    workflowSurface,
  );
  const scheduleReplenishmentRun = useScheduleReplenishmentRun(
    orgId,
    operatingCompanyId,
  );
  const cancelReplenishmentRun = useCancelReplenishmentRun(
    orgId,
    operatingCompanyId,
  );
  const createStockQuant = useCreateStockQuant(orgId, {
    companyId: operatingCompanyId ?? undefined,
  });
  const updateStockQuantQuantity = useUpdateStockQuantQuantity(
    orgId,
    operatingCompanyId,
  );
  const updateStockProductionLot = useUpdateStockProductionLot(orgId);
  const deleteStockProductionLot = useDeleteStockProductionLot(orgId);
  const updateStockProductionSerial = useUpdateStockProductionSerial(orgId);
  const deleteStockProductionSerial = useDeleteStockProductionSerial(orgId);
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
  const updateWarehouseTaskStatus = useUpdateWarehouseTaskStatus(
    orgId,
    selectedOperatingCompanyId,
  );
  const linkDeviceToQualityCheck = useLinkDeviceToQualityCheck(orgId);
  const createProductSupplierInfo = useCreateProductSupplierInfo(orgId);
  const updateProductSupplierInfo = useUpdateProductSupplierInfo(orgId);
  const createProductPackaging = useCreateProductPackaging(orgId);
  const updateProductPackaging = useUpdateProductPackaging(orgId);
  const restoreProductCategory = useRestoreProductCategory(orgId);
  const upsertWarehouseGeo = useUpsertWarehouseGeo(orgId);
  const updateWhatsappQualityScore = useUpdateWhatsappQualityScore(orgId);

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
    const base = productsTableConfig(t, {
      formatProductDisplayName: inventoryProductPrimaryLabel,
      onEmptyAction: openCreateProduct,
    });
    const view = base.view as EntityTableConfig;
    return {
      ...base,
      view: {
        ...view,
        emptyState: {
          ...view.emptyState,
          onAction: openCreateProduct,
        },
      },
    };
  }, [t, openCreateProduct]);

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
      detailConfig: productDetailConfig(t),
      auditTableName: 'product',
      discussion: {},
    };
  }, [t]);

  const stockQuantRecordSheet = useMemo((): EntityRecordSheetConfig => {
    const baseDetail = stockQuantDetailConfig(t);
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
  }, [t, productLabelById, locationLabelById]);

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
                void updateWarehouse3dZone.mutateAsync({
                  zoneId: Number(values.zoneId),
                  params: color ? { color } : {},
                });
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
                void deleteWarehouse3dZone.mutateAsync(Number(values.zoneId));
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
                      fields: [
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
                      fields: [
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
      if (tab.id === 'stock-moves') {
        return {
          ...tab,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: 'create-stock-move',
                  label: t('inventory.stockMoveActions.create'),
                  icon: Plus,
                  requiresSelection: false,
                  onClick: async () => {
                    const values = await askForm({
                      title: t('inventory.stockMoveActions.create'),
                      fields: [
                        {
                          id: 'productId',
                          name: 'productId',
                          label: lbl.product,
                          type: 'select',
                          required: true,
                          options: productSelectOptions,
                        },
                        {
                          id: 'productUom',
                          name: 'productUom',
                          label: lbl.uom,
                          type: 'select',
                          required: true,
                          options: uomFieldOptions,
                        },
                        {
                          id: 'locationId',
                          name: 'locationId',
                          label: lbl.sourceLocation,
                          type: 'select',
                          required: true,
                          options: stockOnHandLocationOptions,
                          width: '1/2',
                        },
                        {
                          id: 'locationDestId',
                          name: 'locationDestId',
                          label: lbl.destLocation,
                          type: 'select',
                          required: true,
                          options: stockOnHandLocationOptions,
                          width: '1/2',
                        },
                        {
                          id: 'quantity',
                          name: 'quantity',
                          label: t('inventory.stockMoveActions.quantityPrompt'),
                          type: 'number',
                          required: true,
                          defaultValue: 1,
                          min: 0,
                          width: '1/2',
                        },
                        {
                          id: 'name',
                          name: 'name',
                          label: t('inventory.stockMoveActions.namePrompt'),
                          type: 'text',
                          defaultValue: 'Manual Stock Move',
                          width: '1/2',
                        },
                      ],
                    });
                    if (!values) return;
                    const quantity = formNumber(values.quantity);
                    if (quantity == null) return;
                    await createStockMove.mutateAsync(
                      toCreateStockMoveParams({
                        companyId: operatingCompanyId,
                        name: formText(values.name) ?? 'Manual Stock Move',
                        productId: Number(values.productId),
                        productUom: Number(values.productUom),
                        quantity,
                        locationId: Number(values.locationId),
                        locationDestId: Number(values.locationDestId),
                      }),
                    );
                  },
                },
                {
                  id: 'confirm-move',
                  label: t('inventory.stockMoveActions.confirm'),
                  icon: CheckCircle,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id != null) await confirmStockMove.mutateAsync(id);
                  },
                },
                {
                  id: 'assign-move',
                  label: t('inventory.stockMoveActions.assign'),
                  icon: UserCircle2,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id != null) await assignStockMove.mutateAsync(id);
                  },
                },
                {
                  id: 'done-move',
                  label: t('inventory.stockMoveActions.done'),
                  icon: CheckCircle,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const row = rows[0] as Record<string, unknown> | undefined;
                    const id = row?.id as ScalarId | undefined;
                    if (id == null) return;
                    const def = Number(
                      row?.productUomQty ?? row?.product_uom_qty ?? 1,
                    );
                    const values = await askForm({
                      title: t('inventory.stockMoveActions.done'),
                      fields: [
                        {
                          id: 'quantityDone',
                          name: 'quantityDone',
                          label: t('inventory.stockMoveActions.quantityDonePrompt'),
                          type: 'number',
                          required: true,
                          min: 0,
                          defaultValue: Number.isFinite(def) ? def : 1,
                        },
                      ],
                    });
                    if (!values) return;
                    const qty = formNumber(values.quantityDone);
                    if (qty == null) return;
                    await doneStockMove.mutateAsync({
                      moveId: id,
                      quantityDone: qty,
                    });
                  },
                },
                {
                  id: 'cancel-move',
                  label: t('inventory.stockMoveActions.cancel'),
                  icon: XCircle,
                  variant: 'destructive',
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id != null) await cancelStockMove.mutateAsync(id);
                  },
                },
              ],
            },
          },
        };
      }
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
      if (tab.id === 'adjustments') {
        return {
          ...tab,
          createForm: adjustmentFormConfig,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: 'create-stock-inventory',
                  label: t('inventory.stockInventoryActions.create'),
                  icon: Plus,
                  requiresSelection: false,
                  onClick: async () => {
                    const values = await askForm({
                      title: t('inventory.stockInventoryActions.create'),
                      fields: [
                        {
                          id: 'name',
                          name: 'name',
                          label: t('inventory.stockInventoryActions.namePrompt'),
                          type: 'text',
                          required: true,
                          defaultValue: 'Cycle Count',
                        },
                      ],
                    });
                    const name = formText(values?.name);
                    if (name == null || operatingCompanyId == null) return;
                    await createStockInventory.mutateAsync({
                      company_id: Number(operatingCompanyId),
                      name,
                      location_ids: [],
                      product_ids: [],
                      lot_ids: [],
                      owner_ids: [],
                      package_ids: [],
                      accounting_date: null,
                      category_id: null,
                      counted_mode: 'all',
                      is_stock_check: true,
                      metadata: null,
                    });
                  },
                },
                {
                  id: 'create-stock-inventory-line',
                  label: t('inventory.stockInventoryActions.addLine'),
                  icon: ListChecks,
                  requiresSelection: false,
                  onClick: async () => {
                    const values = await askForm({
                      title: t('inventory.stockInventoryActions.addLine'),
                      fields: [
                        {
                          id: 'inventoryId',
                          name: 'inventoryId',
                          label: lbl.inventory,
                          type: 'select',
                          required: true,
                          options: stockInventoryOptions,
                        },
                        {
                          id: 'productId',
                          name: 'productId',
                          label: lbl.product,
                          type: 'select',
                          required: true,
                          options: productSelectOptions,
                        },
                        {
                          id: 'uomId',
                          name: 'uomId',
                          label: lbl.uom,
                          type: 'select',
                          required: true,
                          options: uomFieldOptions,
                          width: '1/2',
                        },
                        {
                          id: 'locationId',
                          name: 'locationId',
                          label: lbl.location,
                          type: 'select',
                          required: true,
                          options: stockOnHandLocationOptions,
                          width: '1/2',
                        },
                        {
                          id: 'qty',
                          name: 'qty',
                          label: t('inventory.stockInventoryActions.productQtyPrompt'),
                          type: 'number',
                          required: true,
                          min: 0,
                          defaultValue: 0,
                        },
                      ],
                    });
                    if (!values) return;
                    const inventoryId = formText(values.inventoryId);
                    const productId = formText(values.productId);
                    const uomId = formText(values.uomId);
                    const locationId = formText(values.locationId);
                    const qty = formNumber(values.qty);
                    if (
                      inventoryId == null ||
                      productId == null ||
                      uomId == null ||
                      locationId == null ||
                      qty == null
                    )
                      return;
                    await createStockInventoryLine.mutateAsync({
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
                        state: 'draft',
                        product_tracking: 'none',
                        product_barcode: null,
                        product_type: 'product',
                        is_editable: true,
                        outdated: false,
                        inventory_location_id_name: null,
                        inventory_product_id_name: null,
                        theoretical_qty_text: null,
                        product_uom_category_id: null,
                        metadata: null,
                      },
                    });
                  },
                },
                {
                  id: 'set-stock-inventory-state',
                  label: t('inventory.stockInventoryActions.setState'),
                  icon: Pencil,
                  requiresSelection: false,
                  onClick: async () => {
                    const values = await askForm({
                      title: t('inventory.stockInventoryActions.setState'),
                      fields: [
                        {
                          id: 'inventoryId',
                          name: 'inventoryId',
                          label: lbl.inventory,
                          type: 'select',
                          required: true,
                          options: stockInventoryOptions,
                        },
                        {
                          id: 'newState',
                          name: 'newState',
                          label: t('inventory.stockInventoryActions.statePrompt'),
                          type: 'select',
                          required: true,
                          defaultValue: 'confirm',
                          options: stockInventoryStateOptions,
                        },
                      ],
                    });
                    if (!values) return;
                    const inventoryId = formText(values.inventoryId);
                    const newState = formText(values.newState);
                    if (inventoryId == null || newState == null) return;
                    await updateStockInventoryState.mutateAsync({
                      inventoryId,
                      newState,
                    });
                  },
                },
                {
                  id: 'process-adjustment',
                  label: t('inventory.adjustmentActions.process'),
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id != null) await processAdjustment.mutateAsync(id);
                  },
                },
              ],
            },
          },
        };
      }
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
      if (tab.id === 'lots') {
        return {
          ...tab,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: 'csv-lot',
                  label: t('inventory.csvImport.toolbarLots'),
                  onClick: () => setCsvKind('lot'),
                },
                {
                  id: 'create-lot',
                  label: t('inventory.lotActions.create'),
                  icon: Plus,
                  requiresSelection: false,
                  onClick: async () => {
                    const values = await askForm({
                      title: t('inventory.lotActions.create'),
                      fields: [
                        {
                          id: 'name',
                          name: 'name',
                          label: t('inventory.lotActions.namePrompt'),
                          type: 'text',
                          required: true,
                        },
                        {
                          id: 'productId',
                          name: 'productId',
                          label: lbl.product,
                          type: 'select',
                          required: true,
                          options: productSelectOptions,
                        },
                      ],
                    });
                    if (!values) return;
                    const name = formText(values.name);
                    const productId = formText(values.productId);
                    if (
                      name == null ||
                      productId == null ||
                      operatingCompanyId == null
                    )
                      return;
                    await createStockProductionLot.mutateAsync({
                      companyId: BigInt(operatingCompanyId),
                      name,
                      productId: BigInt(Number(productId)),
                      productVariantId: undefined,
                      ref: undefined,
                      note: undefined,
                      expirationDate: undefined,
                      useDate: undefined,
                      removalDate: undefined,
                      alertDate: undefined,
                      productQty: 0,
                      locationId: undefined,
                      packageId: undefined,
                      ownerId: undefined,
                      isScrap: false,
                      isLocked: false,
                      metadata: undefined,
                    });
                  },
                },
                {
                  id: 'edit-lot-note',
                  label: t('inventory.lotActions.editNote'),
                  icon: Pencil,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const row = rows[0] as Record<string, unknown> | undefined;
                    const id = row?.id as ScalarId | undefined;
                    if (id == null) return;
                    const values = await askForm({
                      title: t('inventory.lotActions.editNote'),
                      fields: [
                        {
                          id: 'note',
                          name: 'note',
                          label: t('inventory.lotActions.notePrompt'),
                          type: 'textarea',
                          rows: 3,
                          defaultValue: String(row?.note ?? ''),
                        },
                      ],
                    });
                    if (!values) return;
                    await updateStockProductionLot.mutateAsync({
                      lotId: id,
                      params: {
                        companyId: undefined,
                        note: formText(values.note),
                      },
                    });
                  },
                },
                {
                  id: 'delete-lot',
                  label: t('common.delete'),
                  icon: Trash2,
                  variant: 'destructive',
                  requiresSelection: true,
                  confirm: {
                    title: t('common.delete'),
                    description: t('inventory.lotActions.confirmDelete'),
                    confirmLabel: t('common.confirm'),
                    cancelLabel: t('common.cancel'),
                  },
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id == null) return;
                    await deleteStockProductionLot.mutateAsync(id);
                  },
                },
              ],
            },
          },
        };
      }
      if (tab.id === 'serials') {
        return {
          ...tab,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: 'create-serial',
                  label: t('inventory.serialActions.create'),
                  icon: Plus,
                  requiresSelection: false,
                  onClick: async () => {
                    const values = await askForm({
                      title: t('inventory.serialActions.create'),
                      fields: [
                        {
                          id: 'name',
                          name: 'name',
                          label: t('inventory.serialActions.namePrompt'),
                          type: 'text',
                          required: true,
                        },
                        {
                          id: 'productId',
                          name: 'productId',
                          label: lbl.product,
                          type: 'select',
                          required: true,
                          options: productSelectOptions,
                        },
                      ],
                    });
                    if (!values) return;
                    const name = formText(values.name);
                    const productId = formText(values.productId);
                    if (
                      name == null ||
                      productId == null ||
                      operatingCompanyId == null
                    )
                      return;
                    await createStockProductionSerial.mutateAsync({
                      companyId: BigInt(operatingCompanyId),
                      name,
                      productId: BigInt(Number(productId)),
                      productVariantId: undefined,
                      lotId: undefined,
                      ref: undefined,
                      note: undefined,
                      expirationDate: undefined,
                      useDate: undefined,
                      removalDate: undefined,
                      alertDate: undefined,
                      productQty: 1,
                      locationId: undefined,
                      packageId: undefined,
                      ownerId: undefined,
                      // The serial lifecycle only recognizes "free" as the
                      // initial state (reserve_serial/use_serial/etc. all
                      // check for it verbatim) — "available" left every
                      // UI-created serial permanently unreservable.
                      state: 'free',
                      isScrap: false,
                      isLocked: false,
                      warrantyExpiration: undefined,
                      warrantyStart: undefined,
                      lastMaintenance: undefined,
                      nextMaintenance: undefined,
                      maintenanceCount: 0,
                      metadata: undefined,
                    });
                  },
                },
                {
                  id: 'reserve-serial',
                  label: t('inventory.productionSerials.actions.reserve'),
                  icon: ListChecks,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id != null)
                      await reserveSerial.reserve(
                        { serialId: String(id) },
                        { navigateToNext: true },
                      );
                  },
                },
                {
                  id: 'use-serial',
                  label: t('inventory.productionSerials.actions.markInUse'),
                  icon: CheckCircle,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id != null)
                      await useSerial.markInUse(
                        { serialId: String(id) },
                        { navigateToNext: true },
                      );
                  },
                },
                {
                  id: 'edit-serial-note',
                  label: t('inventory.serialActions.editNote'),
                  icon: Pencil,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const row = rows[0] as Record<string, unknown> | undefined;
                    const id = row?.id as ScalarId | undefined;
                    if (id == null) return;
                    const values = await askForm({
                      title: t('inventory.serialActions.editNote'),
                      fields: [
                        {
                          id: 'note',
                          name: 'note',
                          label: t('inventory.serialActions.notePrompt'),
                          type: 'textarea',
                          rows: 3,
                          defaultValue: String(row?.note ?? ''),
                        },
                      ],
                    });
                    if (!values) return;
                    await updateStockProductionSerial.mutateAsync({
                      serialId: id,
                      params: {
                        companyId: undefined,
                        note: formText(values.note),
                      },
                    });
                  },
                },
                {
                  id: 'delete-serial',
                  label: t('common.delete'),
                  icon: Trash2,
                  variant: 'destructive',
                  requiresSelection: true,
                  confirm: {
                    title: t('common.delete'),
                    description: t('inventory.serialActions.confirmDelete'),
                    confirmLabel: t('common.confirm'),
                    cancelLabel: t('common.cancel'),
                  },
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id == null) return;
                    await deleteStockProductionSerial.mutateAsync(id);
                  },
                },
              ],
            },
          },
        };
      }
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
      if (tab.id === 'quality') {
        return {
          ...tab,
          createAction: 'createQualityCheck',
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
                  id: 'quality-alerts-tab',
                  label: t('inventory.qualityAlerts.tabLabel'),
                  icon: AlertTriangle,
                  requiresSelection: false,
                  onClick: () => setActiveTab('quality-alerts'),
                },
                {
                  id: 'create-quality-alert',
                  label: t('inventory.forms.newQualityAlert.title'),
                  icon: Plus,
                  requiresSelection: false,
                  onClick: () => setCreateQualityAlertOpen(true),
                },
                {
                  id: 'pass-check',
                  label: t('inventory.qualityActions.pass'),
                  icon: ShieldCheck,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id != null)
                      await passQualityCheck.mutateAsync({ checkId: id });
                  },
                },
                {
                  id: 'fail-check',
                  label: t('inventory.qualityActions.fail'),
                  icon: AlertTriangle,
                  variant: 'destructive',
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const row = rows[0];
                    const id = row?.id;
                    const productId = row?.productId;
                    const companyId = row?.companyId;
                    const lotId = row?.lotId;
                    if (id == null || productId == null || companyId == null)
                      return;
                    const quarantineWarehouse = warehouses.find(
                      (w) => w.whQcStockLocId != null,
                    );
                    const configuredQuarantineLocationId =
                      quarantineWarehouse?.whQcStockLocId;
                    // No warehouse in this org has a configured QC location yet
                    // (wh_qc_stock_loc_id is create-only, never set by seed data
                    // or update_warehouse) — ask the operator which location the
                    // failed stock quarantines to.
                    const values = await askForm({
                      title: t('inventory.qualityActions.fail'),
                      submitLabel: t('inventory.qualityActions.fail'),
                      fields: [
                        ...(configuredQuarantineLocationId == null
                          ? [
                              {
                                id: 'quarantineLocationId',
                                name: 'quarantineLocationId',
                                label: lbl.quarantineLocation,
                                type: 'select' as const,
                                required: true,
                                options: stockOnHandLocationOptions,
                              },
                            ]
                          : []),
                        {
                          id: 'reason',
                          name: 'reason',
                          label: lbl.failReason,
                          type: 'textarea' as const,
                          rows: 3,
                        },
                      ],
                    });
                    if (!values) return;
                    const quarantineLocationId =
                      configuredQuarantineLocationId ??
                      formText(values.quarantineLocationId);
                    if (quarantineLocationId == null) return;
                    await failQualityCheck.fail(
                      {
                        checkId: String(id),
                        productId: String(productId),
                        lotId: lotId != null ? String(lotId) : undefined,
                        companyId: String(companyId),
                        quarantineLocationId: String(quarantineLocationId),
                        qtyFailed: 1,
                        note: formText(values.reason),
                      },
                      { navigateToNext: true },
                    );
                  },
                },
                {
                  id: 'start-check',
                  label: t('inventory.qualityActions.startCheck'),
                  icon: ListChecks,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id != null) await startQualityCheck.mutateAsync(id);
                  },
                },
                {
                  id: 'link-device-check',
                  label: t('inventory.qualityActions.linkDevice'),
                  icon: ScanLine,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const checkId = rows[0]?.id as ScalarId | undefined;
                    if (checkId == null) return;
                    const values = await askForm({
                      title: t('inventory.qualityActions.linkDevice'),
                      fields: [
                        {
                          id: 'deviceId',
                          name: 'deviceId',
                          label: lbl.device,
                          type: 'select',
                          required: true,
                          options: iotDeviceOptions,
                        },
                      ],
                    });
                    const deviceId = formNumber(values?.deviceId);
                    if (deviceId == null) return;
                    await linkDeviceToQualityCheck.mutateAsync({
                      deviceId,
                      checkId,
                    });
                  },
                },
                {
                  id: 'add-alert-reason',
                  label: t('inventory.qualityActions.addAlertReason'),
                  requiresSelection: false,
                  onClick: async () => {
                    const values = await askForm({
                      title: t('inventory.qualityActions.addAlertReason'),
                      fields: [
                        {
                          id: 'name',
                          name: 'name',
                          label: t('inventory.qualityActions.alertReasonNamePrompt'),
                          type: 'text',
                          required: true,
                        },
                        {
                          id: 'description',
                          name: 'description',
                          label: t('inventory.qualityActions.alertReasonDescPrompt'),
                          type: 'textarea',
                          rows: 3,
                        },
                      ],
                    });
                    const name = formText(values?.name);
                    if (name == null) return;
                    await createQualityAlertReason.mutateAsync({
                      name,
                      description: formText(values?.description) ?? null,
                    });
                  },
                },
                {
                  id: 'update-alert-reason',
                  label: t('inventory.qualityActions.updateAlertReason'),
                  requiresSelection: false,
                  onClick: async () => {
                    const values = await askForm({
                      title: t('inventory.qualityActions.updateAlertReason'),
                      fields: [
                        {
                          id: 'recordId',
                          name: 'recordId',
                          label: t('inventory.byRecord.reasonId', { defaultValue: 'Alert reason ID' }),
                          type: 'number',
                          required: true,
                          min: 1,
                        },
                        { id: 'name', name: 'name', label: t('inventory.byRecord.name', { defaultValue: 'Name' }), type: 'text', required: true },
                      ],
                    });
                    if (!values) return;
                    await updateQualityAlertReason.mutateAsync({
                      reasonId: Number(values.recordId),
                      params: { name: formText(values.name) ?? null },
                    });
                  },
                },
                {
                  id: 'delete-alert-reason',
                  label: t('inventory.qualityActions.deleteAlertReason'),
                  variant: 'destructive',
                  requiresSelection: false,
                  onClick: async () => {
                    const values = await askForm({
                      title: t('inventory.qualityActions.deleteAlertReason'),
                      submitLabel: t('common.delete'),
                      fields: [{
                          id: 'recordId',
                          name: 'recordId',
                          label: t('inventory.byRecord.reasonId', { defaultValue: 'Alert reason ID' }),
                          type: 'number',
                          required: true,
                          min: 1,
                        }],
                    });
                    if (!values) return;
                    await deleteQualityAlertReason.mutateAsync(Number(values.recordId));
                  },
                },
                {
                  id: 'add-team-member',
                  label: t('inventory.qualityActions.addTeamMember'),
                  requiresSelection: false,
                  onClick: async () => {
                    const values = await askForm({
                      title: t('inventory.qualityActions.addTeamMember'),
                      fields: [{
                          id: 'teamId',
                          name: 'teamId',
                          label: t('inventory.byRecord.team', { defaultValue: 'Quality team' }),
                          type: 'select',
                          required: true,
                          options: recordOptions(qualityTeams as Record<string, unknown>[], (row) => String(row.name ?? row.id)),
                        }, {
                          id: 'member',
                          name: 'member',
                          label: t('inventory.byRecord.member', { defaultValue: 'Member identity' }),
                          type: 'text',
                          required: true,
                        }],
                    });
                    if (!values) return;
                    await addMemberToQualityTeam.mutateAsync({
                      teamId: Number(values.teamId),
                      memberIdentityHex: String(values.member).trim(),
                    });
                  },
                },
                {
                  id: 'update-quality-point',
                  label: t('inventory.qualityActions.updatePoint'),
                  icon: Pencil,
                  requiresSelection: false,
                  onClick: async () => {
                    const values = await askForm({
                      title: t('inventory.qualityActions.updatePoint'),
                      fields: [
                        {
                          id: 'recordId',
                          name: 'recordId',
                          label: t('inventory.byRecord.pointId', { defaultValue: 'Quality point ID' }),
                          type: 'number',
                          required: true,
                          min: 1,
                        },
                        { id: 'name', name: 'name', label: t('inventory.byRecord.name', { defaultValue: 'Name' }), type: 'text' },
                        { id: 'testType', name: 'testType', label: t('inventory.byRecord.testType', { defaultValue: 'Test type' }), type: 'text' },
                      ],
                    });
                    if (!values) return;
                    const name = formText(values.name);
                    const testType = formText(values.testType);
                    if (name == null && testType == null) return;
                    await updateQualityPoint.mutateAsync({
                      pointId: Number(values.recordId),
                      params: { name, testType },
                    });
                  },
                },
                {
                  id: 'update-quality-team',
                  label: t('inventory.qualityActions.updateTeam'),
                  icon: Pencil,
                  requiresSelection: false,
                  onClick: async () => {
                    const values = await askForm({
                      title: t('inventory.qualityActions.updateTeam'),
                      fields: [
                        {
                          id: 'teamId',
                          name: 'teamId',
                          label: t('inventory.byRecord.team', { defaultValue: 'Quality team' }),
                          type: 'select',
                          required: true,
                          options: recordOptions(qualityTeams as Record<string, unknown>[], (row) => String(row.name ?? row.id)),
                        },
                        { id: 'name', name: 'name', label: t('inventory.byRecord.name', { defaultValue: 'Name' }), type: 'text' },
                        { id: 'email', name: 'email', label: t('inventory.byRecord.email', { defaultValue: 'Email' }), type: 'email' },
                      ],
                    });
                    if (!values) return;
                    const name = formText(values.name);
                    const email = formText(values.email);
                    if (name == null && email == null) return;
                    await updateQualityTeam.mutateAsync({
                      teamId: Number(values.teamId),
                      params: { name, email },
                    });
                  },
                },
                {
                  id: 'remove-team-member',
                  label: t('inventory.qualityActions.removeTeamMember'),
                  variant: 'destructive',
                  requiresSelection: false,
                  onClick: async () => {
                    const values = await askForm({
                      title: t('inventory.qualityActions.removeTeamMember'),
                      submitLabel: t('common.remove', { defaultValue: 'Remove' }),
                      fields: [{
                          id: 'teamId',
                          name: 'teamId',
                          label: t('inventory.byRecord.team', { defaultValue: 'Quality team' }),
                          type: 'select',
                          required: true,
                          options: recordOptions(qualityTeams as Record<string, unknown>[], (row) => String(row.name ?? row.id)),
                        }, {
                          id: 'member',
                          name: 'member',
                          label: t('inventory.byRecord.member', { defaultValue: 'Member identity' }),
                          type: 'text',
                          required: true,
                        }],
                    });
                    if (!values) return;
                    await removeMemberFromQualityTeam.mutateAsync({
                      teamId: Number(values.teamId),
                      memberIdentityHex: String(values.member).trim(),
                    });
                  },
                },
              ],
            },
          },
        };
      }
      // Replenishment rules actions
      if (tab.id === 'replenishment') {
        return {
          ...tab,
          createAction: 'createReplenishmentRule',
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
                  id: 'execute-replenishment-rule',
                  label: t('inventory.replenishmentActions.executeRule'),
                  icon: ListChecks,
                  requiresSelection: true,
                  confirm: {
                    title: t('inventory.replenishmentActions.executeRule'),
                    description: `${t('inventory.replenishmentActions.executeRule')}\n${t('inventory.replenishmentActions.executeRuleHint')}`,
                    confirmLabel: t('common.confirm'),
                    cancelLabel: t('common.cancel'),
                  },
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id == null) return;
                    if (
                      typeof globalThis.crypto === 'undefined' ||
                      typeof globalThis.crypto.randomUUID !== 'function'
                    ) {
                      return;
                    }
                    await executeReplenishmentRule.execute(
                      {
                        ruleId: String(id),
                        idempotencyKey: globalThis.crypto.randomUUID(),
                      },
                      { navigateToNext: true },
                    );
                  },
                },
                {
                  id: 'schedule-replenishment-run',
                  label: t('inventory.replenishmentActions.scheduleRun'),
                  icon: ListChecks,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id != null)
                      await scheduleReplenishmentRun.mutateAsync(id);
                  },
                },
                {
                  id: 'cancel-replenishment-run',
                  label: t('inventory.replenishmentActions.cancelSchedule'),
                  icon: ListChecks,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id != null) await cancelReplenishmentRun.mutateAsync(id);
                  },
                },
              ],
            },
          },
        };
      }
      // Picking waves actions
      if (tab.id === 'picking-waves') {
        return {
          ...tab,
          createAction: 'createPickingWave',
          createForm: mergeSelectOptionsForFields(newPickingWaveForm(t), {
            userId: assignUserFieldOptions,
          }),
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: 'confirm-wave',
                  label: t('inventory.pickingWaveActions.confirm'),
                  icon: CheckCircle,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id != null) await confirmPickingWave.mutateAsync(id);
                  },
                },
                {
                  id: 'complete-wave',
                  label: t('inventory.pickingWaveActions.complete'),
                  icon: ListChecks,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id != null) await completePickingWave.mutateAsync(id);
                  },
                },
              ],
            },
          },
        };
      }
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
                  id: 'delete-category',
                  label: t('common.delete'),
                  icon: Trash2,
                  variant: 'destructive',
                  requiresSelection: true,
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
      if (tab.id === 'routes') {
        return {
          ...tab,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: 'delete-route',
                  label: t('common.delete'),
                  icon: Trash2,
                  variant: 'destructive',
                  requiresSelection: true,
                  confirm: {
                    title: t('common.delete'),
                    description: t('inventory.routeActions.confirmDelete'),
                    confirmLabel: t('common.confirm'),
                    cancelLabel: t('common.cancel'),
                  },
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id == null) return;
                    await deleteStockRoute.mutateAsync(id);
                  },
                },
              ],
            },
          },
        };
      }
      // Stock rules actions
      if (tab.id === 'rules') {
        return {
          ...tab,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: 'delete-rule',
                  label: t('common.delete'),
                  icon: Trash2,
                  variant: 'destructive',
                  requiresSelection: true,
                  confirm: {
                    title: t('common.delete'),
                    description: t('inventory.ruleActions.confirmDelete'),
                    confirmLabel: t('common.confirm'),
                    cancelLabel: t('common.cancel'),
                  },
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id == null) return;
                    await deleteStockRule.mutateAsync(id);
                  },
                },
              ],
            },
          },
        };
      }
      // Barcode rules actions
      if (tab.id === 'barcode-rules') {
        return {
          ...tab,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: 'set-whatsapp-quality-score',
                  label: t('inventory.barcodeActions.setWhatsappQualityScore'),
                  icon: ScanLine,
                  requiresSelection: false,
                  onClick: async () => {
                    // WhatsApp accounts have no list query yet, so the account is
                    // still identified by its id.
                    const values = await askForm({
                      title: t('inventory.barcodeActions.setWhatsappQualityScore'),
                      fields: [
                        {
                          id: 'accountId',
                          name: 'accountId',
                          label: lbl.whatsappAccount,
                          type: 'number',
                          required: true,
                          min: 1,
                        },
                        {
                          id: 'qualityScore',
                          name: 'qualityScore',
                          label: lbl.qualityRating,
                          type: 'select',
                          required: true,
                          defaultValue: 'UNKNOWN',
                          options: [
                            { value: 'GREEN', label: 'GREEN' },
                            { value: 'YELLOW', label: 'YELLOW' },
                            { value: 'RED', label: 'RED' },
                            { value: 'UNKNOWN', label: 'UNKNOWN' },
                          ],
                        },
                      ],
                    });
                    if (!values) return;
                    const accountId = formText(values.accountId);
                    const qualityScore = formText(values.qualityScore);
                    if (accountId == null || qualityScore == null) return;
                    await updateWhatsappQualityScore.mutateAsync({
                      accountId,
                      qualityScore,
                    });
                  },
                },
                {
                  id: 'delete-barcode-rule',
                  label: t('common.delete'),
                  icon: Trash2,
                  variant: 'destructive',
                  requiresSelection: true,
                  confirm: {
                    title: t('common.delete'),
                    description: t('inventory.barcodeActions.confirmDelete'),
                    confirmLabel: t('common.confirm'),
                    cancelLabel: t('common.cancel'),
                  },
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id == null) return;
                    await deleteBarcodeRule.mutateAsync(id);
                  },
                },
              ],
            },
          },
        };
      }
      if (tab.id === 'traceability-records') {
        return {
          ...tab,
          createForm: traceRecordFormConfig,
        };
      }
      if (tab.id === 'barcode-nomenclatures') {
        return {
          ...tab,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: 'create-barcode-nomenclature',
                  label: t('inventory.barcodeNomenclatures.actions.create'),
                  icon: Plus,
                  requiresSelection: false,
                  onClick: async () => {
                    const values = await askForm({
                      title: t('inventory.barcodeNomenclatures.actions.create'),
                      fields: [
                        {
                          id: 'name',
                          name: 'name',
                          label: t('inventory.barcodeNomenclatures.actions.namePrompt'),
                          type: 'text',
                          required: true,
                        },
                      ],
                    });
                    const name = formText(values?.name);
                    if (name == null) return;
                    await createBarcodeNomenclature.mutateAsync({
                      name,
                      description: null,
                      is_default: false,
                      upc_ean_conv: 'none',
                      is_active: true,
                      metadata: null,
                    });
                  },
                },
                {
                  id: 'update-barcode-nomenclature',
                  label: t('common.edit'),
                  icon: Pencil,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const row = rows[0] as Record<string, unknown> | undefined;
                    const nomenclatureId = row?.id as ScalarId | undefined;
                    if (nomenclatureId == null) return;
                    const values = await askForm({
                      title: t('common.edit'),
                      fields: [
                        {
                          id: 'name',
                          name: 'name',
                          label: t('inventory.barcodeNomenclatures.actions.namePrompt'),
                          type: 'text',
                          required: true,
                          defaultValue: String(row?.name ?? ''),
                        },
                      ],
                    });
                    const name = formText(values?.name);
                    if (name == null) return;
                    await updateBarcodeNomenclature.mutateAsync({
                      nomenclatureId,
                      params: { name, isActive: true },
                    });
                  },
                },
                {
                  id: 'add-rule-to-nomenclature',
                  label: t('inventory.barcodeNomenclatures.actions.addRule'),
                  icon: Plus,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const nomenclatureId = rows[0]?.id as ScalarId | undefined;
                    if (nomenclatureId == null) return;
                    const values = await askForm({
                      title: t('inventory.barcodeNomenclatures.actions.addRule'),
                      fields: [
                        {
                          id: 'ruleId',
                          name: 'ruleId',
                          label: lbl.rule,
                          type: 'select',
                          required: true,
                          options: barcodeRuleOptions,
                        },
                      ],
                    });
                    const ruleId = formText(values?.ruleId);
                    if (ruleId == null) return;
                    await addRuleToNomenclature.mutateAsync({
                      nomenclatureId,
                      ruleId,
                    });
                  },
                },
                {
                  id: 'remove-rule-from-nomenclature',
                  label: t('inventory.barcodeNomenclatures.actions.removeRule'),
                  icon: Pencil,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const nomenclatureId = rows[0]?.id as ScalarId | undefined;
                    if (nomenclatureId == null) return;
                    const values = await askForm({
                      title: t('inventory.barcodeNomenclatures.actions.removeRule'),
                      fields: [
                        {
                          id: 'ruleId',
                          name: 'ruleId',
                          label: lbl.rule,
                          type: 'select',
                          required: true,
                          options: barcodeRuleOptions,
                        },
                      ],
                    });
                    const ruleId = formNumber(values?.ruleId);
                    if (ruleId == null) return;
                    await removeRuleFromNomenclature.mutateAsync({
                      nomenclatureId,
                      ruleId,
                    });
                  },
                },
                {
                  id: 'delete-barcode-nomenclature',
                  label: t('common.delete'),
                  icon: Trash2,
                  variant: 'destructive',
                  requiresSelection: true,
                  confirm: {
                    title: t('common.delete'),
                    description: t(
                          'inventory.barcodeNomenclatures.actions.confirmDelete',
                        ),
                    confirmLabel: t('common.confirm'),
                    cancelLabel: t('common.cancel'),
                  },
                  onClick: async (rows) => {
                    const nomenclatureId = rows[0]?.id as ScalarId | undefined;
                    if (nomenclatureId == null)
                      return;
                    await deleteBarcodeNomenclature.mutateAsync(
                      nomenclatureId,
                    );
                  },
                },
              ],
            },
          },
        };
      }
      if (tab.id === 'traceability-reports') {
        return {
          ...tab,
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
      if (tab.id === 'warehouse-tasks') {
        return {
          ...tab,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...v,
              actions: [
                {
                  id: 'start-task',
                  label: t('inventory.taskActions.start'),
                  icon: CheckCircle,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id != null) await startWarehouseTask.mutateAsync(id);
                  },
                },
                {
                  id: 'complete-task',
                  label: t('inventory.taskActions.complete'),
                  icon: ListChecks,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id != null)
                      await completeWarehouseTask.mutateAsync({
                        taskId: id,
                        result: {},
                      });
                  },
                },
                {
                  id: 'cancel-task',
                  label: t('inventory.taskActions.cancel'),
                  icon: XCircle,
                  variant: 'destructive',
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id != null) await cancelWarehouseTask.mutateAsync(id);
                  },
                },
                {
                  id: 'set-task-status',
                  label: t('inventory.taskActions.setStatus'),
                  icon: Pencil,
                  requiresSelection: true,
                  onClick: async (rows) => {
                    const id = rows[0]?.id as ScalarId | undefined;
                    if (id == null) return;
                    const values = await askForm({
                      title: t('inventory.taskActions.setStatus'),
                      fields: [
                        {
                          id: 'status',
                          name: 'status',
                          label: lbl.status,
                          type: 'select',
                          required: true,
                          options: warehouseTaskStatusOptions,
                        },
                      ],
                    });
                    const newStatus = formText(values?.status);
                    if (newStatus == null) return;
                    await updateWarehouseTaskStatus.mutateAsync({
                      taskId: id,
                      newStatus,
                    });
                  },
                },
              ],
            },
          },
        };
      }
      return tab;
    };

    return {
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
          if (tab.id === 'locations') return withTransferActions(tab);
          if (tab.id === 'cycle-counts') return withTransferActions(tab);
          if (tab.id === 'quality') return withTransferActions(tab);
          if (tab.id === 'replenishment') return withTransferActions(tab);
          if (tab.id === 'picking-waves') return withTransferActions(tab);
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
    } as ModuleConfig;
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
    productsEntityConfig,
    stockEntityConfig,
    transfersEntityConfig,
    productRecordSheet,
    stockQuantRecordSheet,
    transferRecordSheet,
    t,
    pickingWorkflow,
    processAdjustment,
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
    updateQualityPoint,
    deleteQualityPoint,
    updateQualityTeam,
    deleteQualityTeam,
    // Picking waves
    confirmPickingWave,
    completePickingWave,
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
    updateWarehouseTaskStatus,
    executeReplenishmentRule,
    scheduleReplenishmentRun,
    cancelReplenishmentRun,
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
      products: (products as Record<string, unknown>[]).map((row) => ({
        ...row,
        sheetTitle:
          inventoryProductPrimaryLabel(row) || String(row.name ?? row.id ?? ''),
      })),
      stock: filteredStockQuants.map((row) => {
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
            [productLabel, locationLabel].filter(Boolean).join(' · ') ||
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
      lots: lots as unknown as Record<string, unknown>[],
      serials: serials as unknown as Record<string, unknown>[],
      quality: qualityChecks as unknown as Record<string, unknown>[],
      'cycle-counts': cycleCounts as unknown as Record<string, unknown>[],
      'picking-waves': pickingWaves as unknown as Record<string, unknown>[],
      'warehouse-tasks': warehouseTasks as unknown as Record<string, unknown>[],
      routes: stockRoutes as unknown as Record<string, unknown>[],
      rules: stockRules as unknown as Record<string, unknown>[],
      'stock-moves': stockMoves as unknown as Record<string, unknown>[],
      valuations: inventoryValuations as unknown as Record<string, unknown>[],
      replenishment: replenishmentRulesList as unknown as Record<
        string,
        unknown
      >[],
      'barcode-rules': barcodeRules as unknown as Record<string, unknown>[],
      'product-categories': productCategories as unknown as Record<
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

  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === 'createProduct') {
      const pricelistRaw = formData.pricelistId;
      if (pricelistRaw === '' || pricelistRaw == null) return;
      const pl = pricelists.find((p) => String(p.id) === String(pricelistRaw));
      if (pl == null || pl.currencyId === undefined || pl.currencyId === null)
        return;
      const currencyId = Number(pl.currencyId);
      const productParams = toCreateProductParamsFromForm(formData, currencyId);
      if (productParams)
        await createProduct.mutateAsync(
          productParams as unknown as CreateProductParams,
        );
    } else if (action === 'createTransfer' || action === 'createStockPicking') {
      const stockPickingParams = toCreateStockPickingParamsFromForm(formData);
      if (stockPickingParams)
        await createStockPicking.mutateAsync(
          stockPickingParams as unknown as CreateStockPickingParams,
        );
    } else if (
      action === 'createAdjustment' ||
      action === 'createInventoryAdjustment'
    ) {
      const productRaw = formData.productId;
      if (productRaw === '' || productRaw == null) return;
      const productRow = products.find(
        (p) => String(p.id) === String(productRaw),
      );
      const uomFromProduct =
        productRow?.uomId != null
          ? Number(productRow.uomId)
          : productRow?.uomPoId != null
            ? Number(productRow.uomPoId)
            : undefined;
      if (uomFromProduct == null || Number.isNaN(uomFromProduct)) return;
      const adjustmentParams = toCreateInventoryAdjustmentParamsFromForm(
        formData,
        uomFromProduct,
      );
      if (adjustmentParams)
        await createInventoryAdjustment.mutateAsync(
          adjustmentParams as unknown as CreateInventoryAdjustmentParams,
        );
    } else if (action === 'createStockLocation') {
      const stockLocationParams = toCreateStockLocationParamsFromForm(formData);
      if (stockLocationParams)
        await createStockLocation.mutateAsync(
          stockLocationParams as unknown as CreateStockLocationParams,
        );
    } else if (action === 'createWarehouse') {
      const templateWarehouseId = formData.templateWarehouseId;
      if (templateWarehouseId === '' || templateWarehouseId == null) return;
      const template = warehouses.find(
        (w) => String(w.id) === String(templateWarehouseId),
      ) as Record<string, unknown> | undefined;
      if (!template) return;
      try {
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
      } catch {
        return;
      }
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
        return;
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
      if (stockQuantParams)
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
      pickingWorkflow,
      processAdjustment,
      reserveQuant,
      unreserveQuant,
      stockQuantWorkflow,
      createQualityCheck,
      passQualityCheck,
      failQualityCheck,
      createQualityAlert,
      assignQualityAlert,
      cancelQualityAlert,
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
      createPickingWave,
      confirmPickingWave,
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
    ].some((h) => h.isPending) ||
    Object.values(csvImports).some((h) => h.isPending);

  return (
    <>
      {formDialog}
      {/* key={operatingCompanyId} forces React to remount ModuleView when the operating company
          changes, preventing stale inventory rows from a previous company leaking into the new view. */}
      <ModuleView
        key={
          operatingCompanyId != null ? String(operatingCompanyId) : 'no-company'
        }
        config={config}
        data={data}
        dataLoading={{
          products: productsLoading,
          stock: stockQuantsLoading,
          transfers: transfersLoading,
        }}
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
        open={selectedLotRow !== null}
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
        open={blockSerialId !== null}
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
        open={createQualityAlertOpen}
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
        open={assignQualityAlertId !== null}
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
        open={solveQualityAlertId !== null}
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
        open={quickActionForm !== null}
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
        key={
          editProductRow
            ? `edit-product-${String(editProductRow.id)}`
            : 'edit-product-closed'
        }
        open={editProductRow !== null}
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
        open={variantProductId !== null}
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
        open={editWarehouseRow !== null}
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
      {moveQuantRow != null && moveQuantFormConfig ? (
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
      {partialTransferPicking != null && partialTransferFormConfig ? (
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
        open={assignPickingId !== null}
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
        open={supplierLineProductId !== null}
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
        open={packagingProductId !== null}
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
            else if (csvKind === 'product') {
              const pl = pricelists.find(
                (p) =>
                  p.currencyId != null && String(p.currencyId).trim() !== '',
              );
              if (pl == null || pl.currencyId == null) {
                throw new Error(t('inventory.csvImport.noPricelistCurrency'));
              }
              await csvImports.importProduct.mutateAsync({
                csvData: text,
                currencyId: Number(pl.currencyId),
              });
            }
          }}
        />
      ) : null}
    </>
  );
}

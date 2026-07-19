'use client';

import { phCapture } from '@/lib/posthog-browser';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@lumiere/i18n';
import {
  ModuleView,
  FormModal,
  RuntimeFormModal,
  useRBAC,
  newSaleOrderForm,
  newPricelistForm,
  newPricelistItemForm,
  newPickingBatchForm,
  newLoyaltyCardForm,
  newDeliveryCarrierForm,
  newShippingMethodForm,
  newPosPaymentMethodForm,
  newLoyaltyProgramForm,
  newReturnOrderForm,
  addSaleOrderLineForm,
  createInvoiceFromSaleOrderForm,
  buildPartialDeliveryForm,
  cancelPickingConfirmForm,
  editSaleOrderForm,
  InvoiceListView,
  MissingOrganization,
  mergeSelectOptionsForFields,
  mergeFieldDefaultValues,
  saleOrdersTableConfig,
  saleOrderDetailConfig,
  saleOrderStatusBadges,
  saleOrderLinesTableConfig,
  pricelistsTableConfig,
  pricelistItemsTableConfig,
  deliveriesTableConfig,
  salesFulfillmentTableConfig,
  salesReturnsTableConfig,
  returnOrderLinesTableConfig,
  EntityView,
  Button,
  csvImportForm,
  ImportAssistantWizard,
  getRowField,
  RecordChatterDialog,
  buildModuleTabHref,
  type TimeRangeValue,
  isTimestampInRange,
  percentChange,
  previousPeriodMs,
  timeRangeToMs,
} from '@lumiere/ui';
import type {
  EntityViewConfig,
  EntityTableConfig,
  EntityRecordSheetConfig,
  FormConfig,
  ModuleConfig,
} from '@lumiere/ui';
import {
  toCreatePickingBatchParams,
  toCreatePricelistParams,
  toCreatePricelistItemParams,
  toCreateSaleOrderParams,
  toCreateSaleOrderLineParams,
  toCreateCreditNoteFromReturnOrderParams,
  toCreateInvoiceFromSaleOrderParams,
  toCreateReturnOrderParams,
} from '@/lib/sales-create-params';
import { saleOrderPrimaryLabel } from '@lumiere/stdb/read-models';
import {
  toCreateDeliveryCarrierParams,
  toCreateDeliveryPriceRuleParams,
  toCreateLoyaltyProgramParams,
  toCreatePaymentMethodParams,
  toCreateShippingMethodParams,
} from '@/lib/sales-logistics-params';
import { salesModuleConfig } from '@/lib/module-dashboard-configs';
import { useSalesModuleSubscription } from '@/lib/module-subscription-hooks';
import { chatterTargetFromRow, type ChatterTarget } from '@/lib/record-chatter';
import { groupBy, groupByMonth } from '@/lib/utils';
import { identityToHex } from '@/lib/helpdesk-display';
import {
  buildOrderIdMapFromSaleOrders,
  SALE_ORDER_IMPORT_BUNDLE,
  type SaleOrderLinkRow,
} from '@lumiere/erp-shared/csv-import-bundles';
import { fetchQueryList } from '@lumiere/query-hooks/http';
import {
  useSaleOrders,
  useSaleOrderLines,
  usePricelists,
  usePickingBatches,
  useCreateSaleOrder,
  useCreatePricelist,
  useCreatePricelistItem,
  useCreatePickingBatch,
  useConfirmSaleOrder,
  useSendSaleOrderQuotation,
  useAcceptSaleOrderQuotation,
  useApplySalePromotion,
  useApplySaleOrderOptions,
  useCancelSaleOrder,
  useComputeSoTotals,
  useUpdatePricelist,
  useDeletePricelist,
  useDeletePricelistItem,
  useStartPickingBatch,
  useCompletePickingBatch,
  useCancelPickingBatch,
  usePricelistItems,
  // Additional sale order operations
  useUpdateSaleOrder,
  useLockSaleOrder,
  useUnlockSaleOrder,
  useCreateSaleOrderLine,
  useUpdateSaleOrderLine,
  useDeleteSaleOrderLine,
  useCreateInvoiceFromSaleOrder,
  useImportSaleOrderCsv,
  useImportSaleOrderLineCsv,
  useDeliveryCarriers,
  useDeliveryPriceRules,
  useShippingMethods,
  usePosPaymentMethods,
  usePosLoyaltyPrograms,
  usePosLoyaltyCards,
  useCreateDeliveryCarrier,
  useCreateDeliveryPriceRule,
  useCreateShippingMethod,
  useCreatePaymentMethod,
  useCreateLoyaltyProgram,
  useCreateLoyaltyCard,
  useReturnOrders,
  useReturnOrderLines,
  useCreateReturnOrder,
  useConfirmReturnOrder,
  useCancelReturnOrder,
  useCreateCreditNoteFromReturnOrder,
  useCreateExchangeOrderFromReturn,
  useSaleCommissions,
  useSaleOrdersToApprove,
  useSaleCommissionsPending,
  useSettleSaleCommissions,
  useCancelSaleCommission,
  useReverseSaleCommissionSettlement,
  useAccrueSaleCommission,
  useCreateSaleCommissionPlan,
  useCreateSaleCommissionPlanSplit,
  useCreateSaleContract,
  useCreateSaleCpqConstraint,
  useCreateSalesIntegrationIntent,
  useRecordSalesIntegrationResult,
  useApplyOmnichannelAllocation,
  useScheduleSalesSlaEscalation,
} from '@lumiere/query-hooks/hooks/sales';
import {
  useAccountMoves,
  useAccountJournals,
  useAccountAccounts,
  useAccountPaymentTerms,
  useComputeInvoiceTotals,
  usePartnerCreditControls,
  usePartnerCreditHolds,
  type AccountMove,
} from '@lumiere/query-hooks/hooks/accounting';
import {
  useStockPickings,
  useStockMoves,
  useConfirmStockPicking,
  useAssignStockPicking,
  useValidateStockPicking,
  useCancelStockPicking,
  useDoneStockMove,
} from '@lumiere/query-hooks/hooks/inventory';
import { useContacts, useUsers } from '@lumiere/query-hooks/hooks/crm';
import { useWarehouses, useProducts, useUoms, useProductCategories } from '@lumiere/query-hooks/hooks/inventory';
import { hasValidOrganizationId, orgBigInts } from '@/lib/org-scoped';
import { useRuntimeListConfig } from '@lumiere/ui/forms';
import {
  customFieldEntriesFromMetadata,
  findNewestRowByField,
  findNewestRowByPartnerId,
  persistCustomFieldsToEav,
} from '@/lib/persist-record-custom-fields';
import { useDefaultOperatingCompanyBigInt } from '@lumiere/query-hooks/hooks/use-operating-company';
import { useModuleTab } from '@/hooks/use-module-tab';
import { useModuleFilters } from '@/hooks/use-module-filters';
import { downloadDocumentPdf } from '@lumiere/query-hooks/hooks/templates';
import { useCreateDocument } from '@lumiere/query-hooks/hooks/documents';
import { archiveRenderedPdfAsDocument } from '@/lib/archive-document-pdf';
import { RecordDocumentAttachments } from '@/components/record-document-attachments';
import {
  SalesOpsPanel,
  parseOpsQueueFilter,
  parseCommissionRatePercent,
  mergeCommissionRateIntoMetadata,
  type SalesOpsQueueId,
} from './sales-ops-panel';
import {
  contactRowsToPartnerSelectOptions,
  pricelistRowsToSelectOptions,
  warehouseRowsToSelectOptions,
  loyaltyProgramRowsToSelectOptions,
  accountJournalRowsToSelectOptions,
  accountAccountRowsToSelectOptions,
  productRowsToSelectOptions,
  uomRowsToSelectOptions,
  saleOrderRowsToSelectOptions,
  paymentTermRowsToSelectOptions,
  productCategoryRowsToSelectOptions,
  currencyOptionsFromRows,
} from '@/lib/form-lookup';
import { enumTag } from '@/lib/accounting-post-draft';

function saleOrderState(row: Record<string, unknown>): string {
  const v = row.state;
  if (v != null && typeof v === 'object' && 'tag' in v)
    return String((v as { tag: string }).tag);
  return String(v ?? '');
}

function recordTimestampMs(row: Record<string, unknown>): number {
  const raw = row.writeDate ?? row.write_date ?? row.createDate ?? row.create_date;
  if (raw == null) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e15 ? n / 1000 : n;
}

function deliveryBatchState(row: Record<string, unknown>): string {
  const v = row.state;
  if (v != null && typeof v === 'object' && 'tag' in v)
    return String((v as { tag: string }).tag);
  return String(v ?? '');
}

function moveTypeTag(row: Record<string, unknown>): string {
  return enumTag(row.moveType ?? row.move_type)
}

function pickingIsReturn(row: Record<string, unknown>): boolean {
  return row.isReturn === true || row.is_return === true;
}

function pickingIsFulfillment(row: Record<string, unknown>): boolean {
  if (pickingIsReturn(row)) return false;
  if (row.saleId != null || row.sale_id != null) return true;
  const code = String(row.pickingCode ?? row.picking_code ?? '').toLowerCase();
  return code === 'outgoing';
}

function pickingStateStr(row: Record<string, unknown>): string {
  return enumTag(getRowField(row, 'state')).toLowerCase();
}

function pickingRowId(row: Record<string, unknown>): string | number | bigint | null {
  const id = getRowField(row, 'id');
  if (id == null) return null;
  if (typeof id === 'string' || typeof id === 'number' || typeof id === 'bigint') return id;
  return String(id);
}

function stockMoveState(row: Record<string, unknown>): string {
  return enumTag(getRowField(row, 'state')).toLowerCase();
}

function stockMovePickingId(row: Record<string, unknown>): string | null {
  const pid = row.pickingId ?? row.picking_id;
  return pid == null ? null : String(pid);
}

interface SalesClientProps {
  initialOrders?: Record<string, unknown>[];
  initialOrderLines?: Record<string, unknown>[];
  initialPricelists?: Record<string, unknown>[];
  initialPricelistItems?: Record<string, unknown>[];
  initialDeliveries?: Record<string, unknown>[];
  initialDeliveryCarriers?: Record<string, unknown>[];
  initialDeliveryPriceRules?: Record<string, unknown>[];
  initialShippingMethods?: Record<string, unknown>[];
  initialPosPaymentMethods?: Record<string, unknown>[];
  initialLoyaltyPrograms?: Record<string, unknown>[];
  initialLoyaltyCards?: Record<string, unknown>[];
  initialContacts?: Record<string, unknown>[];
  initialWarehouses?: Record<string, unknown>[];
  initialAccountMoves?: Record<string, unknown>[];
  initialStockPickings?: Record<string, unknown>[];
  initialReturnOrders?: Record<string, unknown>[];
  initialReturnOrderLines?: Record<string, unknown>[];
  organizationId?: number;
}

type SalesClientLoadedProps = Omit<SalesClientProps, 'organizationId'> & {
  organizationId: number;
};

type SalesCsvImportKind = 'order' | 'orderLine';

export function SalesClient(props: SalesClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />;
  }
  return <SalesClientLoaded {...props} organizationId={props.organizationId} />;
}

function returnOrderState(row: Record<string, unknown>): string {
  return String(row.state ?? '').toLowerCase();
}

function returnOrderRowId(row: Record<string, unknown>): string | null {
  const id = getRowField(row, 'id');
  return id == null ? null : String(id);
}

const SALE_ORDER_STATE_COLORS: Record<string, string> = {
  Draft: '#94a3b8',
  Sent: '#6366f1',
  ToApprove: '#f59e0b',
  Sale: '#22c55e',
  Done: '#8b5cf6',
  Cancel: '#ef4444',
};

function SalesClientLoaded({
  initialOrders,
  initialOrderLines,
  initialPricelists,
  initialPricelistItems,
  initialDeliveries,
  initialDeliveryCarriers,
  initialDeliveryPriceRules,
  initialShippingMethods,
  initialPosPaymentMethods,
  initialLoyaltyPrograms,
  initialLoyaltyCards,
  initialContacts,
  initialWarehouses,
  initialAccountMoves,
  initialStockPickings,
  initialReturnOrders,
  initialReturnOrderLines,
  organizationId,
}: SalesClientLoadedProps) {
  useSalesModuleSubscription();
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useRBAC();
  const runtimeRoleId = currentUser?.roles[0];
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n;

  const saleOrdersTableRuntime = useRuntimeListConfig({
    base: saleOrdersTableConfig(t, {
      formatSaleOrderDisplayName: saleOrderPrimaryLabel,
    }).view as EntityTableConfig,
    moduleId: 'sales',
    formId: 'new-sale-order',
    organizationId,
    roleId: runtimeRoleId,
    listViewKey: `list-filters:sales:orders:${organizationId}`,
  });
  const [quickActionForm, setQuickActionForm] = useState<{
    form: FormConfig;
    action: string;
  } | null>(null);
  const [csvKind, setCsvKind] = useState<SalesCsvImportKind | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [invoiceOrderId, setInvoiceOrderId] = useState<bigint | null>(null);
  const [invoiceOrderError, setInvoiceOrderError] = useState<string | null>(null);
  const [chatterTarget, setChatterTarget] = useState<ChatterTarget | null>(null);
  const [partialDeliveryPicking, setPartialDeliveryPicking] =
    useState<Record<string, unknown> | null>(null);
  const [partialDeliveryError, setPartialDeliveryError] = useState<string | null>(null);
  const [cancelPickingTarget, setCancelPickingTarget] =
    useState<Record<string, unknown> | null>(null);
  const [cancelPickingError, setCancelPickingError] = useState<string | null>(null);
  const [editSaleOrderTarget, setEditSaleOrderTarget] =
    useState<Record<string, unknown> | null>(null);
  const [editSaleOrderError, setEditSaleOrderError] = useState<string | null>(null);
  const [selectedReturnOrderId, setSelectedReturnOrderId] = useState<string | null>(null);
  const [dashboardTimeRange, setDashboardTimeRange] = useState<TimeRangeValue>('30d');
  const [creditReturnOrderId, setCreditReturnOrderId] = useState<bigint | null>(null);
  const [creditReturnOrderError, setCreditReturnOrderError] = useState<string | null>(null);
  const [openReturnForm, setOpenReturnForm] = useState(false);

  const { data: orders = [], isLoading: ordersLoading } = useSaleOrders(orgId, initialOrders);
  const { data: orderLines = [] } = useSaleOrderLines(
    orgId,
    initialOrderLines,
  );
  const { data: pricelists = [] } = usePricelists(orgId, initialPricelists);
  const { data: pricelistItems = [] } = usePricelistItems(
    orgId,
    initialPricelistItems,
  );
  const { data: deliveries = [] } = usePickingBatches(
    orgId,
    initialDeliveries,
  );
  const { data: deliveryCarriers = [] } = useDeliveryCarriers(
    orgId,
    initialDeliveryCarriers,
  );
  const { data: deliveryPriceRules = [] } = useDeliveryPriceRules(
    orgId,
    initialDeliveryPriceRules,
  );
  const { data: shippingMethods = [] } = useShippingMethods(
    orgId,
    initialShippingMethods,
  );
  const { data: posPaymentMethods = [] } = usePosPaymentMethods(
    orgId,
    initialPosPaymentMethods,
  );
  const { data: loyaltyPrograms = [] } = usePosLoyaltyPrograms(
    orgId,
    initialLoyaltyPrograms,
  );
  const { data: loyaltyCards = [] } = usePosLoyaltyCards(orgId, initialLoyaltyCards);
  const { data: contacts = [] } = useContacts(orgId, initialContacts);
  const { data: users = [] } = useUsers(orgId);
  const { data: warehouses = [] } = useWarehouses(orgId, initialWarehouses);
  const { data: products = [] } = useProducts(orgId);
  const { data: productCategories = [] } = useProductCategories(orgId);
  const { data: uoms = [] } = useUoms(orgId);
  const { data: accountMoves = [] } = useAccountMoves(orgId, { initialData: initialAccountMoves });
  const { data: accountJournals = [] } = useAccountJournals(orgId);
  const { data: accountAccounts = [] } = useAccountAccounts(orgId);
  const { data: paymentTerms = [] } = useAccountPaymentTerms(orgId);
  const { data: partnerCreditControls = [] } = usePartnerCreditControls(orgId);
  const { data: partnerCreditHolds = [] } = usePartnerCreditHolds(orgId);
  const { data: stockPickings = [] } = useStockPickings(orgId, initialStockPickings);
  const { data: stockMoves = [] } = useStockMoves(orgId);
  const { data: returnOrders = [] } = useReturnOrders(orgId, initialReturnOrders);
  const { data: returnOrderLines = [] } = useReturnOrderLines(orgId, initialReturnOrderLines);
  const { data: saleCommissions = [] } = useSaleCommissions(orgId);
  const { data: saleOrdersToApprove = [] } = useSaleOrdersToApprove(orgId);
  const { data: saleCommissionsPending = [] } = useSaleCommissionsPending(orgId);
  const settleSaleCommissions = useSettleSaleCommissions(orgId, operatingCompanyId);
  const cancelSaleCommission = useCancelSaleCommission(orgId, operatingCompanyId);
  const reverseSaleCommissionSettlement = useReverseSaleCommissionSettlement(
    orgId,
    operatingCompanyId,
  );
  const accrueSaleCommission = useAccrueSaleCommission(orgId);
  const createSaleCommissionPlan = useCreateSaleCommissionPlan(
    orgId,
    operatingCompanyId,
  );
  const createSaleCommissionPlanSplit = useCreateSaleCommissionPlanSplit(
    orgId,
    operatingCompanyId,
  );
  const createDocument = useCreateDocument(orgId, operatingCompanyId);
  const createSaleContract = useCreateSaleContract(orgId, operatingCompanyId);
  const createSaleCpqConstraint = useCreateSaleCpqConstraint(
    orgId,
    operatingCompanyId,
  );
  const createSalesIntegrationIntent = useCreateSalesIntegrationIntent(
    orgId,
    operatingCompanyId,
  );
  const recordSalesIntegrationResult = useRecordSalesIntegrationResult(
    orgId,
    operatingCompanyId,
  );
  const applyOmnichannelAllocation = useApplyOmnichannelAllocation(
    orgId,
    operatingCompanyId,
  );
  const scheduleSalesSlaEscalation = useScheduleSalesSlaEscalation(
    orgId,
    operatingCompanyId,
  );

  const promptCreateCommissionPlan = async () => {
    const name =
      window
        .prompt(
          t('sales.ops.prompt.commissionPlanName', {
            defaultValue: 'Commission plan name',
          }),
        )
        ?.trim() ?? '';
    if (!name) return;
    const rateRaw =
      window.prompt(
        t('sales.ops.prompt.commissionPlanRate', {
          defaultValue: 'Default rate percent (e.g. 5)',
        }),
        '5',
      ) ?? '';
    const defaultRatePercent = Number(rateRaw);
    if (!Number.isFinite(defaultRatePercent)) {
      throw new Error('Invalid rate percent');
    }
    await createSaleCommissionPlan.mutateAsync({
      companyId: operatingCompanyId,
      name,
      isActive: true,
      defaultRatePercent,
      metadata: null,
    });
  };

  const promptCreateCommissionPlanSplit = async () => {
    const planId =
      window
        .prompt(
          t('sales.ops.prompt.planId', { defaultValue: 'Commission plan id' }),
        )
        ?.trim() ?? '';
    const partnerId =
      window
        .prompt(
          t('sales.ops.prompt.partnerId', { defaultValue: 'Partner id' }),
        )
        ?.trim() ?? '';
    const shareRaw =
      window.prompt(
        t('sales.ops.prompt.sharePercent', {
          defaultValue: 'Share percent (0–100)',
        }),
        '50',
      ) ?? '';
    if (!planId || !partnerId) return;
    const sharePercent = Number(shareRaw);
    if (!Number.isFinite(sharePercent)) {
      throw new Error('Invalid share percent');
    }
    await createSaleCommissionPlanSplit.mutateAsync({
      planId: BigInt(planId),
      partnerId: BigInt(partnerId),
      sharePercent,
      metadata: null,
    });
  };

  const promptCreateSaleContract = async () => {
    const name =
      window
        .prompt(
          t('sales.ops.prompt.contractName', {
            defaultValue: 'Contract name',
          }),
        )
        ?.trim() ?? '';
    const partnerId =
      window
        .prompt(
          t('sales.ops.prompt.partnerId', { defaultValue: 'Partner id' }),
        )
        ?.trim() ?? '';
    if (!name || !partnerId) return;
    await createSaleContract.mutateAsync({
      companyId: operatingCompanyId,
      name,
      partnerId: BigInt(partnerId),
      dateStart: null,
      dateEnd: null,
      pricelistId: null,
      metadata: null,
    });
  };

  const promptCreateCpqConstraint = async () => {
    const name =
      window
        .prompt(
          t('sales.ops.prompt.cpqName', {
            defaultValue: 'CPQ constraint name',
          }),
        )
        ?.trim() ?? '';
    const ruleJson =
      window
        .prompt(
          t('sales.ops.prompt.cpqRuleJson', {
            defaultValue: 'Rule JSON (e.g. {})',
          }),
          '{}',
        )
        ?.trim() ?? '';
    if (!name || !ruleJson) return;
    await createSaleCpqConstraint.mutateAsync({
      companyId: operatingCompanyId,
      name,
      ruleJson,
      isActive: true,
      metadata: null,
    });
  };

  const promptCreateIntegrationIntent = async () => {
    const provider =
      window
        .prompt(
          t('sales.ops.prompt.intentProvider', {
            defaultValue: 'Provider (e.g. fiscal, carrier)',
          }),
          'fiscal',
        )
        ?.trim() ?? '';
    const intentType =
      window
        .prompt(
          t('sales.ops.prompt.intentType', {
            defaultValue: 'Intent type (e.g. submit, book)',
          }),
          'submit',
        )
        ?.trim() ?? '';
    const orderRaw =
      window
        .prompt(
          t('sales.ops.prompt.intentOrderId', {
            defaultValue: 'Sale order id (optional)',
          }),
        )
        ?.trim() ?? '';
    const idempotencyKey =
      window
        .prompt(
          t('sales.ops.prompt.idempotencyKey', {
            defaultValue: 'Idempotency key',
          }),
          `intent-${Date.now()}`,
        )
        ?.trim() ?? '';
    if (!provider || !intentType || !idempotencyKey) return;
    await createSalesIntegrationIntent.mutateAsync({
      companyId: operatingCompanyId,
      provider,
      intentType,
      saleOrderId: orderRaw ? BigInt(orderRaw) : null,
      idempotencyKey,
      requestPayload: null,
      metadata: null,
    });
  };

  const promptRecordIntegrationResult = async () => {
    const intentId =
      window
        .prompt(
          t('sales.ops.prompt.intentId', {
            defaultValue: 'Integration intent id',
          }),
        )
        ?.trim() ?? '';
    const status =
      window
        .prompt(
          t('sales.ops.prompt.intentStatus', {
            defaultValue: 'Status (e.g. succeeded, failed)',
          }),
          'succeeded',
        )
        ?.trim() ?? '';
    if (!intentId || !status) return;
    const externalReference =
      window
        .prompt(
          t('sales.ops.prompt.externalRef', {
            defaultValue: 'External reference (optional)',
          }),
        )
        ?.trim() || null;
    await recordSalesIntegrationResult.mutateAsync({
      intentId,
      params: {
        status,
        externalReference,
        lastError: status === 'failed' ? 'recorded via Ops' : null,
        metadata: null,
      },
    });
  };

  const promptScheduleSlaEscalation = async () => {
    const delayRaw =
      window.prompt(
        t('sales.ops.prompt.slaDelaySecs', {
          defaultValue: 'Delay seconds (min 60)',
        }),
        '300',
      ) ?? '';
    const delaySecs = Number(delayRaw);
    if (!Number.isFinite(delaySecs) || delaySecs <= 0) {
      throw new Error('Invalid delay');
    }
    await scheduleSalesSlaEscalation.mutateAsync({ delaySecs });
  };

  const createSaleOrder = useCreateSaleOrder(orgId, operatingCompanyId);
  const createPricelist = useCreatePricelist(orgId);
  const createPricelistItem = useCreatePricelistItem(orgId);
  const createPickingBatch = useCreatePickingBatch(orgId, operatingCompanyId);
  const confirmSaleOrder = useConfirmSaleOrder(orgId);
  const sendSaleOrderQuotation = useSendSaleOrderQuotation(orgId);
  const acceptSaleOrderQuotation = useAcceptSaleOrderQuotation(orgId);
  const applySalePromotion = useApplySalePromotion(orgId);
  const applySaleOrderOptions = useApplySaleOrderOptions(orgId);
  const cancelSaleOrder = useCancelSaleOrder(orgId);
  const computeSoTotals = useComputeSoTotals(orgId);
  const updatePricelist = useUpdatePricelist(orgId);
  const deletePricelist = useDeletePricelist(orgId);
  const deletePricelistItem = useDeletePricelistItem(orgId);
  const startPickingBatch = useStartPickingBatch(orgId);
  const completePickingBatch = useCompletePickingBatch(orgId);
  const cancelPickingBatch = useCancelPickingBatch(orgId);

  // Additional sale order operations
  const updateSaleOrder = useUpdateSaleOrder(orgId, operatingCompanyId);
  const lockSaleOrder = useLockSaleOrder(orgId);
  const unlockSaleOrder = useUnlockSaleOrder(orgId);
  const createSaleOrderLine = useCreateSaleOrderLine(orgId);
  const updateSaleOrderLine = useUpdateSaleOrderLine(orgId);
  const deleteSaleOrderLine = useDeleteSaleOrderLine(orgId);
  const createInvoiceFromSaleOrder = useCreateInvoiceFromSaleOrder(orgId);
  const importSaleOrderCsv = useImportSaleOrderCsv(orgId, operatingCompanyId);
  const importSaleOrderLineCsv = useImportSaleOrderLineCsv(orgId, operatingCompanyId);

  const createDeliveryCarrier = useCreateDeliveryCarrier(orgId, operatingCompanyId);
  const createDeliveryPriceRule = useCreateDeliveryPriceRule(orgId, operatingCompanyId);
  const createShippingMethod = useCreateShippingMethod(orgId, operatingCompanyId);
  const createPaymentMethod = useCreatePaymentMethod(orgId, operatingCompanyId);
  const createLoyaltyProgram = useCreateLoyaltyProgram(orgId, operatingCompanyId);
  const createLoyaltyCard = useCreateLoyaltyCard(orgId, operatingCompanyId);
  const createReturnOrder = useCreateReturnOrder(orgId, operatingCompanyId);
  const confirmReturnOrder = useConfirmReturnOrder(orgId, operatingCompanyId);
  const cancelReturnOrder = useCancelReturnOrder(orgId, operatingCompanyId);
  const createCreditNoteFromReturnOrder = useCreateCreditNoteFromReturnOrder(
    orgId,
    operatingCompanyId,
  );
  const createExchangeOrderFromReturn = useCreateExchangeOrderFromReturn(
    orgId,
    operatingCompanyId,
  );
  const computeInvoiceTotals = useComputeInvoiceTotals(organizationId, operatingCompanyId);
  const confirmPicking = useConfirmStockPicking(orgId, operatingCompanyId);
  const assignPicking = useAssignStockPicking(orgId, operatingCompanyId);
  const validatePicking = useValidateStockPicking(orgId, operatingCompanyId);
  const cancelPicking = useCancelStockPicking(orgId, operatingCompanyId);
  const doneStockMove = useDoneStockMove(orgId, operatingCompanyId);

  useEffect(() => {
    if (csvKind) setCsvError(null);
  }, [csvKind]);

  const csvFormConfig = useMemo(() => {
    if (!csvKind) return null;
    const titleKey: Record<SalesCsvImportKind, string> = {
      order: 'sales.csvImport.ordersTitle',
      orderLine: 'sales.csvImport.orderLinesTitle',
    };
    return csvImportForm(t, t(titleKey[csvKind]));
  }, [csvKind, t]);

  const moduleConfig = useMemo(() => salesModuleConfig(t), [t]);

  const salesTabIds = useMemo(() => moduleConfig.tabs.map((tab) => tab.id), [moduleConfig]);
  const { activeTab, setActiveTab } = useModuleTab(
    moduleConfig.defaultTab ?? 'dashboard',
    salesTabIds,
  );
  const urlFilters = useModuleFilters();

  const navigateToOrdersByState = useCallback(
    (state: string) => {
      router.push(buildModuleTabHref('sales', 'orders', { state }));
    },
    [router],
  );

  const navigateToSalesTab = useCallback(
    (tab: string, filters?: Record<string, string>) => {
      router.push(buildModuleTabHref('sales', tab, filters));
    },
    [router],
  );

  const partnerFieldOptions = useMemo(() => {
    const fromApi = contactRowsToPartnerSelectOptions(contacts);
    if (fromApi.length > 0) return fromApi;
    return [
      { value: '', label: t('common.lookup.noPartners'), disabled: true },
    ];
  }, [contacts, t]);

  const pricelistFieldOptions = useMemo(() => {
    const fromApi = pricelistRowsToSelectOptions(pricelists);
    if (fromApi.length > 0) return fromApi;
    return [
      { value: '', label: t('common.lookup.noPricelists'), disabled: true },
    ];
  }, [pricelists, t]);

  const warehouseFieldOptions = useMemo(() => {
    const fromApi = warehouseRowsToSelectOptions(warehouses);
    if (fromApi.length > 0) return fromApi;
    return [
      { value: '', label: t('common.lookup.noWarehouses'), disabled: true },
    ];
  }, [warehouses, t]);

  const paymentTermFieldOptions = useMemo(() => {
    const fromApi = paymentTermRowsToSelectOptions(paymentTerms as Record<string, unknown>[]);
    if (fromApi.length > 0) return fromApi;
    return [{ value: '', label: '—' }];
  }, [paymentTerms]);

  const productFieldOptions = useMemo(() => {
    const fromApi = productRowsToSelectOptions(products);
    if (fromApi.length > 0) return fromApi;
    return [{ value: '', label: t('common.lookup.noProducts'), disabled: true }];
  }, [products, t]);

  const uomFieldOptions = useMemo(() => {
    const fromApi = uomRowsToSelectOptions(uoms);
    if (fromApi.length > 0) return fromApi;
    return [{ value: '', label: t('common.lookup.noUoms'), disabled: true }];
  }, [uoms, t]);

  const currencyFieldOptions = useMemo(() => {
    const fromApi = currencyOptionsFromRows([
      pricelists as Record<string, unknown>[],
      accountJournals as Record<string, unknown>[],
      accountAccounts as Record<string, unknown>[],
    ]);
    if (fromApi.length > 0) return fromApi;
    return [{ value: '1', label: 'Currency 1' }];
  }, [pricelists, accountJournals, accountAccounts]);

  const productCategoryFieldOptions = useMemo(() => {
    const fromApi = productCategoryRowsToSelectOptions(productCategories as Record<string, unknown>[]);
    if (fromApi.length > 0) return fromApi;
    return [{ value: '', label: t('common.lookup.noCategories'), disabled: true }];
  }, [productCategories, t]);

  const journalFieldOptions = useMemo(() => {
    const fromApi = accountJournalRowsToSelectOptions(accountJournals as Record<string, unknown>[]);
    if (fromApi.length > 0) return fromApi;
    return [{ value: '', label: t('common.lookup.noJournals'), disabled: true }];
  }, [accountJournals, t]);

  const glAccountFieldOptions = useMemo(() => {
    const fromApi = accountAccountRowsToSelectOptions(accountAccounts as Record<string, unknown>[]);
    if (fromApi.length > 0) return fromApi;
    return [{ value: '', label: t('common.lookup.noAccounts'), disabled: true }];
  }, [accountAccounts, t]);

  const pricelistFormConfig = useMemo(
    () =>
      mergeFieldDefaultValues(
        mergeSelectOptionsForFields(newPricelistForm(t), {
          currencyId: currencyFieldOptions,
        }),
        { currencyId: currencyFieldOptions[0]?.value ?? '1' },
      ),
    [t, currencyFieldOptions],
  );

  const deliveryCarrierFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newDeliveryCarrierForm(t), {
        productId: productFieldOptions,
        currencyId: currencyFieldOptions,
      }),
    [t, productFieldOptions, currencyFieldOptions],
  );

  const shippingMethodFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newShippingMethodForm(t), {
        productId: productFieldOptions,
      }),
    [t, productFieldOptions],
  );

  const posPaymentMethodFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newPosPaymentMethodForm(t), {
        receivableAccountId: glAccountFieldOptions,
        outstandingAccountId: glAccountFieldOptions,
        journalId: journalFieldOptions,
        cashJournalId: journalFieldOptions,
      }),
    [t, glAccountFieldOptions, journalFieldOptions],
  );

  const loyaltyProgramFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newLoyaltyProgramForm(t), {
        currencyId: currencyFieldOptions,
      }),
    [t, currencyFieldOptions],
  );

  const draftSaleOrderOptions = useMemo(() => {
    const draft = (orders as Record<string, unknown>[]).filter(
      (o) => saleOrderState(o) === 'Draft',
    );
    const fromApi = saleOrderRowsToSelectOptions(draft);
    if (fromApi.length > 0) return fromApi;
    return [
      {
        value: '',
        label: t('sales.forms.addSaleOrderLine.fields.orderPlaceholder'),
        disabled: true,
      },
    ];
  }, [orders, t]);

  const returnSourceSaleOrderOptions = useMemo(() => {
    const eligible = (orders as Record<string, unknown>[]).filter((o) => {
      const st = saleOrderState(o);
      return st === 'Sale' || st === 'Done';
    });
    const fromApi = saleOrderRowsToSelectOptions(eligible);
    if (fromApi.length > 0) return fromApi;
    return [
      {
        value: '',
        label: t('sales.forms.newReturnOrder.fields.saleOrderId'),
        disabled: true,
      },
    ];
  }, [orders, t]);

  const returnOrderFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newReturnOrderForm(t), {
        partnerId: partnerFieldOptions,
        saleOrderId: returnSourceSaleOrderOptions,
        productId: productFieldOptions,
        uomId: uomFieldOptions,
      }),
    [t, partnerFieldOptions, returnSourceSaleOrderOptions, productFieldOptions, uomFieldOptions],
  );

  const addSaleOrderLineFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(addSaleOrderLineForm(t), {
        orderId: draftSaleOrderOptions,
        productId: productFieldOptions,
        uomId: uomFieldOptions,
      }),
    [t, draftSaleOrderOptions, productFieldOptions, uomFieldOptions],
  );

  const pricelistItemFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newPricelistItemForm(t), {
        pricelistId: pricelistFieldOptions,
        productId: productFieldOptions,
        categId: productCategoryFieldOptions,
      }),
    [t, pricelistFieldOptions, productFieldOptions, productCategoryFieldOptions],
  );

  const salesRepLabelByIdentity = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of users) {
      const row = user as Record<string, unknown>;
      const key = identityToHex(row.identity ?? row.id);
      if (!key) continue;
      map.set(key, String(row.name ?? row.email ?? 'Unassigned'));
    }
    return map;
  }, [users]);

  const saleOrderFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newSaleOrderForm(t), {
        partnerId: partnerFieldOptions,
        pricelistId: pricelistFieldOptions,
        warehouseId: warehouseFieldOptions,
        paymentTermId: paymentTermFieldOptions,
      }),
    [t, partnerFieldOptions, pricelistFieldOptions, warehouseFieldOptions, paymentTermFieldOptions],
  );

  const openCreateSaleOrder = useCallback(
    () => setQuickActionForm({ form: saleOrderFormConfig, action: 'createSaleOrder' }),
    [saleOrderFormConfig],
  );

  const partnerLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const contact of contacts) {
      const row = contact as Record<string, unknown>;
      map.set(String(row.id), String(row.name ?? row.displayName ?? row.id));
    }
    return map;
  }, [contacts]);

  const saleOrderRecordSheet = useMemo((): EntityRecordSheetConfig => {
    const status = saleOrderStatusBadges(t);
    const linesConfig = saleOrderLinesTableConfig(t);
    const baseDetail = saleOrderDetailConfig(t);
    const detailConfig = {
      ...baseDetail,
      sections: baseDetail.sections.map((section) =>
        section.id === 'customer'
          ? {
              ...section,
              fields: section.fields.map((field) =>
                field.key === 'partnerName'
                  ? {
                      ...field,
                      render: (_value: unknown, record: Record<string, unknown>) => {
                        const direct = String(
                          record.partnerName ?? record.partner_name ?? '',
                        ).trim();
                        if (direct) return direct;
                        const partnerId = record.partnerId ?? record.partner_id;
                        if (partnerId == null) return '—';
                        return (
                          partnerLabelById.get(String(partnerId)) ?? `Partner ${String(partnerId)}`
                        );
                      },
                    }
                  : field,
              ),
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
      auditTableName: 'sale_order',
      customTabs: [
        {
          id: 'lines',
          label: t('sales.orderLines.title'),
          content: (record) => {
            const orderId = String(record.id ?? '');
            const lines = (orderLines as Record<string, unknown>[]).filter(
              (line) => String(line.orderId ?? line.order_id) === orderId,
            );
            return (
              <EntityView
                config={{
                  ...linesConfig,
                  title: '',
                  description: undefined,
                }}
                data={lines}
                useCard={false}
              />
            );
          },
        },
      ],
    };
  }, [t, orderLines, partnerLabelById]);

  const pickingBatchFormConfig = useMemo(() => newPickingBatchForm(t), [t]);

  const loyaltyProgramFieldOptions = useMemo(() => {
    const fromApi = loyaltyProgramRowsToSelectOptions(loyaltyPrograms);
    if (fromApi.length > 0) return fromApi;
    return [
      {
        value: '',
        label: t('sales.forms.newLoyaltyCard.noPrograms'),
        disabled: true,
      },
    ];
  }, [loyaltyPrograms, t]);

  const loyaltyCardFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newLoyaltyCardForm(t), {
        programId: loyaltyProgramFieldOptions,
        partnerId: partnerFieldOptions,
      }),
    [t, loyaltyProgramFieldOptions, partnerFieldOptions],
  );

  const salesInvoices = useMemo(
    () =>
      (accountMoves as Record<string, unknown>[]).filter(
        (m) => moveTypeTag(m) === 'OutInvoice',
      ),
    [accountMoves],
  );

  const fulfillmentPickings = useMemo(
    () =>
      (stockPickings as Record<string, unknown>[]).filter((p) =>
        pickingIsFulfillment(p),
      ),
    [stockPickings],
  );

  const linesForSelectedReturn = useMemo(() => {
    if (selectedReturnOrderId == null) return [];
    return (returnOrderLines as Record<string, unknown>[]).filter(
      (line) =>
        String(line.returnOrderId ?? line.return_order_id) === selectedReturnOrderId,
    );
  }, [returnOrderLines, selectedReturnOrderId]);

  const returnOrderLinesEntityConfig = useMemo(
    () => returnOrderLinesTableConfig(t),
    [t],
  );

  const incomeAccountFieldOptions = useMemo(() => {
    const fromApi = accountAccountRowsToSelectOptions(
      accountAccounts as Record<string, unknown>[],
    );
    if (fromApi.length > 0) return fromApi;
    return [
      { value: '', label: t('sales.forms.createInvoiceFromOrder.noAccounts'), disabled: true },
    ];
  }, [accountAccounts, t]);

  const receivableAccountFieldOptions = useMemo(() => {
    const receivableRows = (accountAccounts as Record<string, unknown>[]).filter(
      (row) => {
        const v = row.internalType ?? row.internal_type;
        const tag =
          v != null && typeof v === 'object' && 'tag' in v
            ? String((v as { tag: string }).tag).toLowerCase()
            : String(v ?? '').toLowerCase();
        return tag === 'receivable';
      },
    );
    const fromApi = accountAccountRowsToSelectOptions(receivableRows);
    if (fromApi.length > 0) return fromApi;
    return [
      {
        value: '',
        label: t('sales.forms.createInvoiceFromOrder.noReceivableAccounts'),
        disabled: true,
      },
    ];
  }, [accountAccounts, t]);

  const createInvoiceFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(createInvoiceFromSaleOrderForm(t), {
        journalId: journalFieldOptions,
        defaultIncomeAccountId: incomeAccountFieldOptions,
        receivableAccountId: receivableAccountFieldOptions,
      }),
    [t, journalFieldOptions, incomeAccountFieldOptions, receivableAccountFieldOptions],
  );

  const productLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of products as Record<string, unknown>[]) {
      map.set(String(row.id), String(row.name ?? row.displayName ?? `Product ${row.id}`));
    }
    return map;
  }, [products]);

  const assignedMovesForPartialDelivery = useMemo(() => {
    if (!partialDeliveryPicking) return [];
    const pickingId = pickingRowId(partialDeliveryPicking);
    if (pickingId == null) return [];
    return (stockMoves as Record<string, unknown>[]).filter(
      (m) =>
        stockMovePickingId(m) === String(pickingId) && stockMoveState(m) === 'assigned',
    );
  }, [partialDeliveryPicking, stockMoves]);

  const partialDeliveryFormConfig = useMemo(() => {
    if (!partialDeliveryPicking) return null;
    const pickingName = String(
      partialDeliveryPicking.name ?? partialDeliveryPicking.origin ?? pickingRowId(partialDeliveryPicking),
    );
    const lines = assignedMovesForPartialDelivery.map((m) => {
      const moveId = String(m.id);
      const productId = String(m.productId ?? m.product_id ?? '');
      return {
        moveId,
        productLabel: productLabelById.get(productId) ?? `Product ${productId}`,
        orderedQty: Number(m.productUomQty ?? m.product_uom_qty ?? 0),
      };
    });
    return buildPartialDeliveryForm(t, pickingName, lines);
  }, [partialDeliveryPicking, assignedMovesForPartialDelivery, productLabelById, t]);

  const cancelPickingFormConfig = useMemo(() => {
    if (!cancelPickingTarget) return null;
    const base = cancelPickingConfirmForm(t);
    return mergeFieldDefaultValues(base, {
      pickingReference: String(
        cancelPickingTarget.name ??
          cancelPickingTarget.origin ??
          pickingRowId(cancelPickingTarget),
      ),
    });
  }, [cancelPickingTarget, t]);

  const pickingActions = useMemo(
    (): EntityTableConfig['actions'] => [
      {
        id: 'confirm-picking',
        label: t('inventory.transferActions.confirm'),
        requiresSelection: true,
        onClick: (rows) => {
          const row = rows[0] as Record<string, unknown> | undefined;
          if (!row) return;
          const id = pickingRowId(row);
          if (id != null) void confirmPicking.mutateAsync(id);
        },
      },
      {
        id: 'assign-picking',
        label: t('inventory.transferActions.assign'),
        requiresSelection: true,
        onClick: (rows) => {
          const row = rows[0] as Record<string, unknown> | undefined;
          if (!row) return;
          const id = pickingRowId(row);
          if (id != null) void assignPicking.mutateAsync(id);
        },
      },
      {
        id: 'partial-validate-picking',
        label: t('sales.fulfillment.actions.partialValidate'),
        requiresSelection: true,
        onClick: (rows) => {
          const row = rows[0] as Record<string, unknown> | undefined;
          if (!row) return;
          if (pickingStateStr(row) !== 'assigned') return;
          setPartialDeliveryError(null);
          setPartialDeliveryPicking(row);
        },
      },
      {
        id: 'validate-picking',
        label: t('inventory.transferActions.validate'),
        requiresSelection: true,
        onClick: (rows) => {
          const row = rows[0] as Record<string, unknown> | undefined;
          if (!row) return;
          const id = pickingRowId(row);
          if (id != null) void validatePicking.mutateAsync(id);
        },
      },
      {
        id: 'cancel-picking',
        label: t('inventory.transferActions.cancel'),
        requiresSelection: true,
        variant: 'destructive',
        onClick: (rows) => {
          const row = rows[0] as Record<string, unknown> | undefined;
          if (!row) return;
          const st = pickingStateStr(row);
          if (st === 'done') return;
          setCancelPickingError(null);
          setCancelPickingTarget(row);
        },
      },
    ],
    [t, confirmPicking, assignPicking, validatePicking],
  );

  const fulfillmentEntityConfig = useMemo((): EntityViewConfig => {
    const base = salesFulfillmentTableConfig(t);
    const view = base.view as EntityTableConfig;
    return {
      ...base,
      view: {
        ...view,
        actions: pickingActions,
      },
    };
  }, [t, pickingActions]);

  const returnsEntityConfig = useMemo((): EntityViewConfig => {
    const base = salesReturnsTableConfig(t);
    const view = base.view as EntityTableConfig;
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: 'confirm-return',
            label: t('sales.returnOrders.actions.confirm'),
            requiresSelection: true,
            onClick: (rows) => {
              for (const row of rows) {
                if (returnOrderState(row) !== 'draft') continue;
                const id = returnOrderRowId(row);
                if (id != null) void confirmReturnOrder.mutateAsync(id);
              }
            },
          },
          {
            id: 'receive-return',
            label: t('sales.returnOrders.actions.receive'),
            requiresSelection: true,
            onClick: (rows) => {
              void (async () => {
                for (const row of rows) {
                  if (returnOrderState(row) !== 'confirmed') continue;
                  const pickingId = row.pickingId ?? row.picking_id;
                  if (pickingId == null) continue;
                  await confirmPicking.mutateAsync(pickingId as string | number | bigint);
                  await assignPicking.mutateAsync(pickingId as string | number | bigint);
                  await validatePicking.mutateAsync(pickingId as string | number | bigint);
                }
              })();
            },
          },
          {
            id: 'create-return-credit-note',
            label: t('sales.returnOrders.actions.createCreditNote'),
            requiresSelection: true,
            onClick: (rows) => {
              if (rows.length !== 1) return;
              const row = rows[0] as Record<string, unknown>;
              if (returnOrderState(row) !== 'received') return;
              if (row.creditMoveId != null || row.credit_move_id != null) return;
              const id = returnOrderRowId(row);
              if (id == null) return;
              setCreditReturnOrderError(null);
              setCreditReturnOrderId(BigInt(id));
            },
          },
          {
            id: 'create-exchange-order',
            label: t('sales.returnOrders.actions.createExchange', {
              defaultValue: 'Create exchange order',
            }),
            requiresSelection: true,
            onClick: (rows) => {
              for (const row of rows) {
                const st = returnOrderState(row);
                if (st !== 'confirmed' && st !== 'received') continue;
                const id = returnOrderRowId(row);
                if (id != null) void createExchangeOrderFromReturn.mutateAsync(id);
              }
            },
          },
          {
            id: 'cancel-return',
            label: t('sales.returnOrders.actions.cancel'),
            requiresSelection: true,
            variant: 'destructive',
            onClick: (rows) => {
              for (const row of rows) {
                const st = returnOrderState(row);
                if (st === 'received' || st === 'refunded' || st === 'cancelled') continue;
                const id = returnOrderRowId(row);
                if (id != null) void cancelReturnOrder.mutateAsync(id);
              }
            },
          },
        ],
      },
    };
  }, [
    t,
    confirmReturnOrder,
    cancelReturnOrder,
    confirmPicking,
    assignPicking,
    validatePicking,
    createExchangeOrderFromReturn,
  ]);

  const ordersEntityConfig = useMemo((): EntityViewConfig => {
    const base = saleOrdersTableConfig(t, {
      formatSaleOrderDisplayName: saleOrderPrimaryLabel,
      onEmptyAction: openCreateSaleOrder,
    });
    const runtimeView = saleOrdersTableRuntime;
    return {
      ...base,
      view: {
        ...runtimeView,
        emptyState: {
          ...runtimeView.emptyState,
          onAction: openCreateSaleOrder,
        },
        actions: [
          {
            id: 'csv-sale-orders',
            label: t('sales.csvImport.toolbarOrders'),
            onClick: () => setCsvKind('order'),
          },
          {
            id: 'confirm-orders',
            label: t('sales.actions.confirmSelected'),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                const st = saleOrderState(r);
                if (st === 'Draft' || st === 'Sent') {
                  void confirmSaleOrder
                    .mutateAsync(r.id as string | number | bigint)
                    .then(() => {
                      phCapture('sale_order_confirmed', { organization_id: organizationId });
                    })
                    .catch((e: unknown) => {
                      window.alert(e instanceof Error ? e.message : String(e));
                    });
                }
              }
            },
          },
          {
            id: 'send-quotation',
            label: t('sales.actions.sendQuotation'),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                if (saleOrderState(r) === 'Draft') {
                  void sendSaleOrderQuotation
                    .mutateAsync(r.id as string | number | bigint)
                    .catch((e: unknown) => {
                      window.alert(e instanceof Error ? e.message : String(e));
                    });
                }
              }
            },
          },
          {
            id: 'accept-quotation',
            label: t('sales.actions.acceptQuotation', { defaultValue: 'Accept quotation' }),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                if (saleOrderState(r) !== 'Sent') continue;
                const signedBy =
                  window.prompt(
                    t('sales.actions.acceptQuotationPrompt', {
                      defaultValue: 'Accepted by (name)',
                    }),
                  )?.trim() ?? '';
                if (!signedBy) continue;
                void acceptSaleOrderQuotation
                  .mutateAsync({
                    orderId: r.id as string | number | bigint,
                    signedBy,
                  })
                  .catch((e: unknown) => {
                    window.alert(e instanceof Error ? e.message : String(e));
                  });
              }
            },
          },
          {
            id: 'apply-promotion',
            label: t('sales.actions.applyPromotion', { defaultValue: 'Apply promotion' }),
            requiresSelection: true,
            onClick: (rows) => {
              if (rows.length !== 1) return;
              const r = rows[0];
              const st = saleOrderState(r);
              if (st !== 'Draft' && st !== 'Sent') return;
              const code =
                window.prompt(
                  t('sales.actions.applyPromotionPrompt', {
                    defaultValue: 'Promotion code',
                  }),
                )?.trim() ?? '';
              if (!code) return;
              void applySalePromotion
                .mutateAsync({
                  orderId: r.id as string | number | bigint,
                  promotionCode: code,
                })
                .catch((e: unknown) => {
                  window.alert(e instanceof Error ? e.message : String(e));
                });
            },
          },
          {
            id: 'apply-options',
            label: t('sales.actions.applyOptions', { defaultValue: 'Apply CPQ options' }),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                const st = saleOrderState(r);
                if (st !== 'Draft' && st !== 'Sent') continue;
                void applySaleOrderOptions
                  .mutateAsync(r.id as string | number | bigint)
                  .catch((e: unknown) => {
                    window.alert(e instanceof Error ? e.message : String(e));
                  });
              }
            },
          },
          {
            id: 'export-commercial-packet',
            label: t('sales.actions.exportCommercialPacket', {
              defaultValue: 'Export commercial packet',
            }),
            requiresSelection: true,
            onClick: (rows) => {
              if (rows.length !== 1) return;
              const order = rows[0] as Record<string, unknown>;
              const orderId = String(order.id ?? '');
              const lines = (orderLines as Record<string, unknown>[]).filter(
                (l) => String(l.orderId ?? l.order_id ?? '') === orderId,
              );
              const packet = {
                documentType: 'commercial_invoice_packet',
                generatedAt: new Date().toISOString(),
                order,
                lines,
                note: 'Fiscal submit remains a worker/procedure; this packet is export data only.',
              };
              const blob = new Blob([JSON.stringify(packet, null, 2)], {
                type: 'application/json',
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `commercial-packet-SO-${orderId}.json`;
              a.click();
              URL.revokeObjectURL(url);
            },
          },
          {
            id: 'edit-order',
            label: t('sales.actions.editOrder'),
            requiresSelection: true,
            onClick: (rows) => {
              if (rows.length !== 1) return;
              const r = rows[0] as Record<string, unknown>;
              const st = saleOrderState(r);
              if (st !== 'Draft' && st !== 'Sent') return;
              setEditSaleOrderError(null);
              setEditSaleOrderTarget(r);
            },
          },
          {
            id: 'cancel-orders',
            label: t('sales.actions.cancelOrders'),
            requiresSelection: true,
            variant: 'destructive',
            onClick: (rows) => {
              for (const r of rows) {
                const st = saleOrderState(r);
                if (st !== 'Done' && st !== 'Cancelled' && st !== 'Cancel') {
                  void cancelSaleOrder
                    .mutateAsync({
                      orderId: r.id as string | number | bigint,
                    })
                    .then(() => {
                      phCapture('sale_order_cancelled', { organization_id: organizationId });
                    })
                    .catch((e: unknown) => {
                      window.alert(e instanceof Error ? e.message : String(e));
                    });
                }
              }
            },
          },
          {
            id: 'recompute-totals',
            label: t('sales.actions.recalculateTotals'),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                const st = saleOrderState(r);
                if (st !== 'Cancelled' && st !== 'Cancel') {
                  computeSoTotals.mutate(r.id as string | number | bigint);
                }
              }
            },
          },
          {
            id: 'accrue-commission',
            label: t('sales.actions.accrueCommission', {
              defaultValue: 'Accrue commission',
            }),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                const row = r as Record<string, unknown>;
                const st = saleOrderState(row);
                if (st !== 'Sale' && st !== 'Done') continue;
                const rate = parseCommissionRatePercent(row);
                if (rate <= 0) continue;
                void accrueSaleCommission.mutateAsync({
                  orderId: row.id as string | number | bigint,
                  ratePercent: rate,
                });
              }
            },
          },
          {
            id: 'apply-omnichannel',
            label: t('sales.actions.applyOmnichannel', {
              defaultValue: 'Apply omnichannel allocation',
            }),
            requiresSelection: true,
            onClick: (rows) => {
              if (rows.length !== 1) return;
              const r = rows[0] as Record<string, unknown>;
              const channel =
                window
                  .prompt(
                    t('sales.actions.omnichannelChannelPrompt', {
                      defaultValue: 'Channel (optional, e.g. web, store)',
                    }),
                  )
                  ?.trim() || null;
              const routeRaw =
                window
                  .prompt(
                    t('sales.actions.omnichannelRoutePrompt', {
                      defaultValue: 'Preferred route id (optional)',
                    }),
                  )
                  ?.trim() ?? '';
              void applyOmnichannelAllocation
                .mutateAsync({
                  orderId: r.id as string | number | bigint,
                  params: {
                    preferredRouteId: routeRaw ? BigInt(routeRaw) : null,
                    channel,
                    metadata: null,
                  },
                })
                .catch((e: unknown) => {
                  window.alert(e instanceof Error ? e.message : String(e));
                });
            },
          },
          {
            id: 'create-invoice',
            label: t('sales.actions.createInvoice'),
            requiresSelection: true,
            onClick: (rows) => {
              if (rows.length !== 1) return;
              const st = saleOrderState(rows[0] as Record<string, unknown>);
              if (st !== 'Sale' && st !== 'Done') return;
              const id = rows[0]?.id;
              if (id == null) return;
              setInvoiceOrderError(null);
              setInvoiceOrderId(BigInt(String(id)));
            },
          },
          {
            id: 'download-pdf',
            label: 'Download PDF',
            requiresSelection: true,
            onClick: (rows) => {
              if (rows.length !== 1) return;
              const id = rows[0]?.id;
              if (id == null) return;
              void downloadDocumentPdf('sale-order', Number(id)).catch((e) => {
                window.alert(e instanceof Error ? e.message : String(e));
              });
            },
          },
          {
            id: 'archive-pdf-dms',
            label: 'Archive PDF to Documents',
            requiresSelection: true,
            onClick: (rows) => {
              if (rows.length !== 1) return;
              const id = rows[0]?.id;
              if (id == null) return;
              void (async () => {
                try {
                  const params = await archiveRenderedPdfAsDocument({
                    kind: 'sale-order',
                    recordId: Number(id),
                    companyId: operatingCompanyId,
                    name: String(rows[0]?.name ?? `Sale order ${id}`),
                  });
                  await createDocument.mutateAsync(params);
                } catch (e) {
                  window.alert(e instanceof Error ? e.message : String(e));
                }
              })();
            },
          },
          {
            id: 'lock-orders',
            label: t('sales.actions.lockOrders'),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                void lockSaleOrder.mutateAsync(r.id as string | number | bigint);
              }
            },
          },
          {
            id: 'unlock-orders',
            label: t('sales.actions.unlockOrders'),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                void unlockSaleOrder.mutateAsync(r.id as string | number | bigint);
              }
            },
          },
        ],
      },
    };
  }, [
    t,
    saleOrdersTableRuntime,
    openCreateSaleOrder,
    confirmSaleOrder,
    sendSaleOrderQuotation,
    acceptSaleOrderQuotation,
    applySalePromotion,
    applySaleOrderOptions,
    cancelSaleOrder,
    computeSoTotals,
    accrueSaleCommission,
    applyOmnichannelAllocation,
    lockSaleOrder,
    unlockSaleOrder,
    orderLines,
    setCsvKind,
    organizationId,
    t,
  ]);

  const pricelistsEntityConfig = useMemo((): EntityViewConfig => {
    const base = pricelistsTableConfig(t);
    const view = base.view as EntityTableConfig;
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: 'toggle-active',
            label: t('sales.actions.togglePricelistActive'),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                const id = r.id as string | number | bigint;
                const active = Boolean(r.active);
                updatePricelist.mutate({ pricelistId: id, isActive: !active });
              }
            },
          },
          {
            id: 'delete-pricelists',
            label: t('sales.actions.deletePricelists'),
            requiresSelection: true,
            variant: 'destructive',
            onClick: (rows) => {
              if (
                typeof window !== 'undefined' &&
                !window.confirm(
                  t('sales.actions.deletePricelistsConfirm', {
                    count: rows.length,
                  }),
                )
              ) {
                return;
              }
              for (const r of rows) {
                deletePricelist.mutate(r.id as string | number | bigint);
              }
            },
          },
        ],
      },
    };
  }, [t, updatePricelist, deletePricelist]);

  const pricelistItemsEntityConfig = useMemo((): EntityViewConfig => {
    const base = pricelistItemsTableConfig(t);
    const view = base.view as EntityTableConfig;
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: 'delete-pricelist-rules',
            label: t('sales.actions.deletePricelistRules'),
            requiresSelection: true,
            variant: 'destructive',
            onClick: (rows) => {
              if (
                typeof window !== 'undefined' &&
                !window.confirm(
                  t('sales.actions.deletePricelistRulesConfirm', {
                    count: rows.length,
                  }),
                )
              ) {
                return;
              }
              for (const r of rows) {
                deletePricelistItem.mutate(r.id as string | number | bigint);
              }
            },
          },
        ],
      },
    };
  }, [t, deletePricelistItem]);

  const deliveriesEntityConfig = useMemo((): EntityViewConfig => {
    const base = deliveriesTableConfig(t);
    const view = base.view as EntityTableConfig;
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: 'start-batches',
            label: t('sales.actions.startBatches'),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                if (deliveryBatchState(r) === 'Draft') {
                  startPickingBatch.mutate(r.id as string | number | bigint);
                }
              }
            },
          },
          {
            id: 'complete-batches',
            label: t('sales.actions.completeBatches'),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                if (deliveryBatchState(r) === 'InProgress') {
                  completePickingBatch.mutate(r.id as string | number | bigint);
                }
              }
            },
          },
          {
            id: 'cancel-batches',
            label: t('sales.actions.cancelBatches'),
            requiresSelection: true,
            variant: 'destructive',
            onClick: (rows) => {
              for (const r of rows) {
                const st = deliveryBatchState(r);
                if (st !== 'Done') {
                  cancelPickingBatch.mutate(r.id as string | number | bigint);
                }
              }
            },
          },
        ],
      },
    };
  }, [t, startPickingBatch, completePickingBatch, cancelPickingBatch]);

  // Confirmed orders (state = "Sale" or "Done")
  const confirmedOrders = useMemo(
    () =>
      orders.filter(
        (o) => String(o.state) === 'Sale' || String(o.state) === 'Done',
      ),
    [orders],
  );

  // Live KPI dashboard sections override
  const liveSections = useMemo(() => {
    const { startMs, endMs } = timeRangeToMs(dashboardTimeRange);
    const previousRange = previousPeriodMs(dashboardTimeRange);
    const inCurrentRange = (row: Record<string, unknown>) =>
      isTimestampInRange(recordTimestampMs(row), startMs, endMs);
    const inPreviousRange = (row: Record<string, unknown>) =>
      isTimestampInRange(recordTimestampMs(row), previousRange.startMs, previousRange.endMs);

    const currentConfirmed = confirmedOrders.filter((o) =>
      inCurrentRange(o as Record<string, unknown>),
    );
    const previousConfirmed = confirmedOrders.filter((o) =>
      inPreviousRange(o as Record<string, unknown>),
    );

    const revenue = currentConfirmed.reduce(
      (s, o) => s + Number(o.amountTotal ?? 0),
      0,
    );
    const previousRevenue = previousConfirmed.reduce(
      (s, o) => s + Number(o.amountTotal ?? 0),
      0,
    );
    const orderCount = currentConfirmed.length;
    const previousOrderCount = previousConfirmed.length;
    const avgDeal = orderCount > 0 ? revenue / orderCount : 0;
    const previousAvgDeal =
      previousOrderCount > 0 ? previousRevenue / previousOrderCount : 0;
    const outstanding = orders.reduce(
      (s, o) => s + Number(o.amountResidual ?? 0),
      0,
    );

    const dashboardTab = moduleConfig.tabs.find(
      (tab) => tab.id === 'dashboard',
    );
    if (!dashboardTab?.sections) return [];

    return dashboardTab.sections.map((section) => ({
      ...section,
      widgets: section.widgets.map((w) => {
        if (w.type === 'stat-cards') {
          if (w.id === 'sales-exception-queue-cards') {
            const awaitingApproval = saleOrdersToApprove.length;
            const sentQuotes = orders.filter(
              (o) => saleOrderState(o as Record<string, unknown>) === 'Sent',
            ).length;
            const creditHolds = partnerCreditHolds.length;
            const returnsToReceive = returnOrders.filter((r) => {
              const st = String(
                (r as Record<string, unknown>).state ?? '',
              ).toLowerCase();
              return st === 'confirmed' || st === 'draft';
            }).length;
            const openDeliveries = stockPickings.filter((p) => {
              const row = p as Record<string, unknown>;
              if (Boolean(row.isReturn ?? row.is_return)) return false;
              const st = String(row.state ?? '').toLowerCase();
              return st !== 'done' && st !== 'cancel' && st !== 'cancelled';
            }).length;
            return {
              ...w,
              title: t('sales.dashboard.exceptionQueues', {
                defaultValue: 'Exception queues',
              }),
              data: {
                stats: [
                  {
                    label: t('sales.dashboard.queues.awaitingApproval', {
                      defaultValue: 'Awaiting approval',
                    }),
                    value: String(awaitingApproval),
                    icon: 'FileText',
                    testId: 'sales-queue-to-approve',
                    onClick: () =>
                      navigateToSalesTab('ops', { queue: 'to_approve' }),
                  },
                  {
                    label: t('sales.dashboard.queues.sentQuotations', {
                      defaultValue: 'Sent quotations',
                    }),
                    value: String(sentQuotes),
                    icon: 'CheckCircle',
                    testId: 'sales-queue-sent',
                    onClick: () =>
                      navigateToSalesTab('ops', { queue: 'sent_quotes' }),
                  },
                  {
                    label: t('sales.dashboard.queues.creditHolds', {
                      defaultValue: 'Credit holds',
                    }),
                    value: String(creditHolds),
                    icon: 'AlertCircle',
                    testId: 'sales-queue-credit',
                    onClick: () =>
                      navigateToSalesTab('ops', { queue: 'credit_holds' }),
                  },
                  {
                    label: t('sales.dashboard.queues.returnsToReceive', {
                      defaultValue: 'Returns to receive',
                    }),
                    value: String(returnsToReceive),
                    icon: 'package',
                    testId: 'sales-queue-returns',
                    onClick: () =>
                      navigateToSalesTab('ops', { queue: 'returns_receive' }),
                  },
                  {
                    label: t('sales.dashboard.queues.openDeliveries', {
                      defaultValue: 'Open deliveries',
                    }),
                    value: String(openDeliveries),
                    icon: 'cart',
                    testId: 'sales-queue-pickings',
                    onClick: () =>
                      navigateToSalesTab('ops', { queue: 'open_deliveries' }),
                  },
                  {
                    label: t('sales.dashboard.queues.commissionsToAccrue', {
                      defaultValue: 'To accrue',
                    }),
                    value: String(
                      orders.filter((o) => {
                        const st = saleOrderState(o as Record<string, unknown>);
                        if (st !== 'Sale' && st !== 'Done') return false;
                        const rate = parseCommissionRatePercent(
                          o as Record<string, unknown>,
                        );
                        if (rate <= 0) return false;
                        const oid = String(
                          (o as Record<string, unknown>).id ?? '',
                        );
                        return !saleCommissions.some((c) => {
                          const row = c as Record<string, unknown>;
                          const stc = String(row.state ?? '').toLowerCase();
                          if (stc === 'cancelled') return false;
                          return (
                            String(row.saleOrderId ?? row.sale_order_id ?? '') ===
                            oid
                          );
                        });
                      }).length,
                    ),
                    icon: 'FileText',
                    testId: 'sales-queue-commissions-to-accrue',
                    onClick: () =>
                      navigateToSalesTab('ops', {
                        queue: 'commissions_to_accrue',
                      }),
                  },
                  {
                    label: t('sales.dashboard.queues.commissionsAccrued', {
                      defaultValue: 'Commissions accrued',
                    }),
                    value: String(saleCommissionsPending.length),
                    icon: 'FileText',
                    testId: 'sales-queue-commissions',
                    onClick: () =>
                      navigateToSalesTab('ops', {
                        queue: 'commissions_accrued',
                      }),
                  },
                  {
                    label: t('sales.dashboard.queues.commissionsSettled', {
                      defaultValue: 'Commissions settled',
                    }),
                    value: String(
                      saleCommissions.filter(
                        (c) =>
                          String(
                            (c as Record<string, unknown>).state ?? '',
                          ).toLowerCase() === 'settled',
                      ).length,
                    ),
                    icon: 'CheckCircle',
                    testId: 'sales-queue-commissions-settled',
                    onClick: () =>
                      navigateToSalesTab('ops', {
                        queue: 'commissions_settled',
                      }),
                  },
                ],
              },
            };
          }
          return {
            ...w,
            data: {
              stats: [
                {
                  label: 'Revenue MTD',
                  value: `$${revenue.toLocaleString()}`,
                  change: percentChange(revenue, previousRevenue),
                  icon: 'TrendingUp',
                },
                {
                  label: 'Orders Confirmed',
                  value: String(orderCount),
                  change: percentChange(orderCount, previousOrderCount),
                  icon: 'ShoppingCart',
                },
                {
                  label: 'Avg Deal Size',
                  value: `$${Math.round(avgDeal).toLocaleString()}`,
                  change: percentChange(avgDeal, previousAvgDeal),
                  icon: 'DollarSign',
                },
                {
                  label: 'Outstanding AR',
                  value: `$${Math.round(outstanding).toLocaleString()}`,
                  icon: 'AlertCircle',
                },
              ],
            },
          };
        }
        if (w.type === 'quick-actions') {
          const handlers: Record<string, () => void> = {
            create_sale_order: () =>
              setQuickActionForm({
                form: saleOrderFormConfig,
                action: 'createSaleOrder',
              }),
            create_pricelist: () =>
              setQuickActionForm({
                form: pricelistFormConfig,
                action: 'createPricelist',
              }),
            new_delivery: () =>
              setQuickActionForm({
                form: pickingBatchFormConfig,
                action: 'createPickingBatch',
              }),
            view_pipeline: () => router.push('/crm'),
            create_commission_plan: () => {
              void promptCreateCommissionPlan().catch((e: unknown) => {
                window.alert(e instanceof Error ? e.message : String(e));
              });
            },
            create_sale_contract: () => {
              void promptCreateSaleContract().catch((e: unknown) => {
                window.alert(e instanceof Error ? e.message : String(e));
              });
            },
            create_integration_intent: () => {
              void promptCreateIntegrationIntent().catch((e: unknown) => {
                window.alert(e instanceof Error ? e.message : String(e));
              });
            },
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
        if (w.id === 'sales-revenue-trend') {
          const monthlyRevenue = groupByMonth(
            confirmedOrders,
            (o) => Number(o.dateOrder ?? 0) / 1000,
            (o) => Number(o.amountTotal ?? 0),
            'Revenue',
            6,
          );
          return {
            ...w,
            data: {
              ...(w.data as Record<string, unknown>),
              values: monthlyRevenue,
            },
          };
        }
        if (w.id === 'sales-by-rep') {
          const byRep = groupBy(confirmedOrders, (o) => {
            const key = identityToHex(o.userId);
            return salesRepLabelByIdentity.get(key) ?? 'Unassigned';
          });
          const repMetrics = Object.entries(byRep)
            .map(([rep, repOrders]) => ({
              label: rep,
              value: Math.round(
                repOrders.reduce((s, o) => s + Number(o.amountTotal ?? 0), 0),
              ),
              max: 0,
              color: '#6366f1',
            }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 4);
          const maxVal = repMetrics[0]?.value ?? 1;
          const metricsWithMax = repMetrics.map((m) => ({ ...m, max: maxVal }));
          return { ...w, data: { metrics: metricsWithMax } };
        }
        if (w.id === 'sales-by-product') {
          const byProduct = groupBy(orderLines, (l) =>
            String(l.name ?? `Product ${l.productId}`),
          );
          const productValues = Object.entries(byProduct)
            .map(([product, lines]) => ({
              product,
              Revenue: Math.round(
                lines.reduce((s, l) => s + Number(l.priceSubtotal ?? 0), 0),
              ),
            }))
            .sort((a, b) => b.Revenue - a.Revenue)
            .slice(0, 4);
          return {
            ...w,
            data: {
              ...(w.data as Record<string, unknown>),
              values: productValues,
            },
          };
        }
        if (w.id === 'sales-orders-by-state') {
          const byState = groupBy(orders, (o) => saleOrderState(o as Record<string, unknown>));
          const segments = Object.entries(byState)
            .filter(([state]) => state !== '')
            .map(([state, stateOrders]) => ({
              name:
                t(`sales.salesOrders.states.${state}`, {
                  defaultValue: state,
                }) ?? state,
              value: stateOrders.length,
              color: SALE_ORDER_STATE_COLORS[state] ?? '#6366f1',
            }))
            .sort((a, b) => b.value - a.value);
          return {
            ...w,
            title: t('sales.dashboard.ordersByState'),
            data: {
              segments,
              onSegmentClick: (name: string) => {
                const match = Object.keys(byState).find(
                  (state) =>
                    t(`sales.salesOrders.states.${state}`, { defaultValue: state }) === name ||
                    state === name,
                );
                if (match) navigateToOrdersByState(match);
              },
            },
          };
        }
        return w;
      }),
    }));
  }, [
    orders,
    confirmedOrders,
    orderLines,
    moduleConfig,
    t,
    saleOrderFormConfig,
    pickingBatchFormConfig,
    router,
    salesRepLabelByIdentity,
    navigateToOrdersByState,
    navigateToSalesTab,
    partnerCreditControls,
    partnerCreditHolds,
    returnOrders,
    stockPickings,
    saleCommissions,
    saleOrdersToApprove,
    saleCommissionsPending,
    dashboardTimeRange,
  ]);

  // Config with live dashboard sections + lookup-backed create forms + entity actions
  const config = useMemo(
    () =>
      ({
        ...moduleConfig,
        tabs: moduleConfig.tabs.map((tab) => {
          if (tab.id === 'dashboard') {
            return { ...tab, sections: liveSections };
          }
          if (tab.id === 'orders' && tab.type === 'entity') {
            return {
              ...tab,
              entityConfig: ordersEntityConfig,
              createForm: saleOrderFormConfig,
              recordSheet: saleOrderRecordSheet,
            };
          }
          if (tab.id === 'order-lines' && tab.type === 'entity' && tab.entityConfig) {
            const base = tab.entityConfig;
            const view = base.view as EntityTableConfig;
            return {
              ...tab,
              createForm: addSaleOrderLineFormConfig,
              createLabel: t('sales.actions.newSaleOrderLine'),
              createAction: 'createSaleOrderLine',
              entityConfig: {
                ...base,
                view: {
                  ...view,
                  rowSelectionToggleOnClick: false,
                  actions: [
                    {
                      id: 'csv-sale-order-lines',
                      label: t('sales.csvImport.toolbarOrderLines'),
                      onClick: () => setCsvKind('orderLine'),
                    },
                    {
                      id: 'delete-sale-order-lines',
                      label: t('sales.actions.deleteOrderLines', {
                        defaultValue: 'Delete lines',
                      }),
                      requiresSelection: true,
                      variant: 'destructive' as const,
                      onClick: (rows) => {
                        for (const r of rows) {
                          void deleteSaleOrderLine
                            .mutateAsync(r.id as string | number | bigint)
                            .catch((e: unknown) => {
                              window.alert(
                                e instanceof Error ? e.message : String(e),
                              );
                            });
                        }
                      },
                    },
                    ...(view.actions ?? []),
                  ],
                },
              },
            };
          }
          if (tab.id === 'pricelists' && tab.type === 'entity') {
            return { ...tab, entityConfig: pricelistsEntityConfig, createForm: pricelistFormConfig };
          }
          if (tab.id === 'pricelist-items' && tab.type === 'entity') {
            return {
              ...tab,
              entityConfig: pricelistItemsEntityConfig,
              createForm: pricelistItemFormConfig,
              createLabel: t('sales.actions.newPricelistItem'),
              createAction: 'createPricelistItem',
            };
          }
          if (tab.id === 'deliveries' && tab.type === 'entity') {
            return {
              ...tab,
              entityConfig: deliveriesEntityConfig,
              createForm: pickingBatchFormConfig,
            };
          }
          if (tab.id === 'fulfillment' && tab.type === 'entity') {
            return { ...tab, entityConfig: fulfillmentEntityConfig };
          }
          if (tab.id === 'returns') {
            return {
              ...tab,
              type: 'custom' as const,
              customContent: (
                <div className="space-y-6">
                  <div className="flex justify-end">
                    <Button
                      size="lg"
                      onClick={() => setOpenReturnForm(true)}
                      data-testid="module-create-sales-returns"
                    >
                      {t('sales.actions.newReturnOrder')}
                    </Button>
                  </div>
                  <EntityView
                    config={returnsEntityConfig}
                    data={returnOrders as unknown as Record<string, unknown>[]}
                    onRowClick={(row) => {
                      const id = returnOrderRowId(row);
                      setSelectedReturnOrderId(id);
                      const target = chatterTargetFromRow('sales', 'returns', row);
                      if (target) setChatterTarget(target);
                    }}
                  />
                  <EntityView
                    config={returnOrderLinesEntityConfig}
                    data={linesForSelectedReturn as unknown as Record<string, unknown>[]}
                  />
                </div>
              ),
            };
          }
          if (tab.id === 'invoices') {
            return {
              ...tab,
              type: 'custom' as const,
              customContent: (
                <InvoiceListView
                  invoices={salesInvoices as unknown as AccountMove[]}
                  onRecalculateTotals={(inv) =>
                    void computeInvoiceTotals.mutateAsync(
                      inv.id as string | number | bigint,
                    )
                  }
                />
              ),
            };
          }
          if (tab.id === 'ops') {
            const opsQueue = parseOpsQueueFilter(urlFilters);
            return {
              ...tab,
              type: 'custom' as const,
              customContent: (
                <SalesOpsPanel
                  activeQueue={opsQueue}
                  onQueueChange={(queue: SalesOpsQueueId) =>
                    navigateToSalesTab('ops', { queue })
                  }
                  orders={orders as unknown as Record<string, unknown>[]}
                  orderLines={orderLines as unknown as Record<string, unknown>[]}
                  partnerCreditControls={
                    partnerCreditControls as unknown as Record<string, unknown>[]
                  }
                  stockPickings={
                    stockPickings as unknown as Record<string, unknown>[]
                  }
                  returnOrders={
                    returnOrders as unknown as Record<string, unknown>[]
                  }
                  commissions={
                    saleCommissions as unknown as Record<string, unknown>[]
                  }
                  ordersToApprove={
                    saleOrdersToApprove as unknown as Record<string, unknown>[]
                  }
                  creditHolds={
                    partnerCreditHolds as unknown as Record<string, unknown>[]
                  }
                  commissionsPending={
                    saleCommissionsPending as unknown as Record<
                      string,
                      unknown
                    >[]
                  }
                  accountMoves={
                    accountMoves as unknown as Record<string, unknown>[]
                  }
                  accountJournals={
                    accountJournals as unknown as Record<string, unknown>[]
                  }
                  accountAccounts={
                    accountAccounts as unknown as Record<string, unknown>[]
                  }
                  settlePending={settleSaleCommissions.isPending}
                  cancelPending={cancelSaleCommission.isPending}
                  reversePending={reverseSaleCommissionSettlement.isPending}
                  accruePending={accrueSaleCommission.isPending}
                  onSettleCommissions={async (input) => {
                    await settleSaleCommissions.mutateAsync({
                      commissionIds: input.commissionIds,
                      journalId: input.journalId,
                      expenseAccountId: input.expenseAccountId,
                      payableAccountId: input.payableAccountId,
                    });
                  }}
                  onCancelCommissions={async (commissionIds) => {
                    for (const commissionId of commissionIds) {
                      await cancelSaleCommission.mutateAsync({ commissionId });
                    }
                  }}
                  onReverseCommissions={async (commissionIds) => {
                    for (const commissionId of commissionIds) {
                      await reverseSaleCommissionSettlement.mutateAsync({
                        commissionId,
                      });
                    }
                  }}
                  onAccrueCommissions={async (items) => {
                    for (const item of items) {
                      await accrueSaleCommission.mutateAsync(item);
                    }
                  }}
                  onCreateCommissionPlan={promptCreateCommissionPlan}
                  onCreateCommissionPlanSplit={promptCreateCommissionPlanSplit}
                  onCreateSaleContract={promptCreateSaleContract}
                  onCreateCpqConstraint={promptCreateCpqConstraint}
                  onCreateIntegrationIntent={promptCreateIntegrationIntent}
                  onRecordIntegrationResult={promptRecordIntegrationResult}
                  onScheduleSlaEscalation={promptScheduleSlaEscalation}
                  advancedPending={
                    createSaleCommissionPlan.isPending ||
                    createSaleCommissionPlanSplit.isPending ||
                    createSaleContract.isPending ||
                    createSaleCpqConstraint.isPending ||
                    createSalesIntegrationIntent.isPending ||
                    recordSalesIntegrationResult.isPending ||
                    scheduleSalesSlaEscalation.isPending
                  }
                  onOpenOrdersTab={() => navigateToSalesTab('orders')}
                  onOpenFulfillment={() => navigateToSalesTab('fulfillment')}
                  onOpenReturns={() => navigateToSalesTab('returns')}
                />
              ),
            };
          }
          if (tab.id === 'loyalty-cards' && tab.type === 'entity') {
            return { ...tab, createForm: loyaltyCardFormConfig };
          }
          if (tab.id === 'delivery-carriers' && tab.type === 'entity') {
            return { ...tab, createForm: deliveryCarrierFormConfig };
          }
          if (tab.id === 'shipping-methods' && tab.type === 'entity') {
            return { ...tab, createForm: shippingMethodFormConfig };
          }
          if (tab.id === 'pos-payment-methods' && tab.type === 'entity') {
            return { ...tab, createForm: posPaymentMethodFormConfig };
          }
          if (tab.id === 'loyalty-programs' && tab.type === 'entity') {
            return { ...tab, createForm: loyaltyProgramFormConfig };
          }
          return tab;
        }),
      }) as ModuleConfig,
    [
      moduleConfig,
      liveSections,
      saleOrderFormConfig,
      addSaleOrderLineFormConfig,
      ordersEntityConfig,
      saleOrderRecordSheet,
      pricelistsEntityConfig,
      pricelistItemsEntityConfig,
      pricelistItemFormConfig,
      pricelistFormConfig,
      deliveryCarrierFormConfig,
      shippingMethodFormConfig,
      posPaymentMethodFormConfig,
      loyaltyProgramFormConfig,
      deliveriesEntityConfig,
      fulfillmentEntityConfig,
      returnsEntityConfig,
      returnOrderLinesEntityConfig,
      returnOrders,
      linesForSelectedReturn,
      returnOrderFormConfig,
      salesInvoices,
      computeInvoiceTotals,
      loyaltyCardFormConfig,
      t,
      setCsvKind,
      urlFilters,
      navigateToSalesTab,
      orders,
      orderLines,
      partnerCreditControls,
      partnerCreditHolds,
      stockPickings,
      saleCommissions,
      saleOrdersToApprove,
      saleCommissionsPending,
      accountMoves,
      accountJournals,
      accountAccounts,
      settleSaleCommissions,
      cancelSaleCommission,
      reverseSaleCommissionSettlement,
      accrueSaleCommission,
      createSaleCommissionPlan,
      createSaleCommissionPlanSplit,
      createSaleContract,
      createSaleCpqConstraint,
      createSalesIntegrationIntent,
      recordSalesIntegrationResult,
      scheduleSalesSlaEscalation,
      // New mutations
      updateSaleOrder,
      lockSaleOrder,
      unlockSaleOrder,
      createInvoiceFromSaleOrder,
    ],
  );

  // Data keyed by tab id
  const data = useMemo(
    () => ({
      orders: (orders as Record<string, unknown>[]).map((row) => ({
        ...row,
        sheetTitle: saleOrderPrimaryLabel(row) || String(row.reference ?? row.id ?? ''),
      })) as unknown as Record<string, unknown>[],
      'order-lines': orderLines as unknown as Record<string, unknown>[],
      pricelists: pricelists as unknown as Record<string, unknown>[],
      'pricelist-items': pricelistItems as unknown as Record<string, unknown>[],
      deliveries: deliveries as unknown as Record<string, unknown>[],
      fulfillment: fulfillmentPickings as unknown as Record<string, unknown>[],
      returns: returnOrders as unknown as Record<string, unknown>[],
      'delivery-price-rules': deliveryPriceRules as unknown as Record<
        string,
        unknown
      >[],
      'delivery-carriers': deliveryCarriers as unknown as Record<string, unknown>[],
      'shipping-methods': shippingMethods as unknown as Record<string, unknown>[],
      'pos-payment-methods': posPaymentMethods as unknown as Record<
        string,
        unknown
      >[],
      'loyalty-programs': loyaltyPrograms as unknown as Record<string, unknown>[],
      'loyalty-cards': loyaltyCards as unknown as Record<string, unknown>[],
    }),
    [
      orders,
      orderLines,
      pricelists,
      pricelistItems,
      deliveries,
      fulfillmentPickings,
      returnOrders,
      deliveryPriceRules,
      deliveryCarriers,
      shippingMethods,
      posPaymentMethods,
      loyaltyPrograms,
      loyaltyCards,
    ],
  );

  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === 'createSaleOrder') {
      const p = toCreateSaleOrderParams(formData, pricelists, operatingCompanyId);
      if (p) {
        await createSaleOrder.mutateAsync(p);
        phCapture('sale_order_created', { organization_id: organizationId });
        if (p.metadata && operatingCompanyId !== 0n) {
          const entries = customFieldEntriesFromMetadata(p.metadata);
          if (entries.length > 0) {
            const rows = await fetchQueryList('/api/query/sale-orders', 'Failed to fetch sale orders');
            const row =
              p.clientOrderRef != null && String(p.clientOrderRef).trim() !== ''
                ? findNewestRowByField(rows, 'clientOrderRef', String(p.clientOrderRef))
                : findNewestRowByPartnerId(rows, p.partnerId);
            if (row?.id) {
              await persistCustomFieldsToEav({
                organizationId,
                companyId: operatingCompanyId,
                model: 'sale_order',
                recordId: BigInt(String(row.id)),
                metadata: p.metadata,
              });
            }
          }
        }
      }
    } else if (action === 'createPricelist') {
      const p = toCreatePricelistParams(formData);
      if (p) await createPricelist.mutateAsync(p);
    } else if (action === 'createPricelistItem') {
      const p = toCreatePricelistItemParams(formData);
      if (p) await createPricelistItem.mutateAsync(p);
    } else if (action === 'createSaleOrderLine') {
      const params = toCreateSaleOrderLineParams(formData);
      const orderId = formData.orderId;
      if (params == null || orderId === '' || orderId == null) return;
      await createSaleOrderLine.mutateAsync({
        orderId: orderId as string | number | bigint,
        params,
      });
    } else if (action === 'createReturnOrder') {
      const params = toCreateReturnOrderParams(formData);
      if (params) await createReturnOrder.mutateAsync(params);
    } else if (action === 'createPickingBatch') {
      const p = toCreatePickingBatchParams(formData);
      if (p) await createPickingBatch.mutateAsync(p);
    } else if (action === 'createDeliveryPriceRule') {
      const p = toCreateDeliveryPriceRuleParams(formData);
      if (p) await createDeliveryPriceRule.mutateAsync(p);
    } else if (action === 'createDeliveryCarrier') {
      const p = toCreateDeliveryCarrierParams(formData);
      if (p) await createDeliveryCarrier.mutateAsync(p);
    } else if (action === 'createShippingMethod') {
      const p = toCreateShippingMethodParams(formData);
      if (p) await createShippingMethod.mutateAsync(p);
    } else if (action === 'createPaymentMethod') {
      const p = toCreatePaymentMethodParams(formData);
      if (p) await createPaymentMethod.mutateAsync(p);
    } else if (action === 'createLoyaltyProgram') {
      const p = toCreateLoyaltyProgramParams(formData);
      if (p) await createLoyaltyProgram.mutateAsync(p);
    } else if (action === 'createLoyaltyCard') {
      const programIdNum = Number(formData.programId);
      const code = String(formData.code ?? '').trim();
      const points = Number(formData.points);
      if (!Number.isFinite(programIdNum) || programIdNum <= 0 || !code || !Number.isFinite(points)) return;
      const partnerRaw = formData.partnerId;
      await createLoyaltyCard.mutateAsync({
        partnerId:
          partnerRaw === '' || partnerRaw == null ? null : Number(partnerRaw),
        programId: programIdNum,
        code,
        points,
      });
    }
  };

  const isFormMutationPending =
    createSaleOrder.isPending ||
    createPricelist.isPending ||
    createPricelistItem.isPending ||
    createPickingBatch.isPending ||
    confirmSaleOrder.isPending ||
    cancelSaleOrder.isPending ||
    computeSoTotals.isPending ||
    updatePricelist.isPending ||
    deletePricelist.isPending ||
    deletePricelistItem.isPending ||
    startPickingBatch.isPending ||
    completePickingBatch.isPending ||
    cancelPickingBatch.isPending ||
    updateSaleOrder.isPending ||
    lockSaleOrder.isPending ||
    unlockSaleOrder.isPending ||
    createSaleOrderLine.isPending ||
    updateSaleOrderLine.isPending ||
    deleteSaleOrderLine.isPending ||
    createInvoiceFromSaleOrder.isPending ||
    createDeliveryCarrier.isPending ||
    createDeliveryPriceRule.isPending ||
    createShippingMethod.isPending ||
    createPaymentMethod.isPending ||
    createLoyaltyProgram.isPending ||
    createLoyaltyCard.isPending ||
    createReturnOrder.isPending ||
    confirmReturnOrder.isPending ||
    cancelReturnOrder.isPending ||
    createCreditNoteFromReturnOrder.isPending ||
    importSaleOrderCsv.isPending ||
    importSaleOrderLineCsv.isPending ||
    computeInvoiceTotals.isPending ||
    confirmPicking.isPending ||
    assignPicking.isPending ||
    validatePicking.isPending ||
    cancelPicking.isPending ||
    doneStockMove.isPending;

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        dataLoading={{ orders: ordersLoading }}
        onFormSubmit={handleFormSubmit}
        isPending={isFormMutationPending}
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
        dashboardTimeRange={dashboardTimeRange}
        onDashboardTimeRangeChange={setDashboardTimeRange}
        urlFilters={urlFilters}
        onRowClick={(tabId, row) => {
          const target = chatterTargetFromRow('sales', tabId, row);
          if (target) setChatterTarget(target);
        }}
      />
      {chatterTarget ? (
        <>
          <RecordChatterDialog
            key={`${chatterTarget.resModel}-${chatterTarget.resId.toString()}`}
            open
            onOpenChange={(open) => {
              if (!open) setChatterTarget(null);
            }}
            organizationId={organizationId}
            resModel={chatterTarget.resModel}
            resId={chatterTarget.resId}
            recordTitle={chatterTarget.recordTitle}
          />
          <div className="mx-4 mb-4 max-w-3xl">
            <RecordDocumentAttachments
              organizationId={orgId}
              resModel={chatterTarget.resModel}
              resId={chatterTarget.resId}
              title={`Attachments — ${chatterTarget.recordTitle ?? chatterTarget.resModel}`}
            />
          </div>
        </>
      ) : null}
      <RuntimeFormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        staticConfig={quickActionForm?.form ?? saleOrderFormConfig}
        moduleId="sales"
        organizationId={organizationId}
        roleId={runtimeRoleId}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (quickActionForm) {
            await handleFormSubmit('dashboard', quickActionForm.action, formData);
            setQuickActionForm(null);
          }
        }}
      />
      {csvKind === 'order' ? (
        <ImportAssistantWizard
          key="order-assistant"
          open
          organizationId={organizationId}
          onOpenChange={(open) => !open && setCsvKind(null)}
          targetEntity="sale_order"
          importBundle={SALE_ORDER_IMPORT_BUNDLE}
          title={t('sales.csvImport.ordersTitle')}
          isImportPending={importSaleOrderCsv.isPending || importSaleOrderLineCsv.isPending}
          onImport={async (csvData) => {
            await importSaleOrderCsv.mutateAsync(csvData);
          }}
          onImportLines={async (lineCsv) => {
            await importSaleOrderLineCsv.mutateAsync(lineCsv);
          }}
          resolveOrderIds={async (refs) => {
            const orders = (await fetchQueryList(
              '/api/query/sale-orders',
              'Failed to fetch sale orders',
            )) as SaleOrderLinkRow[];
            return buildOrderIdMapFromSaleOrders(orders, refs);
          }}
        />
      ) : null}
      {csvKind && csvKind !== 'order' && csvFormConfig ? (
        <FormModal
          key={csvKind}
          open
          onOpenChange={(o) => !o && setCsvKind(null)}
          config={csvFormConfig}
          isPending={isFormMutationPending}
          closeOnSubmit={false}
          submitError={csvError}
          onSubmit={async (data) => {
            setCsvError(null);
            const files = data.csvFile as FileList | undefined;
            const file = files?.[0];
            if (!file) {
              setCsvError(t('common.validation.required'));
              return;
            }
            try {
              const text = await file.text();
              await importSaleOrderLineCsv.mutateAsync(text);
              setCsvKind(null);
            } catch (e) {
              setCsvError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      ) : null}
      {invoiceOrderId != null ? (
        <RuntimeFormModal
          key={`invoice-order-${invoiceOrderId.toString()}`}
          open
          onOpenChange={(o) => {
            if (!o) {
              setInvoiceOrderId(null);
              setInvoiceOrderError(null);
            }
          }}
          staticConfig={createInvoiceFormConfig}
          moduleId="sales"
          formId="create-invoice-from-sale-order"
          organizationId={organizationId}
          roleId={runtimeRoleId}
          foldCustomFieldsIntoMetadata={false}
          closeOnSubmit={false}
          submitError={invoiceOrderError}
          isPending={createInvoiceFromSaleOrder.isPending}
          onSubmit={async (formData) => {
            setInvoiceOrderError(null);
            const orderRow = (orders as Record<string, unknown>[]).find(
              (o) => String(o.id) === String(invoiceOrderId),
            );
            const partnerInvoiceId =
              orderRow?.partnerInvoiceId != null
                ? BigInt(String(orderRow.partnerInvoiceId))
                : undefined;
            const params = toCreateInvoiceFromSaleOrderParams(formData, {
              partnerInvoiceId,
            });
            if (!params) {
              setInvoiceOrderError(t('common.validation.required'));
              return;
            }
            try {
              await createInvoiceFromSaleOrder.mutateAsync({
                orderId: invoiceOrderId,
                params,
              });
              setInvoiceOrderId(null);
            } catch (e) {
              setInvoiceOrderError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      ) : null}
      {partialDeliveryPicking != null && partialDeliveryFormConfig ? (
        <FormModal
          key={`partial-delivery-${String(pickingRowId(partialDeliveryPicking))}`}
          open
          onOpenChange={(o) => {
            if (!o) {
              setPartialDeliveryPicking(null);
              setPartialDeliveryError(null);
            }
          }}
          config={partialDeliveryFormConfig}
          closeOnSubmit={false}
          submitError={partialDeliveryError}
          isPending={doneStockMove.isPending || validatePicking.isPending}
          onSubmit={async (formData) => {
            setPartialDeliveryError(null);
            if (assignedMovesForPartialDelivery.length === 0) {
              setPartialDeliveryError(t('sales.forms.partialDelivery.errors.noAssignedMoves'));
              return;
            }
            const pickingId = pickingRowId(partialDeliveryPicking);
            if (pickingId == null) return;
            try {
              for (const move of assignedMovesForPartialDelivery) {
                const moveId = move.id as string | number | bigint;
                const ordered = Number(move.productUomQty ?? move.product_uom_qty ?? 0);
                const qty = Number(formData[`qty_${String(moveId)}`]);
                if (!Number.isFinite(qty)) {
                  setPartialDeliveryError(t('sales.forms.partialDelivery.errors.qtyRequired'));
                  return;
                }
                if (qty < 0 || qty > ordered) {
                  setPartialDeliveryError(t('sales.forms.partialDelivery.errors.invalidQty'));
                  return;
                }
                if (qty > 0 && qty < ordered) {
                  await doneStockMove.mutateAsync({ moveId, quantityDone: qty });
                }
              }
              await validatePicking.mutateAsync({
                pickingId,
                createBackorder: formData.createBackorder === true,
              });
              setPartialDeliveryPicking(null);
            } catch (e) {
              setPartialDeliveryError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      ) : null}
      {cancelPickingTarget != null && cancelPickingFormConfig ? (
        <FormModal
          key={`cancel-picking-${String(pickingRowId(cancelPickingTarget))}`}
          open
          onOpenChange={(o) => {
            if (!o) {
              setCancelPickingTarget(null);
              setCancelPickingError(null);
            }
          }}
          config={cancelPickingFormConfig}
          closeOnSubmit={false}
          submitError={cancelPickingError}
          isPending={cancelPicking.isPending}
          onSubmit={async (formData) => {
            setCancelPickingError(null);
            if (formData.confirmCancel !== true) {
              setCancelPickingError(t('common.validation.required'));
              return;
            }
            const id = pickingRowId(cancelPickingTarget);
            if (id == null) return;
            try {
              await cancelPicking.mutateAsync(id);
              setCancelPickingTarget(null);
            } catch (e) {
              setCancelPickingError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      ) : null}
      {editSaleOrderTarget != null ? (
        <FormModal
          key={`edit-sale-order-${String(editSaleOrderTarget.id)}`}
          open
          onOpenChange={(o) => {
            if (!o) {
              setEditSaleOrderTarget(null);
              setEditSaleOrderError(null);
            }
          }}
          config={mergeFieldDefaultValues(editSaleOrderForm(t), {
            clientOrderRef: String(
              editSaleOrderTarget.clientOrderRef ??
                editSaleOrderTarget.client_order_ref ??
                '',
            ),
            note: String(editSaleOrderTarget.note ?? ''),
            incoterm: String(editSaleOrderTarget.incoterm ?? ''),
            incotermLocation: String(
              editSaleOrderTarget.incotermLocation ??
                editSaleOrderTarget.incoterm_location ??
                '',
            ),
            commissionRatePercent:
              parseCommissionRatePercent(editSaleOrderTarget) || '',
          })}
          closeOnSubmit={false}
          submitError={editSaleOrderError}
          isPending={updateSaleOrder.isPending}
          onSubmit={async (formData) => {
            setEditSaleOrderError(null);
            const id = editSaleOrderTarget.id;
            if (id == null) return;
            try {
              const rateRaw = formData.commissionRatePercent;
              const rate =
                rateRaw === '' || rateRaw == null
                  ? null
                  : Number(rateRaw);
              const metadata = mergeCommissionRateIntoMetadata(
                editSaleOrderTarget.metadata,
                rate != null && Number.isFinite(rate) ? rate : null,
              );
              await updateSaleOrder.mutateAsync({
                orderId: id as string | number | bigint,
                params: {
                  clientOrderRef:
                    typeof formData.clientOrderRef === 'string'
                      ? formData.clientOrderRef
                      : undefined,
                  note: typeof formData.note === 'string' ? formData.note : undefined,
                  incoterm:
                    typeof formData.incoterm === 'string' ? formData.incoterm : undefined,
                  incotermLocation:
                    typeof formData.incotermLocation === 'string'
                      ? formData.incotermLocation
                      : undefined,
                  metadata,
                },
              });
              setEditSaleOrderTarget(null);
            } catch (e) {
              setEditSaleOrderError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      ) : null}
      <FormModal
        open={openReturnForm}
        onOpenChange={setOpenReturnForm}
        config={returnOrderFormConfig}
        isPending={createReturnOrder.isPending}
        onSubmit={async (formData) => {
          const params = toCreateReturnOrderParams(formData);
          if (!params) return;
          await createReturnOrder.mutateAsync(params);
          setOpenReturnForm(false);
        }}
      />
      {creditReturnOrderId != null ? (
        <RuntimeFormModal
          key={`credit-return-${creditReturnOrderId.toString()}`}
          open
          onOpenChange={(o) => {
            if (!o) {
              setCreditReturnOrderId(null);
              setCreditReturnOrderError(null);
            }
          }}
          staticConfig={createInvoiceFormConfig}
          moduleId="sales"
          formId="create-invoice-from-sale-order"
          organizationId={organizationId}
          roleId={runtimeRoleId}
          foldCustomFieldsIntoMetadata={false}
          closeOnSubmit={false}
          submitError={creditReturnOrderError}
          isPending={createCreditNoteFromReturnOrder.isPending}
          onSubmit={async (formData) => {
            setCreditReturnOrderError(null);
            const params = toCreateCreditNoteFromReturnOrderParams(formData);
            if (!params) {
              setCreditReturnOrderError(t('common.validation.required'));
              return;
            }
            try {
              await createCreditNoteFromReturnOrder.mutateAsync({
                returnOrderId: creditReturnOrderId,
                params,
              });
              setCreditReturnOrderId(null);
            } catch (e) {
              setCreditReturnOrderError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      ) : null}
    </>
  );
}

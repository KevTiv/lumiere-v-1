'use client';

import { phCapture } from '@/lib/posthog-browser';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@lumiere/i18n';
import {
  ModuleView,
  FormModal,
  newSaleOrderForm,
  newPricelistForm,
  newPricelistItemForm,
  newPickingBatchForm,
  newLoyaltyCardForm,
  createInvoiceFromSaleOrderForm,
  InvoiceListView,
  MissingOrganization,
  mergeSelectOptionsForFields,
  saleOrdersTableConfig,
  pricelistsTableConfig,
  pricelistItemsTableConfig,
  deliveriesTableConfig,
  salesFulfillmentTableConfig,
  salesReturnsTableConfig,
  csvImportForm,
  ImportAssistantWizard,
} from '@lumiere/ui';
import type {
  EntityViewConfig,
  EntityTableConfig,
  FormConfig,
  ModuleConfig,
} from '@lumiere/ui';
import {
  toCreatePickingBatchParams,
  toCreatePricelistParams,
  toCreateSaleOrderParams,
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
} from '@lumiere/query-hooks/hooks/sales';
import {
  useAccountMoves,
  useAccountJournals,
  useAccountAccounts,
  useComputeInvoiceTotals,
  type AccountMove,
} from '@lumiere/query-hooks/hooks/accounting';
import {
  useStockPickings,
  useConfirmStockPicking,
  useAssignStockPicking,
  useValidateStockPicking,
  useCancelStockPicking,
} from '@lumiere/query-hooks/hooks/inventory';
import { useContacts, useUsers } from '@lumiere/query-hooks/hooks/crm';
import { useWarehouses } from '@lumiere/query-hooks/hooks/inventory';
import { hasValidOrganizationId, orgBigInts } from '@/lib/org-scoped';
import { useDefaultOperatingCompanyBigInt } from '@lumiere/query-hooks/hooks/use-operating-company';
import {
  contactRowsToPartnerSelectOptions,
  pricelistRowsToSelectOptions,
  warehouseRowsToSelectOptions,
  loyaltyProgramRowsToSelectOptions,
  accountJournalRowsToSelectOptions,
  accountAccountRowsToSelectOptions,
} from '@/lib/form-lookup';
import { stdbParamsToJson } from '@/lib/stdb-params-json';
import type { CreatePricelistItemParams } from '@lumiere/stdb/types';

function saleOrderState(row: Record<string, unknown>): string {
  const v = row.state;
  if (v != null && typeof v === 'object' && 'tag' in v)
    return String((v as { tag: string }).tag);
  return String(v ?? '');
}

function deliveryBatchState(row: Record<string, unknown>): string {
  const v = row.state;
  if (v != null && typeof v === 'object' && 'tag' in v)
    return String((v as { tag: string }).tag);
  return String(v ?? '');
}

function moveTypeTag(row: Record<string, unknown>): string {
  const v = row.moveType ?? row.move_type;
  if (v != null && typeof v === 'object' && 'tag' in v)
    return String((v as { tag: string }).tag);
  return String(v ?? '');
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
  return String(row.state ?? '').toLowerCase();
}

function toCreatePricelistItemParams(
  formData: Record<string, unknown>,
): CreatePricelistItemParams | null {
  const pricelistRaw = formData.pricelistId;
  if (pricelistRaw == null || String(pricelistRaw).trim() === '') return null;
  const pricelistId = BigInt(String(pricelistRaw));
  const appliedOnRaw = String(formData.appliedOn ?? 'AllProducts');
  const computeRaw = String(formData.computePrice ?? 'Fixed');
  const appliedOn =
    appliedOnRaw === 'Category'
      ? { tag: 'Category' as const }
      : appliedOnRaw === 'Product'
        ? { tag: 'Product' as const }
        : { tag: 'AllProducts' as const };
  const computePrice =
    computeRaw === 'Percentage'
      ? { tag: 'Percentage' as const }
      : computeRaw === 'Formula'
        ? { tag: 'Formula' as const }
        : { tag: 'Fixed' as const };
  const productRaw = formData.productId;
  const categRaw = formData.categId;
  return {
    pricelistId,
    appliedOn,
    computePrice,
    productTmplId: undefined,
    productId:
      productRaw == null || String(productRaw).trim() === ''
        ? undefined
        : BigInt(String(productRaw)),
    categId:
      categRaw == null || String(categRaw).trim() === ''
        ? undefined
        : BigInt(String(categRaw)),
    minQuantity: Number(formData.minQuantity ?? 1) || 0,
    dateStart: undefined,
    dateEnd: undefined,
    fixedPrice: Number(formData.fixedPrice ?? 0) || 0,
    percentPrice: Number(formData.percentPrice ?? 0) || 0,
    priceDiscount: Number(formData.priceDiscount ?? 0) || 0,
    priceSurcharge: 0,
    priceMinMargin: 0,
    priceMaxMargin: 0,
    sequence: Math.max(0, Math.trunc(Number(formData.sequence ?? 10))),
  };
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
  organizationId,
}: SalesClientLoadedProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n;
  const [quickActionForm, setQuickActionForm] = useState<{
    form: FormConfig;
    action: string;
  } | null>(null);
  const [csvKind, setCsvKind] = useState<SalesCsvImportKind | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [invoiceOrderId, setInvoiceOrderId] = useState<bigint | null>(null);
  const [invoiceOrderError, setInvoiceOrderError] = useState<string | null>(null);

  const { data: orders = [] } = useSaleOrders(orgId, initialOrders);
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
  const { data: accountMoves = [] } = useAccountMoves(orgId, { initialData: initialAccountMoves });
  const { data: accountJournals = [] } = useAccountJournals(orgId);
  const { data: accountAccounts = [] } = useAccountAccounts(orgId);
  const { data: stockPickings = [] } = useStockPickings(orgId, initialStockPickings);

  const createSaleOrder = useCreateSaleOrder(orgId, operatingCompanyId);
  const createPricelist = useCreatePricelist(orgId);
  const createPricelistItem = useCreatePricelistItem(orgId);
  const createPickingBatch = useCreatePickingBatch(orgId, operatingCompanyId);
  const confirmSaleOrder = useConfirmSaleOrder(orgId);
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
  const computeInvoiceTotals = useComputeInvoiceTotals(organizationId, operatingCompanyId);
  const confirmPicking = useConfirmStockPicking(orgId, operatingCompanyId);
  const assignPicking = useAssignStockPicking(orgId, operatingCompanyId);
  const validatePicking = useValidateStockPicking(orgId, operatingCompanyId);
  const cancelPicking = useCancelStockPicking(orgId, operatingCompanyId);

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

  const pricelistItemFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newPricelistItemForm(t), {
        pricelistId: pricelistFieldOptions,
      }),
    [t, pricelistFieldOptions],
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
      }),
    [t, partnerFieldOptions, pricelistFieldOptions, warehouseFieldOptions],
  );

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
      }),
    [t, loyaltyProgramFieldOptions],
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

  const returnPickings = useMemo(
    () =>
      (stockPickings as Record<string, unknown>[]).filter((p) =>
        pickingIsReturn(p),
      ),
    [stockPickings],
  );

  const journalFieldOptions = useMemo(() => {
    const fromApi = accountJournalRowsToSelectOptions(
      accountJournals as Record<string, unknown>[],
    );
    if (fromApi.length > 0) return fromApi;
    return [
      { value: '', label: t('sales.forms.createInvoiceFromOrder.noJournals'), disabled: true },
    ];
  }, [accountJournals, t]);

  const incomeAccountFieldOptions = useMemo(() => {
    const fromApi = accountAccountRowsToSelectOptions(
      accountAccounts as Record<string, unknown>[],
    );
    if (fromApi.length > 0) return fromApi;
    return [
      { value: '', label: t('sales.forms.createInvoiceFromOrder.noAccounts'), disabled: true },
    ];
  }, [accountAccounts, t]);

  const createInvoiceFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(createInvoiceFromSaleOrderForm(t), {
        journalId: journalFieldOptions,
        defaultIncomeAccountId: incomeAccountFieldOptions,
      }),
    [t, journalFieldOptions, incomeAccountFieldOptions],
  );

  const pickingActions = useMemo(
    (): EntityTableConfig['actions'] => [
      {
        id: 'confirm-picking',
        label: t('inventory.transferActions.confirm'),
        requiresSelection: true,
        onClick: (rows) => {
          const id = rows[0]?.id;
          if (id != null && pickingStateStr(rows[0] as Record<string, unknown>) === 'draft') {
            void confirmPicking.mutateAsync(id as string | number | bigint);
          }
        },
      },
      {
        id: 'assign-picking',
        label: t('inventory.transferActions.assign'),
        requiresSelection: true,
        onClick: (rows) => {
          const id = rows[0]?.id;
          if (id != null) void assignPicking.mutateAsync(id as string | number | bigint);
        },
      },
      {
        id: 'validate-picking',
        label: t('inventory.transferActions.validate'),
        requiresSelection: true,
        onClick: (rows) => {
          const id = rows[0]?.id;
          if (id != null) void validatePicking.mutateAsync(id as string | number | bigint);
        },
      },
      {
        id: 'cancel-picking',
        label: t('inventory.transferActions.cancel'),
        requiresSelection: true,
        variant: 'destructive',
        onClick: (rows) => {
          const id = rows[0]?.id;
          const st = pickingStateStr(rows[0] as Record<string, unknown>);
          if (id != null && st !== 'done') {
            void cancelPicking.mutateAsync(id as string | number | bigint);
          }
        },
      },
    ],
    [t, confirmPicking, assignPicking, validatePicking, cancelPicking],
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
        actions: pickingActions,
      },
    };
  }, [t, pickingActions]);

  const ordersEntityConfig = useMemo((): EntityViewConfig => {
    const base = saleOrdersTableConfig(t, {
      formatSaleOrderDisplayName: saleOrderPrimaryLabel,
    });
    const view = base.view as EntityTableConfig;
    return {
      ...base,
      view: {
        ...view,
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
                  confirmSaleOrder.mutate(r.id as string | number | bigint);
                  phCapture('sale_order_confirmed', { organization_id: organizationId });
                }
              }
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
                  cancelSaleOrder.mutate({
                    orderId: r.id as string | number | bigint,
                  });
                  phCapture('sale_order_cancelled', { organization_id: organizationId });
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
    confirmSaleOrder,
    cancelSaleOrder,
    computeSoTotals,
    lockSaleOrder,
    unlockSaleOrder,
    setCsvKind,
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
    const revenue = confirmedOrders.reduce(
      (s, o) => s + Number(o.amountTotal ?? 0),
      0,
    );
    const orderCount = confirmedOrders.length;
    const avgDeal = orderCount > 0 ? revenue / orderCount : 0;
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
          return {
            ...w,
            data: {
              stats: [
                {
                  label: 'Revenue MTD',
                  value: `$${revenue.toLocaleString()}`,
                  icon: 'TrendingUp',
                },
                {
                  label: 'Orders Confirmed',
                  value: String(orderCount),
                  icon: 'ShoppingCart',
                },
                {
                  label: 'Avg Deal Size',
                  value: `$${Math.round(avgDeal).toLocaleString()}`,
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
                form: newPricelistForm(t),
                action: 'createPricelist',
              }),
            new_delivery: () =>
              setQuickActionForm({
                form: pickingBatchFormConfig,
                action: 'createPickingBatch',
              }),
            view_pipeline: () => router.push('/crm'),
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
            };
          }
          if (tab.id === 'order-lines' && tab.type === 'entity' && tab.entityConfig) {
            const base = tab.entityConfig;
            const view = base.view as EntityTableConfig;
            return {
              ...tab,
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
                    ...(view.actions ?? []),
                  ],
                },
              },
            };
          }
          if (tab.id === 'pricelists' && tab.type === 'entity') {
            return { ...tab, entityConfig: pricelistsEntityConfig };
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
          if (tab.id === 'returns' && tab.type === 'entity') {
            return { ...tab, entityConfig: returnsEntityConfig };
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
          if (tab.id === 'loyalty-cards' && tab.type === 'entity') {
            return { ...tab, createForm: loyaltyCardFormConfig };
          }
          return tab;
        }),
      }) as ModuleConfig,
    [
      moduleConfig,
      liveSections,
      saleOrderFormConfig,
      ordersEntityConfig,
      pricelistsEntityConfig,
      pricelistItemsEntityConfig,
      pricelistItemFormConfig,
      deliveriesEntityConfig,
      fulfillmentEntityConfig,
      returnsEntityConfig,
      salesInvoices,
      computeInvoiceTotals,
      loyaltyCardFormConfig,
      t,
      setCsvKind,
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
      orders: orders as unknown as Record<string, unknown>[],
      'order-lines': orderLines as unknown as Record<string, unknown>[],
      pricelists: pricelists as unknown as Record<string, unknown>[],
      'pricelist-items': pricelistItems as unknown as Record<string, unknown>[],
      deliveries: deliveries as unknown as Record<string, unknown>[],
      fulfillment: fulfillmentPickings as unknown as Record<string, unknown>[],
      returns: returnPickings as unknown as Record<string, unknown>[],
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
      returnPickings,
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
      }
    } else if (action === 'createPricelist') {
      const p = toCreatePricelistParams(formData);
      if (p) await createPricelist.mutateAsync(p);
    } else if (action === 'createPricelistItem') {
      const p = toCreatePricelistItemParams(formData);
      if (p) await createPricelistItem.mutateAsync(stdbParamsToJson(p));
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
    importSaleOrderCsv.isPending ||
    importSaleOrderLineCsv.isPending ||
    computeInvoiceTotals.isPending ||
    confirmPicking.isPending ||
    assignPicking.isPending ||
    validatePicking.isPending ||
    cancelPicking.isPending;

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
        isPending={isFormMutationPending}
      />
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? saleOrderFormConfig}
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
              if (csvKind === 'order') {
                await importSaleOrderCsv.mutateAsync(text);
              } else {
                await importSaleOrderLineCsv.mutateAsync(text);
              }
              setCsvKind(null);
            } catch (e) {
              setCsvError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      ) : null}
      {invoiceOrderId != null ? (
        <FormModal
          key={`invoice-order-${invoiceOrderId.toString()}`}
          open
          onOpenChange={(o) => {
            if (!o) {
              setInvoiceOrderId(null);
              setInvoiceOrderError(null);
            }
          }}
          config={createInvoiceFormConfig}
          closeOnSubmit={false}
          submitError={invoiceOrderError}
          isPending={createInvoiceFromSaleOrder.isPending}
          onSubmit={async (formData) => {
            setInvoiceOrderError(null);
            const journalId = formData.journalId;
            const defaultIncomeAccountId = formData.defaultIncomeAccountId;
            if (
              journalId == null ||
              String(journalId).trim() === '' ||
              defaultIncomeAccountId == null ||
              String(defaultIncomeAccountId).trim() === ''
            ) {
              setInvoiceOrderError(t('common.validation.required'));
              return;
            }
            try {
              await createInvoiceFromSaleOrder.mutateAsync({
                orderId: invoiceOrderId,
                journalId: BigInt(String(journalId)),
                defaultIncomeAccountId: BigInt(String(defaultIncomeAccountId)),
              });
              setInvoiceOrderId(null);
            } catch (e) {
              setInvoiceOrderError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      ) : null}
    </>
  );
}

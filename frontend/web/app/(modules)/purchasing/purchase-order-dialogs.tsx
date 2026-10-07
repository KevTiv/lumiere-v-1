'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from '@lumiere/i18n';
import {
  RuntimeFormModal,
  addPurchaseOrderLineForm,
  createBillFromPurchaseOrderForm,
  editPurchaseOrderForm,
  editPurchaseOrderLineForm,
  mergeFieldDefaultValues,
  invoicePurchaseOrderLineForm,
  mergeSelectOptionsForFields,
  receivePurchaseOrderLineForm,
  useRBAC,
} from '@lumiere/ui';
import type { FormConfig } from '@lumiere/ui';
import { showWorkflowToast } from '@lumiere/ui/lib/workflow-toast';
import {
  useAccountAccounts,
  useAccountJournals,
  useAccountPaymentTerms,
} from '@lumiere/query-hooks/hooks/accounting';
import { useContacts } from '@lumiere/query-hooks/hooks/crm';
import { useProducts, useUoms } from '@lumiere/query-hooks/hooks/inventory';
import {
  useAddPurchaseOrderLine,
  useInvoicePurchaseOrderLine,
  useUpdatePurchaseOrder,
  useUpdatePurchaseOrderLine,
} from '@lumiere/query-hooks/hooks/purchasing';
import type { usePurchasingWorkflow } from '@lumiere/query-hooks/hooks/purchasing-workflow';
import {
  accountAccountRowsToSelectOptions,
  accountJournalRowsToSelectOptions,
  contactRowsToVendorSelectOptions,
  productRowsToSelectOptions,
  purchaseOrderLineRowsToInvoiceOptions,
  purchaseOrderLineRowsToReceiveOptions,
  purchaseOrderRowsToSelectOptions,
  uomRowsToSelectOptions,
} from '@/lib/form-lookup';
import { orgBigInts } from '@/lib/org-scoped';
import {
  toAddPurchaseOrderLineParams,
  toCreateBillFromPurchaseOrderParams,
  toInvoicePoLineArgs,
  toReceivePoLineArgs,
  toUpdatePurchaseOrderLineParams,
} from '@/lib/purchasing-create-params';
import {
  enumTag,
  purchaseOrderHeaderDefaults,
  purchaseOrderLineEditDefaults,
  toReceiveLineInput,
  toUpdatePurchaseOrderHeaderArgs,
} from './purchase-order-forms';

type PurchasingWorkflow = ReturnType<typeof usePurchasingWorkflow>;
type Row = Record<string, unknown>;
type SelectOptions = Array<{ value: string; label: string; disabled?: boolean }>;

export const journalTypeTag = (row: { type?: unknown; type_?: unknown }): string => enumTag(row.type_ ?? row.type);
export const accountInternalTypeTag = (row: Row): string =>
  enumTag(row.internalType ?? row.internal_type).toLowerCase();
export const accountInternalGroupTag = (row: Row): string =>
  enumTag(row.internalGroup ?? row.internal_group).toLowerCase();

/** Purchase journal, expense and payable account choices for the vendor bill form. */
export function billLookupOptions(
  t: (key: string) => string,
  journals: readonly Row[],
  accounts: readonly Row[],
): { journalOptions: SelectOptions; expenseOptions: SelectOptions; payableOptions: SelectOptions } {
  const journalOptions = accountJournalRowsToSelectOptions(
    journals.filter((row) => journalTypeTag(row) === 'Purchase' && row.active !== false),
  );
  const expenseOptions = accountAccountRowsToSelectOptions(
    accounts.filter((row) => accountInternalGroupTag(row) === 'expense'),
  );
  const payableOptions = accountAccountRowsToSelectOptions(
    accounts.filter((row) => accountInternalTypeTag(row) === 'payable'),
  );
  const none = (key: string): SelectOptions => [{ value: '', label: t(key), disabled: true }];
  return {
    journalOptions: journalOptions.length > 0 ? journalOptions : none('purchasing.forms.createBillFromOrder.noJournals'),
    expenseOptions: expenseOptions.length > 0 ? expenseOptions : none('purchasing.forms.createBillFromOrder.noAccounts'),
    payableOptions:
      payableOptions.length > 0 ? payableOptions : none('purchasing.forms.createBillFromOrder.noPayableAccounts'),
  };
}

/** The vendor bill form with its account choices. */
export function useBillFormConfig(organizationId: number) {
  const { t } = useTranslation();
  const { orgId } = orgBigInts(organizationId);
  const { data: accountJournals = [] } = useAccountJournals(orgId);
  const { data: accountAccounts = [] } = useAccountAccounts(orgId);

  return useMemo(() => {
    const { journalOptions, expenseOptions, payableOptions } = billLookupOptions(
      t,
      accountJournals as Row[],
      accountAccounts as Row[],
    );
    return mergeSelectOptionsForFields(createBillFromPurchaseOrderForm(t), {
      journalId: journalOptions,
      defaultExpenseAccountId: expenseOptions,
      payableAccountId: payableOptions,
    });
  }, [t, accountJournals, accountAccounts]);
}

interface CreateBillDialogProps {
  order: Row;
  organizationId: number;
  workflow: PurchasingWorkflow;
  onClose: () => void;
}

/** Collects the journal and accounts, then creates the draft vendor bill for a confirmed order. */
export function CreateBillFromPurchaseOrderDialog({
  order,
  organizationId,
  workflow,
  onClose,
}: CreateBillDialogProps) {
  const { t } = useTranslation();
  const { currentUser } = useRBAC();
  const formConfig = useBillFormConfig(organizationId);
  const [error, setError] = useState<string | null>(null);

  return (
    <RuntimeFormModal
      key={`bill-order-${String(order.id)}`}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      staticConfig={formConfig}
      moduleId="purchasing"
      formId="create-bill-from-purchase-order"
      organizationId={organizationId}
      roleId={currentUser?.roles[0]}
      preferStdbVisibility
      foldCustomFieldsIntoMetadata={false}
      closeOnSubmit={false}
      submitError={error}
      isPending={workflow.isPending}
      onSubmit={async (formData) => {
        setError(null);
        const partnerId = order.partnerId != null ? BigInt(String(order.partnerId)) : undefined;
        const params = toCreateBillFromPurchaseOrderParams(formData, { partnerId });
        if (!params) {
          setError(t('common.validation.required'));
          return;
        }
        try {
          await workflow.createBill.execute({ orderId: String(order.id), params }, { navigateToNext: true });
          onClose();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }}
    />
  );
}

type Translate = Parameters<typeof editPurchaseOrderForm>[0];

/**
 * The edit-header, add-line, edit-line and receive-goods forms with their lookups, built the same
 * way for the list's quick-action modal and the order page's dialogs.
 */
export const purchaseOrderFormConfigs = {
  editHeader: (
    t: Translate,
    lookups: { orderOptions: SelectOptions; vendorOptions: SelectOptions; paymentTerms: Row[] },
  ): FormConfig =>
    mergeSelectOptionsForFields(editPurchaseOrderForm(t), {
      orderId: lookups.orderOptions,
      partnerId: lookups.vendorOptions,
      paymentTermId: [
        { value: '', label: '—' },
        ...lookups.paymentTerms.map((term) => ({ value: String(term.id), label: String(term.name ?? term.id) })),
      ],
    }),
  addLine: (
    t: Translate,
    lookups: { orderOptions: SelectOptions; productOptions: SelectOptions; uomOptions: SelectOptions },
  ): FormConfig =>
    mergeSelectOptionsForFields(addPurchaseOrderLineForm(t), {
      orderId: lookups.orderOptions,
      productId: lookups.productOptions,
      uomId: lookups.uomOptions,
    }),
  editLine: (
    t: Translate,
    lookups: { lineOptions: SelectOptions; productOptions: SelectOptions; uomOptions: SelectOptions },
  ): FormConfig =>
    mergeSelectOptionsForFields(editPurchaseOrderLineForm(t), {
      lineId: lookups.lineOptions,
      productId: lookups.productOptions,
      uomId: lookups.uomOptions,
    }),
  receive: (t: Translate, lookups: { lineOptions: SelectOptions }): FormConfig =>
    mergeSelectOptionsForFields(receivePurchaseOrderLineForm(t), { lineId: lookups.lineOptions }),
  invoiceLine: (t: Translate, lookups: { lineOptions: SelectOptions }): FormConfig =>
    mergeSelectOptionsForFields(invoicePurchaseOrderLineForm(t), { lineId: lookups.lineOptions }),
};

export type PurchaseOrderDialogKind = 'header' | 'addLine' | 'editLine' | 'receive' | 'invoiceLine';

interface PurchaseOrderFormDialogProps {
  kind: PurchaseOrderDialogKind;
  order: Row;
  /** This order's lines. */
  lines: Row[];
  /** The line an edit or receive was started from; the form opens with it selected. */
  line?: Row;
  organizationId: number;
  operatingCompanyId: bigint;
  workflow: PurchasingWorkflow;
  onClose: () => void;
}

/** The order page's header, line and receive-goods forms, scoped to one order. */
export function PurchaseOrderFormDialog({
  kind,
  order,
  lines,
  line,
  organizationId,
  operatingCompanyId,
  workflow,
  onClose,
}: PurchaseOrderFormDialogProps) {
  const { t } = useTranslation();
  const { currentUser } = useRBAC();
  const { orgId } = orgBigInts(organizationId);
  const { data: contacts = [] } = useContacts(orgId);
  const { data: paymentTerms = [] } = useAccountPaymentTerms(orgId);
  const { data: products = [] } = useProducts(orgId);
  const { data: uoms = [] } = useUoms(orgId);
  const updateOrder = useUpdatePurchaseOrder(orgId, operatingCompanyId > 0n ? operatingCompanyId : undefined);
  const addLine = useAddPurchaseOrderLine(orgId);
  const updateLine = useUpdatePurchaseOrderLine(orgId);
  const invoiceLine = useInvoicePurchaseOrderLine(orgId);
  const [error, setError] = useState<string | null>(null);

  const config = useMemo((): FormConfig => {
    const orderOptions = purchaseOrderRowsToSelectOptions([order]);
    const productOptions = productRowsToSelectOptions(products);
    const uomOptions = uomRowsToSelectOptions(uoms);
    const productLabel = new Map(
      (products as Row[]).map((p) => [String(p.id), String(p.displayName ?? p.name ?? p.defaultCode ?? p.id)]),
    );
    const label = (id: string) => productLabel.get(id) ?? `Product ${id}`;
    const none = (key: string, defaultValue: string): SelectOptions => [
      { value: '', label: t(key, { defaultValue }), disabled: true },
    ];
    const products_ = productOptions.length > 0 ? productOptions : none('common.lookup.noProducts', 'No products');
    const uoms_ = uomOptions.length > 0 ? uomOptions : none('common.lookup.noUoms', 'No units of measure');

    if (kind === 'header') {
      const vendors = contactRowsToVendorSelectOptions(contacts);
      return mergeFieldDefaultValues(
        purchaseOrderFormConfigs.editHeader(t, {
          orderOptions,
          vendorOptions: vendors.length > 0 ? vendors : none('common.lookup.noVendors', 'No vendors'),
          paymentTerms: paymentTerms as Row[],
        }),
        purchaseOrderHeaderDefaults(order),
      );
    }
    if (kind === 'addLine') {
      return mergeFieldDefaultValues(
        purchaseOrderFormConfigs.addLine(t, { orderOptions, productOptions: products_, uomOptions: uoms_ }),
        { orderId: String(order.id) },
      );
    }
    if (kind === 'editLine') {
      const lineOptions = lines
        .filter((row) => enumTag(row.state) === 'Draft')
        .map((row) => ({ value: String(row.id), label: `${label(String(row.productId ?? ''))} (#${String(row.id)})` }));
      return mergeFieldDefaultValues(
        purchaseOrderFormConfigs.editLine(t, { lineOptions, productOptions: products_, uomOptions: uoms_ }),
        line ? purchaseOrderLineEditDefaults(line) : {},
      );
    }
    if (kind === 'invoiceLine') {
      return mergeFieldDefaultValues(
        purchaseOrderFormConfigs.invoiceLine(t, {
          lineOptions: purchaseOrderLineRowsToInvoiceOptions(lines, label),
        }),
        line ? { lineId: String(line.id) } : {},
      );
    }
    return mergeFieldDefaultValues(
      purchaseOrderFormConfigs.receive(t, {
        lineOptions: purchaseOrderLineRowsToReceiveOptions(lines, label),
      }),
      line ? { lineId: String(line.id) } : {},
    );
  }, [kind, order, lines, line, t, contacts, paymentTerms, products, uoms]);

  const submit = async (formData: Record<string, unknown>) => {
    setError(null);
    const required = () => {
      setError(t('common.validation.required'));
    };
    try {
      if (kind === 'header') {
        const args = toUpdatePurchaseOrderHeaderArgs(formData);
        if (!args) return required();
        await updateOrder.mutateAsync({ orderId: args.orderId, params: args.params });
      } else if (kind === 'addLine') {
        const params = toAddPurchaseOrderLineParams(formData);
        if (!params) return required();
        await addLine.mutateAsync({ orderId: String(order.id), params });
      } else if (kind === 'editLine') {
        const params = toUpdatePurchaseOrderLineParams(formData);
        if (!params) return required();
        await updateLine.mutateAsync({ lineId: String(formData.lineId), params });
      } else if (kind === 'invoiceLine') {
        const args = toInvoicePoLineArgs(formData);
        if (!args) return required();
        await invoiceLine.mutateAsync(args);
      } else {
        const input = toReceiveLineInput(toReceivePoLineArgs(formData));
        if (!input) return required();
        // The workflow reports its own failure as a toast.
        await workflow.receiveLine.execute(input, { navigateToNext: true });
      }
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (kind !== 'receive') showWorkflowToast({ kind: 'error', title: message });
      setError(message);
    }
  };

  return (
    <RuntimeFormModal
      key={`po-form-${kind}-${String(order.id)}-${line ? String(line.id) : ''}`}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      staticConfig={config}
      moduleId="purchasing"
      organizationId={organizationId}
      roleId={currentUser?.roles[0]}
      preferStdbVisibility
      closeOnSubmit={false}
      submitError={error}
      isPending={updateOrder.isPending || addLine.isPending || updateLine.isPending || invoiceLine.isPending || workflow.isPending}
      onSubmit={submit}
    />
  );
}

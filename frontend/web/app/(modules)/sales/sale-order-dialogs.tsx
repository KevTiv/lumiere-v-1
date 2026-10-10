'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from '@lumiere/i18n';
import {
  RuntimeFormModal,
  createInvoiceFromSaleOrderForm,
  editSaleOrderForm,
  mergeFieldDefaultValues,
  mergeSelectOptionsForFields,
  useRBAC,
} from '@lumiere/ui';
import { useAccountAccounts, useAccountJournals } from '@lumiere/query-hooks/hooks/accounting';
import type { useSaleOrderWorkflow } from '@lumiere/query-hooks/hooks/sales-order-workflow';
import {
  accountAccountRowsToSelectOptions,
  accountJournalRowsToSelectOptions,
} from '@/lib/form-lookup';
import {
  customFieldEntriesFromMetadata,
  persistCustomFieldsToEav,
} from '@/lib/persist-record-custom-fields';
import { toCreateInvoiceFromSaleOrderParams } from '@/lib/sales-create-params';
import { orgBigInts } from '@/lib/org-scoped';
import {
  mergeCommissionRateIntoMetadata,
  parseCommissionRatePercent,
} from './sales-ops-panel';

type SaleOrderWorkflow = ReturnType<typeof useSaleOrderWorkflow>;
type OrderRow = Record<string, unknown>;

interface SaleOrderDialogProps {
  order: OrderRow;
  organizationId: number;
  workflow: SaleOrderWorkflow;
  onClose: () => void;
}

/**
 * The invoice form (journal, income and receivable accounts) with its account choices. Shared by
 * creating an invoice from an order and a credit note from a return, which collect the same fields.
 */
export function useInvoiceFormConfig(organizationId: number) {
  const { t } = useTranslation();
  const { orgId } = orgBigInts(organizationId);
  const { data: accountJournals = [] } = useAccountJournals(orgId);
  const { data: accountAccounts = [] } = useAccountAccounts(orgId);

  return useMemo(() => {
    const journalOptions = accountJournalRowsToSelectOptions(accountJournals);
    const incomeOptions = accountAccountRowsToSelectOptions(
      accountAccounts as Record<string, unknown>[],
    );
    const receivableOptions = accountAccountRowsToSelectOptions(
      (accountAccounts as Record<string, unknown>[]).filter((row) => {
        const value = row.internalType ?? row.internal_type;
        const tag =
          value != null && typeof value === 'object' && 'tag' in value
            ? String((value as { tag: string }).tag).toLowerCase()
            : String(value ?? '').toLowerCase();
        return tag === 'receivable';
      }),
    );
    return mergeSelectOptionsForFields(createInvoiceFromSaleOrderForm(t), {
      journalId:
        journalOptions.length > 0
          ? journalOptions
          : [{ value: '', label: t('common.lookup.noJournals'), disabled: true }],
      defaultIncomeAccountId:
        incomeOptions.length > 0
          ? incomeOptions
          : [{ value: '', label: t('sales.forms.createInvoiceFromOrder.noAccounts'), disabled: true }],
      receivableAccountId:
        receivableOptions.length > 0
          ? receivableOptions
          : [
              {
                value: '',
                label: t('sales.forms.createInvoiceFromOrder.noReceivableAccounts'),
                disabled: true,
              },
            ],
    });
  }, [t, accountJournals, accountAccounts]);
}

/** Collects the journal and accounts, then creates the draft invoice for a confirmed order. */
export function CreateInvoiceFromOrderDialog({
  order,
  organizationId,
  workflow,
  onClose,
}: SaleOrderDialogProps) {
  const { t } = useTranslation();
  const { currentUser } = useRBAC();
  const formConfig = useInvoiceFormConfig(organizationId);
  const [error, setError] = useState<string | null>(null);

  return (
    <RuntimeFormModal
      key={`invoice-order-${String(order.id)}`}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      staticConfig={formConfig}
      moduleId="sales"
      formId="create-invoice-from-sale-order"
      organizationId={organizationId}
      roleId={currentUser?.roles[0]}
      preferStdbVisibility
      foldCustomFieldsIntoMetadata={false}
      closeOnSubmit={false}
      submitError={error}
      isPending={workflow.isPending}
      onSubmit={async (formData) => {
        setError(null);
        const partnerInvoiceId =
          order.partnerInvoiceId != null ? BigInt(String(order.partnerInvoiceId)) : undefined;
        const params = toCreateInvoiceFromSaleOrderParams(formData, { partnerInvoiceId });
        if (!params) {
          setError(t('common.validation.required'));
          return;
        }
        try {
          await workflow.createInvoice.execute(
            { orderId: String(order.id), params },
            { navigateToNext: true },
          );
          onClose();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }}
    />
  );
}

/** Edits an unlocked quotation's reference, note, incoterm and commission rate. */
export function EditSaleOrderDialog({
  order,
  organizationId,
  workflow,
  onClose,
  operatingCompanyId,
}: SaleOrderDialogProps & { operatingCompanyId: bigint }) {
  const { t } = useTranslation();
  const { currentUser } = useRBAC();
  const [error, setError] = useState<string | null>(null);

  return (
    <RuntimeFormModal
      key={`edit-sale-order-${String(order.id)}`}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      staticConfig={editSaleOrderForm(t)}
      moduleId="sales"
      formId="edit-sale-order"
      organizationId={organizationId}
      roleId={currentUser?.roles[0]}
      preferStdbVisibility
      transformConfig={(cfg) =>
        mergeFieldDefaultValues(cfg, {
          clientOrderRef: String(order.clientOrderRef ?? order.client_order_ref ?? ''),
          note: String(order.note ?? ''),
          incoterm: String(order.incoterm ?? ''),
          incotermLocation: String(order.incotermLocation ?? order.incoterm_location ?? ''),
          commissionRatePercent: parseCommissionRatePercent(order) || '',
        })
      }
      closeOnSubmit={false}
      submitError={error}
      isPending={workflow.isPending}
      onSubmit={async (formData) => {
        setError(null);
        const id = order.id;
        if (id == null) return;
        try {
          const rateRaw = formData.commissionRatePercent;
          const rate = rateRaw === '' || rateRaw == null ? null : Number(rateRaw);
          const metadata = mergeCommissionRateIntoMetadata(
            order.metadata,
            rate != null && Number.isFinite(rate) ? rate : null,
          );
          let mergedMeta = metadata;
          try {
            const customRaw = formData.metadata;
            const customObj =
              typeof customRaw === 'string'
                ? (JSON.parse(customRaw) as Record<string, unknown>)
                : customRaw != null && typeof customRaw === 'object'
                  ? (customRaw as Record<string, unknown>)
                  : null;
            const baseObj = metadata ? (JSON.parse(metadata) as Record<string, unknown>) : {};
            if (customObj) mergedMeta = JSON.stringify({ ...baseObj, ...customObj });
          } catch {
            mergedMeta = metadata;
          }
          await workflow.update.execute({
            orderId: String(id),
            params: {
              clientOrderRef:
                typeof formData.clientOrderRef === 'string' ? formData.clientOrderRef : undefined,
              note: typeof formData.note === 'string' ? formData.note : undefined,
              incoterm: typeof formData.incoterm === 'string' ? formData.incoterm : undefined,
              incotermLocation:
                typeof formData.incotermLocation === 'string'
                  ? formData.incotermLocation
                  : undefined,
              metadata: mergedMeta,
            },
          });
          if (
            operatingCompanyId &&
            operatingCompanyId !== 0n &&
            customFieldEntriesFromMetadata(mergedMeta).length > 0
          ) {
            await persistCustomFieldsToEav({
              organizationId,
              companyId: operatingCompanyId,
              model: 'sale_order',
              recordId: BigInt(String(id)),
              metadata: mergedMeta,
            });
          }
          onClose();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }}
    />
  );
}

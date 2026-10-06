'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from '@lumiere/i18n';
import {
  RuntimeFormModal,
  createBillFromPurchaseOrderForm,
  mergeSelectOptionsForFields,
  useRBAC,
} from '@lumiere/ui';
import { useAccountAccounts, useAccountJournals } from '@lumiere/query-hooks/hooks/accounting';
import type { usePurchasingWorkflow } from '@lumiere/query-hooks/hooks/purchasing-workflow';
import {
  accountAccountRowsToSelectOptions,
  accountJournalRowsToSelectOptions,
} from '@/lib/form-lookup';
import { orgBigInts } from '@/lib/org-scoped';
import { toCreateBillFromPurchaseOrderParams } from '@/lib/purchasing-create-params';

type PurchasingWorkflow = ReturnType<typeof usePurchasingWorkflow>;
type Row = Record<string, unknown>;

/** Lower-cased tag of an enum cell (`{ tag }`) or plain value. */
function enumTag(value: unknown): string {
  if (value != null && typeof value === 'object' && 'tag' in value) return String((value as { tag: string }).tag);
  return String(value ?? '');
}

export const journalTypeTag = (row: { type?: unknown; type_?: unknown }): string => enumTag(row.type_ ?? row.type);
export const accountInternalTypeTag = (row: Row): string =>
  enumTag(row.internalType ?? row.internal_type).toLowerCase();
export const accountInternalGroupTag = (row: Row): string =>
  enumTag(row.internalGroup ?? row.internal_group).toLowerCase();

/** The vendor bill form (purchase journal, expense and payable accounts) with its account choices. */
export function useBillFormConfig(organizationId: number) {
  const { t } = useTranslation();
  const { orgId } = orgBigInts(organizationId);
  const { data: accountJournals = [] } = useAccountJournals(orgId);
  const { data: accountAccounts = [] } = useAccountAccounts(orgId);

  return useMemo(() => {
    const accounts = accountAccounts as Row[];
    const journalOptions = accountJournalRowsToSelectOptions(
      (accountJournals as Row[]).filter((row) => journalTypeTag(row) === 'Purchase' && row.active !== false),
    );
    const expenseOptions = accountAccountRowsToSelectOptions(
      accounts.filter((row) => accountInternalGroupTag(row) === 'expense'),
    );
    const payableOptions = accountAccountRowsToSelectOptions(
      accounts.filter((row) => accountInternalTypeTag(row) === 'payable'),
    );
    const none = (key: string) => [{ value: '', label: t(key), disabled: true }];
    return mergeSelectOptionsForFields(createBillFromPurchaseOrderForm(t), {
      journalId: journalOptions.length > 0 ? journalOptions : none('purchasing.forms.createBillFromOrder.noJournals'),
      defaultExpenseAccountId:
        expenseOptions.length > 0 ? expenseOptions : none('purchasing.forms.createBillFromOrder.noAccounts'),
      payableAccountId:
        payableOptions.length > 0 ? payableOptions : none('purchasing.forms.createBillFromOrder.noPayableAccounts'),
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

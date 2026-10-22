'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  FormModal,
  mergeFieldDefaultValues,
  mergeSelectOptionsForFields,
  postExpenseReportForm,
  projectRebillExpenseReportForm,
  reimburseExpenseReportForm,
} from '@lumiere/ui';
import type { FormConfig } from '@lumiere/ui';
import type { FormValues } from '@lumiere/ui/lib/form-types';
import { useTranslation } from '@lumiere/i18n';
import {
  useCreateExpenseProjectRebill,
  useCreateExpenseReimbursementPayment,
  usePostExpenseSheet,
} from '@lumiere/query-hooks/hooks/expenses';
import { useAccountAccounts, useAccountJournals } from '@lumiere/query-hooks/hooks/accounting';
import { accountAccountRowsToSelectOptions, accountJournalRowsToSelectOptions } from '../../../lib/form-lookup';
import {
  buildPostParams,
  buildReimburseParams,
  buildRebillParams,
  sheetIdOf,
  type FinanceKind,
} from './expense-report-finance';

type Row = Record<string, unknown>;

/**
 * Post / reimburse / rebill dialogs for an expense report, shared by the list and the report page.
 * Render `modal` once and call `open(kind, row)`.
 */
export function useExpenseReportFinance(orgId: bigint, operatingCompanyId: bigint) {
  const { t } = useTranslation();
  const [active, setActive] = useState<{ kind: FinanceKind; row: Row } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: accountJournals = [] } = useAccountJournals(orgId);
  const { data: accountAccounts = [] } = useAccountAccounts(orgId);
  const post = usePostExpenseSheet(orgId, operatingCompanyId);
  const reimburse = useCreateExpenseReimbursementPayment(orgId, operatingCompanyId);
  const rebill = useCreateExpenseProjectRebill(orgId);

  const journalOptions = useMemo(() => {
    const fromApi = accountJournalRowsToSelectOptions(accountJournals);
    return fromApi.length > 0 ? fromApi : [{ value: '', label: t('common.lookup.noJournals'), disabled: true }];
  }, [accountJournals, t]);
  const accountOptions = useMemo(() => {
    const fromApi = accountAccountRowsToSelectOptions(accountAccounts);
    return fromApi.length > 0 ? fromApi : [{ value: '', label: t('common.lookup.noAccounts'), disabled: true }];
  }, [accountAccounts, t]);

  const config: FormConfig | null = useMemo(() => {
    if (!active) return null;
    const today = new Date().toISOString().slice(0, 10);
    if (active.kind === 'postReport') {
      return mergeFieldDefaultValues(
        mergeSelectOptionsForFields(postExpenseReportForm(t), {
          journalId: journalOptions,
          defaultExpenseAccountId: accountOptions,
          payableAccountId: accountOptions,
          defaultTaxAccountId: accountOptions,
          cardLiabilityAccountId: accountOptions,
          advanceAccountId: accountOptions,
          fxFeeAccountId: accountOptions,
        }),
        { accountingDate: today },
      );
    }
    if (active.kind === 'reimburseReport') {
      return mergeFieldDefaultValues(
        mergeSelectOptionsForFields(reimburseExpenseReportForm(t), {
          journalId: journalOptions,
          payableAccountId: accountOptions,
          liquidityAccountId: accountOptions,
        }),
        { paymentDate: today },
      );
    }
    return mergeFieldDefaultValues(
      mergeSelectOptionsForFields(projectRebillExpenseReportForm(t), {
        journalId: journalOptions,
        receivableAccountId: accountOptions,
        incomeAccountId: accountOptions,
      }),
      { invoiceDate: today },
    );
  }, [active, t, journalOptions, accountOptions]);

  const isPending = post.isPending || reimburse.isPending || rebill.isPending;

  const submit = async (formData: FormValues) => {
    if (!active) return;
    setSubmitError(null);
    const sheetId = sheetIdOf(active.row);
    try {
      if (active.kind === 'postReport') {
        const args = buildPostParams(sheetId, formData);
        if (!args) throw new Error(t('expenses.forms.capture.financeRequired', { defaultValue: 'Complete the required date, journal, and account fields.' }));
        await post.mutateAsync(args);
      } else if (active.kind === 'reimburseReport') {
        const args = buildReimburseParams(sheetId, formData);
        if (!args) throw new Error(t('expenses.forms.capture.financeRequired', { defaultValue: 'Complete the required date, journal, and account fields.' }));
        await reimburse.mutateAsync(args);
      } else {
        const args = buildRebillParams(sheetId, formData);
        if (!args) throw new Error(t('expenses.forms.capture.financeRequired', { defaultValue: 'Complete the required date, journal, and account fields.' }));
        await rebill.mutateAsync(args);
      }
      setActive(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('expenses.workflow.financeFailed', { defaultValue: 'Expense report action failed' });
      setSubmitError(message);
      throw error instanceof Error ? error : new Error(message);
    }
  };

  const open = useCallback((kind: FinanceKind, row: Row) => {
    setSubmitError(null);
    setActive({ kind, row });
  }, []);

  const modal =
    active && config ? (
      <FormModal
        key={`${active.kind}-${sheetIdOf(active.row)}`}
        open
        onOpenChange={(next) => !next && setActive(null)}
        config={config}
        isPending={isPending}
        closeOnSubmit={false}
        showSubmitSuccessToast={false}
        submitError={submitError}
        onSubmit={submit}
      />
    ) : null;

  return { open, modal, isPending };
}

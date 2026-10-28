'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  FormModal,
  mergeFieldDefaultValues,
  mergeSelectOptionsForFields,
  postExpenseReportForm,
  projectRebillExpenseReportForm,
  reimburseExpenseReportForm,
} from '@lumiere/ui';
import type { FormConfig } from '@lumiere/ui';
import type { FormValues } from '@lumiere/ui/lib/form-types';
import { moduleQueryState } from '@lumiere/ui/lib/module-data-state';
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
export function useExpenseReportFinance(orgId: bigint, operatingCompanyId: bigint, enabled = true) {
  const { t } = useTranslation();
  const [active, setActive] = useState<{ kind: FinanceKind; row: Row } | null>(null);
  // A denied or failed expense-report read closes the dialog instead of acting on stale rows.
  useEffect(() => {
    if (!enabled) setActive(null);
  }, [enabled]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const journalQuery = useAccountJournals(orgId);
  const accountQuery = useAccountAccounts(orgId);
  const journalState = moduleQueryState(journalQuery);
  const accountState = moduleQueryState(accountQuery);
  const lookupsReady = journalState.status === 'ready' && accountState.status === 'ready';
  const accountJournals = useMemo(() => journalState.status === 'ready' ? journalQuery.data ?? [] : [], [journalState.status, journalQuery.data]);
  const accountAccounts = useMemo(() => accountState.status === 'ready' ? accountQuery.data ?? [] : [], [accountState.status, accountQuery.data]);
  const lookupDenied = journalState.status === 'denied' || accountState.status === 'denied';
  const lookupLoading = journalState.status === 'loading' || accountState.status === 'loading';
  const lookupError = lookupsReady ? null : lookupDenied
    ? t('expenses.forms.capture.financeSourcesDenied', { defaultValue: 'You do not have access to the journals or accounts needed for this action. Ask your administrator to check your access.' })
    : lookupLoading ? t('expenses.forms.capture.financeSourcesLoading', { defaultValue: 'Loading journals and accounts. Your entries are retained.' })
      : t('expenses.forms.capture.financeSourcesRequired', { defaultValue: 'Journals or accounts could not be loaded. Retry the lookup before continuing. Your entries are retained.' });
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
    if (!active) throw new Error(t('common.recordsUnavailable'));
    if (!enabled) throw new Error(t('common.recordsUnavailable', { defaultValue: 'Records could not be loaded.' }));
    if (!lookupsReady) throw new Error(lookupError!);
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
    if (!enabled) return;
    setSubmitError(null);
    setActive({ kind, row });
  }, [enabled]);

  const modal =
    enabled && active && config ? (
      <FormModal
        key={`${active.kind}-${sheetIdOf(active.row)}`}
        open
        onOpenChange={(next) => !next && setActive(null)}
        config={config}
        isPending={isPending}
        closeOnSubmit={false}
        showSubmitSuccessToast={false}
        submissionDisabled={!lookupsReady}
        submitError={lookupError ?? submitError}
        formLeadingActions={!lookupsReady && !lookupDenied ? (
          <Button type="button" variant="outline" disabled={journalQuery.isFetching || accountQuery.isFetching} onClick={() => { void journalQuery.refetch(); void accountQuery.refetch(); }}>
            {t('common.retry')}
          </Button>
        ) : undefined}
        onSubmit={submit}
      />
    ) : null;

  return { open, modal, isPending };
}

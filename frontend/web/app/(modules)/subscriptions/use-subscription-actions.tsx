"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  FormModal,
  closeSubscriptionForm,
  generateSubscriptionInvoiceForm,
  paySubscriptionInvoiceForm,
  amendSubscriptionForm,
  renewSubscriptionForm,
  cancelSubscriptionForm,
  ingestSubscriptionUsageEventForm,
  setSubscriptionCommitmentForm,
  mergeSelectOptionsForFields,
} from "@lumiere/ui"
import { showWorkflowToast } from "@lumiere/ui/lib/workflow-toast"
import {
  useSubscriptions,
  useSubscriptionBillingRuns,
  useSubscriptionLines,
  useSubscriptionPlans,
  useActivateSubscription,
  useCloseSubscription,
  useGenerateSubscriptionInvoice,
  usePaySubscriptionInvoice,
  useAmendSubscription,
  usePauseSubscription,
  useResumeSubscription,
  useRenewSubscription,
  useCancelSubscription,
  useIngestSubscriptionUsageEvent,
  useRateSubscriptionUsageEvents,
  useSetSubscriptionCommitment,
  useAdvanceSubscriptionDunning,
  useRecordSubscriptionPaymentFailure,
  useRefreshSubscriptionExceptionFlags,
} from "@lumiere/query-hooks/hooks/subscriptions"
import { useAccountJournals, useAccountAccounts, useAccountMoves } from "@lumiere/query-hooks/hooks/accounting"
import {
  buildCloseSubscriptionParams,
  buildGenerateSubscriptionInvoiceParams,
  buildPaySubscriptionInvoiceParams,
  buildAmendSubscriptionParams,
  buildRenewSubscriptionParams,
  buildCancelSubscriptionParams,
  buildIngestSubscriptionUsageEventParams,
  buildSetSubscriptionCommitmentParams,
} from "@/lib/subscriptions-revenue-params"
import { accountJournalRowsToSelectOptions, accountAccountRowsToSelectOptions, accountMoveRowsToSelectOptions, paymentJournalRowsToSelectOptions } from "@/lib/form-lookup"
import { type SubscriptionActionId, isSubscriptionActionApplicableOnPage } from "./subscription-actions"
import type { FormConfig, FormValues } from '@lumiere/ui/lib/form-types'
import { Button } from '@lumiere/ui/components/button'
import { useRBAC } from '@lumiere/ui'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useCurrencies } from '@lumiere/query-hooks/hooks/settings'
import { mergeModuleStates, moduleQueryState } from '@lumiere/ui/lib/module-data-state'
import { inSubscriptionScope, subscriptionInvoices, invoiceOutstanding, workflowTag, subscriptionActionPermissions } from './subscription-workflow'
import { subscriptionStateOf } from './subscription-status'
import { SubscriptionActionPreview } from './subscription-action-preview'

export type SubscriptionDialogAction = SubscriptionActionId;
export function isSubscriptionDialogAction(id: string): id is SubscriptionDialogAction {
  return ['activate', 'pause', 'resume', 'close', 'generate-invoice', 'pay-invoice', 'amend', 'renew', 'cancel', 'ingest-usage', 'rate-usage', 'set-commitment', 'record-failure', 'advance-dunning', 'refresh-flags'].includes(id);
}

/**
 * The subscription form dialogs and reducer calls shared by the list's row actions and the
 * subscription record page. `dialogs` must be rendered once by the caller.
 */
export function useSubscriptionActions(orgId: bigint, operatingCompanyId: bigint, enabled = true) {
  const { t } = useTranslation()
  const router = useRouter()
  const { checkPermission, permissionsReady } = useRBAC()
  const [target, setTarget] = useState<{ action: SubscriptionActionId; id: bigint } | null>(null)
  const close = () => setTarget(null)
  useEffect(() => { setTarget(null) }, [orgId, operatingCompanyId, enabled])
  const subscriptionsQuery = useSubscriptions(orgId)
  const runsQuery = useSubscriptionBillingRuns(orgId)
  const linesQuery = useSubscriptionLines(orgId)
  const plansQuery = useSubscriptionPlans(orgId)
  const journalsQuery = useAccountJournals(orgId)
  const accountsQuery = useAccountAccounts(orgId)
  const movesQuery = useAccountMoves(orgId)
  const { data: currencies = [] } = useCurrencies()
  const scope = { organizationId: orgId, companyId: operatingCompanyId }
  const subscription = (subscriptionsQuery.data ?? []).find((row) => String(row.id) === String(target?.id) && inSubscriptionScope(row, scope))
  const journals = (journalsQuery.data ?? []).filter((row) => inSubscriptionScope(row, scope) && row.active === true)
  const accounts = (accountsQuery.data ?? []).filter((row) => inSubscriptionScope(row, scope) && row.deprecated === false)
  const invoices = subscription ? subscriptionInvoices(subscription, runsQuery.data ?? [], movesQuery.data ?? [], scope) : []
  const lines = (linesQuery.data ?? []).filter((row) => inSubscriptionScope(row, scope) && String(row.subscriptionId) === String(target?.id))
  const action = target?.action ?? 'activate'
  const permitted = permissionsReady !== false && subscriptionActionPermissions(action).every(([resource, verb]) => checkPermission(resource, verb).allowed)
  const sources = [subscriptionsQuery]
  const needsAccounting = ['generate-invoice', 'pay-invoice', 'amend'].includes(action)
  const needsInvoices = ['pay-invoice', 'cancel'].includes(action)
  const sourceState = mergeModuleStates([
    ...sources.map(moduleQueryState),
    ...(needsAccounting ? [moduleQueryState(journalsQuery), moduleQueryState(accountsQuery)] : []),
    ...(needsInvoices ? [moduleQueryState(runsQuery), moduleQueryState(movesQuery)] : []),
    ...(['activate', 'amend'].includes(action) ? [moduleQueryState(linesQuery)] : []),
  ])
  const usable = enabled && permitted && subscription != null && sourceState.status === 'ready'
    && isSubscriptionActionApplicableOnPage(action, subscriptionStateOf(subscription))
  const openDialog = useCallback((nextAction: SubscriptionDialogAction, subscriptionId: number | bigint) => {
    if (enabled) setTarget({ action: nextAction, id: BigInt(subscriptionId) })
  }, [enabled])

  const activate = useActivateSubscription(orgId, operatingCompanyId)
  const closeSubscription = useCloseSubscription(orgId, operatingCompanyId)
  const generateInvoice = useGenerateSubscriptionInvoice(orgId, operatingCompanyId)
  const payInvoice = usePaySubscriptionInvoice(orgId, operatingCompanyId)
  const amend = useAmendSubscription(orgId, operatingCompanyId)
  const pause = usePauseSubscription(orgId, operatingCompanyId)
  const resume = useResumeSubscription(orgId, operatingCompanyId)
  const renew = useRenewSubscription(orgId, operatingCompanyId)
  const cancel = useCancelSubscription(orgId, operatingCompanyId)
  const ingestUsage = useIngestSubscriptionUsageEvent(orgId, operatingCompanyId)
  const rateUsage = useRateSubscriptionUsageEvents(orgId, operatingCompanyId)
  const setCommitment = useSetSubscriptionCommitment(orgId, operatingCompanyId)
  const advanceDunning = useAdvanceSubscriptionDunning(orgId, operatingCompanyId)
  const recordFailure = useRecordSubscriptionPaymentFailure(orgId, operatingCompanyId)
  const refreshFlags = useRefreshSubscriptionExceptionFlags(orgId, operatingCompanyId)

  const pending =
    activate.isPending ||
    closeSubscription.isPending ||
    generateInvoice.isPending ||
    payInvoice.isPending ||
    amend.isPending ||
    pause.isPending ||
    resume.isPending ||
    renew.isPending ||
    cancel.isPending ||
    ingestUsage.isPending ||
    rateUsage.isPending ||
    setCommitment.isPending ||
    advanceDunning.isPending ||
    recordFailure.isPending ||
    refreshFlags.isPending

  const journalOptions = accountJournalRowsToSelectOptions(journals.filter((journal) => workflowTag(journal.type) === 'sale'))
  const paymentJournalOptions = paymentJournalRowsToSelectOptions(journals)
  const accountOptions = accountAccountRowsToSelectOptions(accounts)
  const availableInvoices = action === 'pay-invoice' ? invoices.filter((invoice) => (invoiceOutstanding(invoice) ?? 0) > 0)
    : invoices.filter((invoice) => workflowTag(invoice.state) === 'posted')
  const forms: Partial<Record<SubscriptionActionId, () => FormConfig>> = {
    close: () => closeSubscriptionForm(t), 'generate-invoice': () => generateSubscriptionInvoiceForm(t),
    'pay-invoice': () => paySubscriptionInvoiceForm(t), amend: () => amendSubscriptionForm(t),
    renew: () => renewSubscriptionForm(t), cancel: () => cancelSubscriptionForm(t),
    'ingest-usage': () => ingestSubscriptionUsageEventForm(t), 'set-commitment': () => setSubscriptionCommitmentForm(t),
  }
  const base = forms[action]?.() ?? { id: `subscription-${action}`, title: t(`subscriptions.workflow.labels.${action}`), sections: [] }
  const selectedPlan = (moduleQueryState(plansQuery).status === 'ready' ? plansQuery.data ?? [] : []).find((plan) => String(plan.id) === String(subscription?.planId) && inSubscriptionScope(plan, scope))
  const configuredJournal = journals.find((journal) => String(journal.id) === String(selectedPlan?.journalId) && workflowTag(journal.type) === 'sale')
  const config = mergeSelectOptionsForFields({
    ...base, title: t(`subscriptions.workflow.labels.${action}`), submitLabel: t(`subscriptions.workflow.labels.${action}`),
    sections: base.sections.map((section) => ({ ...section, fields: section.fields.filter((field) => action !== 'pay-invoice' || availableInvoices.some((invoice) => workflowTag(invoice.state) === 'draft') || !['cogsAccountId', 'inventoryAccountId'].includes(field.name)).map((field) => {
      if (field.name === 'invoiceMoveId') return { ...field, required: action === 'pay-invoice', defaultValue: availableInvoices.length === 1 ? String(availableInvoices[0]!.id) : '' }
      if (field.name === 'invoiceDate') return { ...field, defaultValue: new Date().toISOString().slice(0, 10) }
      if (field.name === 'journalId' && action === 'generate-invoice' && configuredJournal) return { ...field, defaultValue: String(configuredJournal.id) }
      if (field.name === 'createCreditNote') return { ...field, defaultValue: false }
      return field
    }) })),
  } as FormConfig, {
    journalId: journalOptions, paymentJournalId: paymentJournalOptions,
    incomeAccountId: accountOptions, receivableAccountId: accountOptions, bankAccountId: accountOptions,
    cogsAccountId: accountOptions, inventoryAccountId: accountOptions,
    taxAccountId: [{ value: '', label: '—' }, ...accountOptions],
    invoiceMoveId: accountMoveRowsToSelectOptions(availableInvoices),
    lineId: lines.map((line) => ({ value: String(line.id), label: String(line.name ?? line.id) })),
  })
  if (action === 'record-failure') config.sections = [{ id: 'failure', fields: [
    { id: 'reason', name: 'reason', type: 'text', label: t('subscriptions.workflow.failureReason'), required: true },
    { id: 'pastDueDays', name: 'pastDueDays', type: 'number', label: t('subscriptions.workflow.pastDueDays'), min: 0, step: 1, defaultValue: 1, required: true },
  ] }]

  const submit = async (values: FormValues) => {
    if (!usable || !target || !subscription) throw new Error(t('subscriptions.workflow.selectionChanged'))
    const subscriptionId = target.id
    switch (action) {
      case 'activate':
        if (!lines.length) throw new Error(t('subscriptions.workflow.noLines'))
        await activate.mutateAsync({ subscriptionId }); break
      case 'pause': await pause.mutateAsync({ subscriptionId }); break
      case 'resume': await resume.mutateAsync({ subscriptionId }); break
      case 'close': await closeSubscription.mutateAsync({ subscriptionId, params: buildCloseSubscriptionParams(values) }); break
      case 'generate-invoice': await generateInvoice.mutateAsync({ subscriptionId, params: buildGenerateSubscriptionInvoiceParams(values) }); break
      case 'pay-invoice': {
        const invoice = availableInvoices.find((row) => String(row.id) === String(values.invoiceMoveId))
        const outstanding = invoice ? invoiceOutstanding(invoice) : null
        const amount = values.amount === '' || values.amount == null ? outstanding : Number(values.amount)
        if (!invoice || outstanding == null || amount == null || !Number.isFinite(amount) || amount <= 0 || amount > outstanding) throw new Error(t('subscriptions.workflow.invalidPayment'))
        await payInvoice.mutateAsync({ subscriptionId, params: buildPaySubscriptionInvoiceParams(values) }); break
      }
      case 'amend':
        if (!lines.some((line) => String(line.id) === String(values.lineId))) throw new Error(t('subscriptions.workflow.selectionChanged'))
        await amend.mutateAsync({ subscriptionId, params: buildAmendSubscriptionParams(values) }); break
      case 'renew': await renew.mutateAsync({ subscriptionId, params: buildRenewSubscriptionParams(values) }); break
      case 'cancel':
        if (values.createCreditNote === true && !availableInvoices.some((invoice) => String(invoice.id) === String(values.invoiceMoveId))) throw new Error(t('subscriptions.workflow.chooseCreditInvoice'))
        await cancel.mutateAsync({ subscriptionId, params: buildCancelSubscriptionParams(values) }); break
      case 'ingest-usage': await ingestUsage.mutateAsync({ subscriptionId, params: buildIngestSubscriptionUsageEventParams(values) }); break
      case 'rate-usage': await rateUsage.mutateAsync({ subscriptionId, params: { limit: 100 } }); break
      case 'set-commitment': await setCommitment.mutateAsync({ subscriptionId, params: buildSetSubscriptionCommitmentParams(values) }); break
      case 'record-failure': await recordFailure.mutateAsync({ subscriptionId, params: { reason: String(values.reason), pastDueDays: Number(values.pastDueDays) } }); break
      case 'advance-dunning': await advanceDunning.mutateAsync({ subscriptionId, params: {} }); break
      case 'refresh-flags': await refreshFlags.mutateAsync({ subscriptionId }); break
    }
    showWorkflowToast({ kind: 'success', title: t(`subscriptions.workflow.completed.${action}`), action: {
      label: t('subscriptions.workflow.viewSubscription'), onClick: () => router.push(`/subscriptions/${subscriptionId}?tab=${['generate-invoice', 'pay-invoice'].includes(action) ? 'billing' : 'overview'}`),
    } })
  }
  const missingAccounting = usable && needsAccounting && (accounts.length === 0 || (action === 'pay-invoice' ? paymentJournalOptions.length === 0 : journalOptions.length === 0))
  const blocked = missingAccounting || !usable || (action === 'activate' && !lines.length) || (action === 'pay-invoice' && availableInvoices.length === 0)
  const retrySources = () => {
    for (const query of [subscriptionsQuery, runsQuery, linesQuery, journalsQuery, accountsQuery, movesQuery]) void query.refetch()
  }
  const dialogs: ReactNode = target && <FormModal key={`${orgId}:${operatingCompanyId}:${target.id}:${action}`}
    open onOpenChange={(open) => { if (!open) close() }} config={config} isPending={pending} submissionDisabled={blocked}
    showSubmitSuccessToast={false} draft={false}
    submitError={blocked ? t(missingAccounting ? 'subscriptions.workflow.accountingSetup' : !permitted ? 'subscriptions.workflow.source.denied' : sourceState.status !== 'ready' ? `subscriptions.workflow.source.${sourceState.status}` : action === 'activate' && !lines.length ? 'subscriptions.workflow.noLines' : action === 'pay-invoice' ? 'subscriptions.workflow.noUnpaidInvoices' : 'subscriptions.workflow.selectionChanged') : null}
    formLeadingActions={missingAccounting ? <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" render={<Link href="/accounting?tab=accounts" target="_blank" rel="noopener noreferrer" />} nativeButton={false}>{t('subscriptions.workflow.openAccounting')}</Button>
      <Button type="button" variant="outline" onClick={retrySources}>{t('common.retry')}</Button>
    </div> : sourceState.status !== 'ready' ? <Button type="button" variant="outline" onClick={retrySources}>{t('common.retry')}</Button> : undefined}
    renderPreview={(values) => usable && subscription ? <SubscriptionActionPreview action={action} subscription={subscription} values={values} invoices={availableInvoices} lines={lines} currencies={currencies} /> : null}
    onSubmit={submit} />
  return { dialogs, openDialog, pending }
}

"use client"

import { useCallback, useMemo, useState, type ReactNode } from "react"
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
import { accountJournalRowsToSelectOptions, accountAccountRowsToSelectOptions, accountMoveRowsToSelectOptions } from "@/lib/form-lookup"
import type { SubscriptionActionId } from "./subscription-actions"

/** Actions that open a form dialog before calling the reducer. */
export type SubscriptionDialogAction =
  | "close"
  | "generate-invoice"
  | "pay-invoice"
  | "amend"
  | "renew"
  | "cancel"
  | "ingest-usage"
  | "set-commitment"

/** Actions that call the reducer straight away. */
export type SubscriptionDirectAction = Exclude<SubscriptionActionId, SubscriptionDialogAction>

const DIALOG_ACTIONS: readonly string[] = [
  "close",
  "generate-invoice",
  "pay-invoice",
  "amend",
  "renew",
  "cancel",
  "ingest-usage",
  "set-commitment",
]

export function isSubscriptionDialogAction(id: string): id is SubscriptionDialogAction {
  return DIALOG_ACTIONS.includes(id)
}

/**
 * The subscription form dialogs and reducer calls shared by the list's row actions and the
 * subscription record page. `dialogs` must be rendered once by the caller.
 */
export function useSubscriptionActions(orgId: bigint, operatingCompanyId: bigint) {
  const { t } = useTranslation()
  const mutationErrorOptions = {
    onError: (error: Error) =>
      showWorkflowToast({ kind: "error", title: t("common.error.title"), description: error.message }),
  }
  const [target, setTarget] = useState<{ action: SubscriptionDialogAction; id: number } | null>(null)
  const targetFor = (action: SubscriptionDialogAction) => (target?.action === action ? target.id : null)
  const close = () => setTarget(null)

  const { data: subscriptions = [] } = useSubscriptions(orgId)
  const { data: billingRuns = [] } = useSubscriptionBillingRuns(orgId)
  const { data: subscriptionLines = [] } = useSubscriptionLines(orgId)
  const { data: journals = [] } = useAccountJournals(orgId)
  const { data: accounts = [] } = useAccountAccounts(orgId)
  const { data: accountMoves = [] } = useAccountMoves(orgId)

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

  /** Run an action that needs no extra input. Rejects with the reducer error. */
  const runDirect = useCallback(
    async (action: SubscriptionDirectAction, subscriptionId: bigint): Promise<void> => {
      switch (action) {
        case "activate":
          await activate.mutateAsync({ subscriptionId })
          return
        case "pause":
          await pause.mutateAsync({ subscriptionId })
          return
        case "resume":
          await resume.mutateAsync({ subscriptionId })
          return
        case "rate-usage":
          await rateUsage.mutateAsync({ subscriptionId, params: { limit: 100 } })
          return
        case "record-failure":
          await recordFailure.mutateAsync({ subscriptionId, params: { reason: "manual", pastDueDays: 1 } })
          return
        case "advance-dunning":
          await advanceDunning.mutateAsync({ subscriptionId, params: {} })
          return
        case "refresh-flags":
          await refreshFlags.mutateAsync({ subscriptionId })
          return
      }
    },
    [activate, pause, resume, rateUsage, recordFailure, advanceDunning, refreshFlags],
  )

  const openDialog = useCallback(
    (action: SubscriptionDialogAction, subscriptionId: number | bigint) =>
      setTarget({ action, id: Number(subscriptionId) }),
    [],
  )

  const journalFieldOptions = useMemo(() => {
    const fromApi = accountJournalRowsToSelectOptions(journals)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noJournals"), disabled: true }]
  }, [journals, t])
  const accountFieldOptions = useMemo(() => {
    const fromApi = accountAccountRowsToSelectOptions(accounts)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noAccounts"), disabled: true }]
  }, [accounts, t])

  const payTargetId = targetFor("pay-invoice")
  const amendTargetId = targetFor("amend")
  const cancelTargetId = targetFor("cancel")

  const closeForm = useMemo(() => closeSubscriptionForm(t), [t])
  const generateForm = useMemo(
    () =>
      mergeSelectOptionsForFields(generateSubscriptionInvoiceForm(t), {
        journalId: journalFieldOptions,
        incomeAccountId: accountFieldOptions,
        receivableAccountId: accountFieldOptions,
        taxAccountId: [{ value: "", label: "—" }, ...accountFieldOptions.filter((o) => o.value !== "")],
      }),
    [t, journalFieldOptions, accountFieldOptions],
  )
  const payInvoiceMoveOptions = useMemo(() => {
    if (payTargetId == null) return [{ value: "", label: "—", disabled: true }]
    const ids = new Set(
      (billingRuns as Record<string, unknown>[])
        .filter((run) => Number(run.subscriptionId ?? run.subscription_id) === payTargetId)
        .map((run) => run.invoiceMoveId ?? run.invoice_move_id)
        .filter((id) => id != null)
        .map(String),
    )
    const moves = (accountMoves as Record<string, unknown>[]).filter((move) => ids.has(String(move.id)))
    const fromApi = accountMoveRowsToSelectOptions(moves)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noAccounts"), disabled: true }]
  }, [payTargetId, billingRuns, accountMoves, t])
  const payForm = useMemo(
    () =>
      mergeSelectOptionsForFields(paySubscriptionInvoiceForm(t), {
        invoiceMoveId: payInvoiceMoveOptions,
        paymentJournalId: journalFieldOptions,
        bankAccountId: accountFieldOptions,
        receivableAccountId: accountFieldOptions,
        cogsAccountId: accountFieldOptions,
        inventoryAccountId: accountFieldOptions,
      }),
    [t, payInvoiceMoveOptions, journalFieldOptions, accountFieldOptions],
  )
  const amendLineOptions = useMemo(() => {
    if (amendTargetId == null) return [{ value: "", label: "—", disabled: true }]
    const lines = (subscriptionLines as Record<string, unknown>[]).filter(
      (l) => Number(l.subscriptionId ?? l.subscription_id) === amendTargetId,
    )
    if (lines.length === 0) return [{ value: "", label: "No lines", disabled: true }]
    return lines.map((l) => ({ value: String(l.id), label: `${l.name ?? "Line"} (#${l.id})` }))
  }, [amendTargetId, subscriptionLines])
  const amendForm = useMemo(
    () =>
      mergeSelectOptionsForFields(amendSubscriptionForm(t), {
        lineId: amendLineOptions,
        journalId: journalFieldOptions,
        incomeAccountId: accountFieldOptions,
        receivableAccountId: accountFieldOptions,
      }),
    [t, amendLineOptions, journalFieldOptions, accountFieldOptions],
  )
  const renewForm = useMemo(() => renewSubscriptionForm(t), [t])
  const cancelInvoiceOptions = useMemo(() => {
    if (cancelTargetId == null) return [{ value: "", label: "—" }]
    const sub = (subscriptions as Record<string, unknown>[]).find((s) => Number(s.id) === cancelTargetId)
    const ids = (sub?.invoiceIds ?? sub?.invoice_ids ?? []) as unknown[]
    const idSet = new Set(ids.map((id) => String(id)))
    const moves = (accountMoves as Record<string, unknown>[]).filter((m) => idSet.has(String(m.id)))
    const fromApi = accountMoveRowsToSelectOptions(moves)
    return [{ value: "", label: "—" }, ...fromApi.filter((o) => o.value !== "")]
  }, [cancelTargetId, subscriptions, accountMoves])
  const cancelForm = useMemo(
    () => mergeSelectOptionsForFields(cancelSubscriptionForm(t), { invoiceMoveId: cancelInvoiceOptions }),
    [t, cancelInvoiceOptions],
  )
  const ingestForm = useMemo(() => ingestSubscriptionUsageEventForm(t), [t])
  const commitmentForm = useMemo(() => setSubscriptionCommitmentForm(t), [t])

  const dialogs: ReactNode = (
    <>
      <FormModal
        open={targetFor("close") !== null}
        onOpenChange={(open) => !open && close()}
        config={closeForm}
        onSubmit={(formData) => {
          const id = targetFor("close")
          if (id == null) return
          closeSubscription.mutate(
            { subscriptionId: BigInt(id), params: buildCloseSubscriptionParams(formData) },
            mutationErrorOptions,
          )
          close()
        }}
      />
      <FormModal
        open={targetFor("generate-invoice") !== null}
        onOpenChange={(open) => !open && close()}
        config={generateForm}
        onSubmit={(formData) => {
          const id = targetFor("generate-invoice")
          if (id == null) return
          if (!formData.incomeAccountId || !formData.receivableAccountId) return
          generateInvoice.mutate(
            { subscriptionId: BigInt(id), params: buildGenerateSubscriptionInvoiceParams(formData) },
            mutationErrorOptions,
          )
          close()
        }}
      />
      <FormModal
        open={payTargetId !== null}
        onOpenChange={(open) => !open && close()}
        config={payForm}
        onSubmit={(formData) => {
          if (payTargetId == null) return
          if (
            !formData.invoiceMoveId ||
            !formData.paymentJournalId ||
            !formData.bankAccountId ||
            !formData.receivableAccountId
          ) {
            return
          }
          payInvoice.mutate(
            { subscriptionId: BigInt(payTargetId), params: buildPaySubscriptionInvoiceParams(formData) },
            mutationErrorOptions,
          )
          close()
        }}
      />
      <FormModal
        open={amendTargetId !== null}
        onOpenChange={(open) => !open && close()}
        config={amendForm}
        onSubmit={(formData) => {
          if (amendTargetId == null || !formData.lineId) return
          amend.mutate(
            { subscriptionId: BigInt(amendTargetId), params: buildAmendSubscriptionParams(formData) },
            mutationErrorOptions,
          )
          close()
        }}
      />
      <FormModal
        open={targetFor("renew") !== null}
        onOpenChange={(open) => !open && close()}
        config={renewForm}
        onSubmit={(formData) => {
          const id = targetFor("renew")
          if (id == null) return
          renew.mutate(
            { subscriptionId: BigInt(id), params: buildRenewSubscriptionParams(formData) },
            mutationErrorOptions,
          )
          close()
        }}
      />
      <FormModal
        open={cancelTargetId !== null}
        onOpenChange={(open) => !open && close()}
        config={cancelForm}
        onSubmit={(formData) => {
          if (cancelTargetId == null) return
          cancel.mutate(
            { subscriptionId: BigInt(cancelTargetId), params: buildCancelSubscriptionParams(formData) },
            mutationErrorOptions,
          )
          close()
        }}
      />
      <FormModal
        open={targetFor("ingest-usage") !== null}
        onOpenChange={(open) => !open && close()}
        config={ingestForm}
        onSubmit={(formData) => {
          const id = targetFor("ingest-usage")
          if (id == null || !formData.eventId) return
          ingestUsage.mutate(
            { subscriptionId: BigInt(id), params: buildIngestSubscriptionUsageEventParams(formData) },
            mutationErrorOptions,
          )
          close()
        }}
      />
      <FormModal
        open={targetFor("set-commitment") !== null}
        onOpenChange={(open) => !open && close()}
        config={commitmentForm}
        onSubmit={(formData) => {
          const id = targetFor("set-commitment")
          if (id == null) return
          setCommitment.mutate(
            { subscriptionId: BigInt(id), params: buildSetSubscriptionCommitmentParams(formData) },
            mutationErrorOptions,
          )
          close()
        }}
      />
    </>
  )

  return { dialogs, openDialog, runDirect, pending }
}

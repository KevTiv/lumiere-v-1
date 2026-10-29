"use client"
import { i18n } from "@lumiere/i18n"


import { useCallback, useEffect, useRef, useState } from "react"
import type { FormValues } from "@lumiere/ui/lib/form-types"
import type { CreateExpenseParams } from "@lumiere/stdb/types"
import { createExpenseReceiptAndResolveId } from "@lumiere/query-hooks/hooks/expenses"
import { fetchQueryList } from "@lumiere/query-hooks/http"
import { firstFileFromFormValue, uploadDocumentBlob } from "../../../lib/document-blob-upload"
import { enqueueExpenseCapture, getOrCreateExpenseCaptureDeviceId, newExpenseClientRequestId, readExpenseCaptureOutbox, saveExpenseCaptureCheckpoint, type ExpenseCaptureOutboxItem } from "../../../lib/expense-capture-outbox"
import { newExpenseReceiptClientRequestId } from "../../../lib/expenses-create-params"
import { captureFileMatches, syncExpenseCapture } from "./expense-capture-sync"
import { genericExpensePayload, pendingGenericExpense } from "./generic-expense-attempt"

interface GenericExpenseCreateOptions {
  organizationId: bigint
  companyId: bigint
  actorIdentity: string | null
  create: (params: Partial<CreateExpenseParams>) => Promise<unknown>
  onConfirmed: () => void
  canWrite: () => boolean
}

/** The existing capture outbox is the sole durable attempt owner for this form. */
export function useGenericExpenseCreate(options: GenericExpenseCreateOptions) {
  const live = useRef(options)
  live.current = options
  const [attempt, setAttempt] = useState<ExpenseCaptureOutboxItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const active = useRef(false)
  // File bytes are ephemeral; identity and all network checkpoints belong to the outbox.
  const fileRef = useRef<{ requestId: string; file: File } | null>(null)
  const currentAttempt = attempt?.formOrigin?.actorIdentity === options.actorIdentity && attempt.formOrigin.organizationId === String(options.organizationId) ? attempt : null
  const readStored = useCallback(() => {
    const scope = live.current
    if (!scope.actorIdentity || scope.organizationId <= 0n) throw new Error(i18n.t("expenses.useGenericExpenseCreate.signInBeforeRestoringAnExpenseRequest"))
    const deviceId = getOrCreateExpenseCaptureDeviceId()
    return { deviceId, item: pendingGenericExpense(readExpenseCaptureOutbox(String(scope.organizationId), deviceId, true), scope.actorIdentity) }
  }, [])
  useEffect(() => {
    setAttempt(null)
    setError(null)
    if (!options.actorIdentity || options.organizationId <= 0n) return
    try { setAttempt(readStored().item) }
    catch (cause) { setError(cause instanceof Error ? cause.message : i18n.t("expenses.useGenericExpenseCreate.expenseRecoveryIsUnavailable")) }
  }, [options.actorIdentity, options.organizationId, readStored])
  const readPending = useCallback(() => {
    if (live.current.companyId <= 0n) throw new Error(i18n.t("expenses.useGenericExpenseCreate.selectACompanyBeforeSavingOrCheckingAnExpense"))
    return readStored()
  }, [readStored])
  const resume = useCallback(() => {
    setError(null)
    try {
      const { item } = readStored()
      if (!item) throw new Error(i18n.t("expenses.useGenericExpenseCreate.theRetainedExpenseRequestIsUnavailable"))
      setAttempt(item)
    } catch (cause) { setError(cause instanceof Error ? cause.message : i18n.t("expenses.useGenericExpenseCreate.expenseRecoveryIsUnavailable")); throw cause }
  }, [readStored])
  const open = useCallback(() => {
    setError(null)
    try { setAttempt(readPending().item); return true }
    catch (cause) { setError(cause instanceof Error ? cause.message : i18n.t("expenses.useGenericExpenseCreate.expenseRecoveryIsUnavailable")); throw cause }
  }, [readPending])

  const run = useCallback(async (item: ExpenseCaptureOutboxItem) => {
    const scope = live.current
    const origin = item.formOrigin
    if (!origin) throw new Error(i18n.t("expenses.useGenericExpenseCreate.theRetainedExpenseFormIdentityIsUnavailable"))
    const assertScope = () => {
      const now = live.current
      if (now.actorIdentity !== origin.actorIdentity || String(now.organizationId) !== origin.organizationId || String(now.companyId) !== item.companyId) throw new Error(i18n.t("expenses.useGenericExpenseCreate.switchBackToTheCompanyAndSignedInAccountSavedWith"))
    }
    assertScope()
    const assertWriteAdmission = () => {
      assertScope()
      if (!live.current.canWrite()) throw new Error(i18n.t("expenses.useGenericExpenseCreate.expenseCreationIsNotAvailableTheRetainedRequestCanStillBe"))
    }
    const result = await syncExpenseCapture(item, { organizationId: scope.organizationId, companyId: scope.companyId, actorIdentity: scope.actorIdentity }, fileRef.current?.requestId === item.clientRequestId ? fileRef.current.file : undefined, {
      assertWriteAllowed: assertWriteAdmission,
      readExpenses: () => { assertScope(); return fetchQueryList("/api/query/expenses", i18n.t("expenses.use_generic_expense_create.unableToConfirmTheSavedExpense")) },
      readReceipts: () => { assertScope(); return fetchQueryList("/api/query/expense-receipts", i18n.t("expenses.use_generic_expense_create.unableToConfirmTheSavedReceipt")) },
      upload: (file, companyId) => { assertWriteAdmission(); return uploadDocumentBlob({ file, companyId, purpose: "expense_receipt" }) },
      register: (params) => { assertWriteAdmission(); return createExpenseReceiptAndResolveId(scope.organizationId, params) },
      create: (params) => { assertWriteAdmission(); return scope.create(params) },
      save: (next) => {
        saveExpenseCaptureCheckpoint(String(scope.organizationId), item.deviceId, next)
        if (live.current.actorIdentity === item.formOrigin?.actorIdentity && live.current.organizationId === scope.organizationId) setAttempt(next)
      },
    })
    if (result.syncState !== "synced") throw new Error(result.lastError ?? i18n.t("expenses.useGenericExpenseCreate.theSavedExpenseIsNotConfirmedCheckItsStatusBeforeFurther"))
    assertScope()
    fileRef.current = null
    setAttempt(null)
    live.current.onConfirmed()
  }, [])

  const execute = useCallback(async (work: () => Promise<void>) => {
    if (active.current) throw new Error(i18n.t("expenses.useGenericExpenseCreate.anExpenseStatusCheckIsAlreadyInProgress"))
    active.current = true; setBusy(true); setError(null)
    try { await work() }
    catch (cause) { setError(cause instanceof Error ? cause.message : i18n.t("expenses.useGenericExpenseCreate.theExpenseIsNotConfirmed")); throw cause }
    finally { active.current = false; setBusy(false) }
  }, [])

  const submit = useCallback((params: Partial<CreateExpenseParams>, values: FormValues) => execute(async () => {
    const { deviceId, item: retained } = readPending()
    if (retained) { setAttempt(retained); throw new Error(i18n.t("expenses.useGenericExpenseCreate.thisExpenseHasARetainedRequestCheckItsStatusBeforeFurther")) }
    const scope = live.current
    const payload = genericExpensePayload(params, values)
    const file = firstFileFromFormValue(values.receiptFile)
    if (payload.hasReceipt && !file) throw new Error(i18n.t("expenses.useGenericExpenseCreate.chooseAReceiptFileOrClearTheReceiptCheckbox"))
    const clientRequestId = newExpenseClientRequestId()
    const item = enqueueExpenseCapture(String(scope.organizationId), {
      clientRequestId, deviceId, companyId: String(scope.companyId), payload,
      formOrigin: { actorIdentity: scope.actorIdentity!, organizationId: String(scope.organizationId), pricelistId: String(values.pricelistId) },
      receipt: file && payload.hasReceipt ? { state: "queued", clientRequestId: newExpenseReceiptClientRequestId(), fileName: file.name, fileSize: file.size, mimeType: file.type, lastModified: file.lastModified } : undefined,
    })
    // Persist the complete payload before upload, receipt registration, or expense dispatch.
    setAttempt(item)
    if (file) fileRef.current = { requestId: clientRequestId, file }
    await run(item)
  }), [execute, readPending, run])

  const checkStatus = useCallback(() => execute(async () => {
    const { item } = readPending()
    if (!item) throw new Error(i18n.t("expenses.useGenericExpenseCreate.theRetainedExpenseRequestIsUnavailable"))
    setAttempt(item)
    await run(item)
  }), [execute, readPending, run])
  const reattach = useCallback((values: FormValues) => {
    if (!currentAttempt?.receipt || currentAttempt.receipt.uploaded || currentAttempt.syncState === "unknown" || currentAttempt.syncState === "submitting") return
    const file = firstFileFromFormValue(values.receiptFile)
    if (!file) return
    if (!captureFileMatches(file, currentAttempt.receipt)) { fileRef.current = null; setError(i18n.t("expenses.useGenericExpenseCreate.selectTheOriginalReceiptFileWithTheSameNameSizeType")); return }
    fileRef.current = { requestId: currentAttempt.clientRequestId, file }; setError(null)
  }, [currentAttempt])
  return { attempt: currentAttempt, busy, error, open, resume, submit, checkStatus, reattach }
}

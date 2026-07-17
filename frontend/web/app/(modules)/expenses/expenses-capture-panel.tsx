"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  useCreateExpense,
  useCreateExpenseIntegrationIntent,
} from "@lumiere/query-hooks/hooks/expenses"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useEmployees } from "@lumiere/query-hooks/hooks/hr"
import { usePricelists } from "@lumiere/query-hooks/hooks/sales"
import { Button } from "@lumiere/ui"
import { stbTimestampFromDate } from "@/lib/stb-timestamp"
import {
  discardExpenseCapture,
  enqueueExpenseCapture,
  getOrCreateExpenseCaptureDeviceId,
  listQueuedExpenseCaptures,
  markExpenseCaptureError,
  markExpenseCaptureSynced,
  newExpenseClientRequestId,
  requeueExpenseCapture,
  type ExpenseCapturePayload,
} from "@/lib/expense-capture-outbox"
import type {
  CreateExpenseParams,
  ExpenseLineKind,
  ExpensePaymentMode,
} from "@lumiere/stdb/types"

function lineKindTag(kind: ExpenseCapturePayload["lineKind"]): ExpenseLineKind {
  return { tag: kind } as ExpenseLineKind
}

function payloadToCreateParams(
  payload: ExpenseCapturePayload,
  clientRequestId: string,
): Partial<CreateExpenseParams> {
  return {
    employeeId: BigInt(payload.employeeId),
    name: payload.name,
    date: stbTimestampFromDate(new Date(payload.date)),
    unitAmount: payload.unitAmount,
    quantity: payload.quantity,
    currencyId: BigInt(payload.currencyId),
    description: payload.description,
    taxIds: [],
    attachmentIds: payload.hasReceipt ? [1n] : [],
    projectId: payload.projectId ? BigInt(payload.projectId) : undefined,
    lineKind: lineKindTag(payload.lineKind),
    mileageDistance: payload.mileageDistance,
    mileageRateId: payload.mileageRateId ? BigInt(payload.mileageRateId) : undefined,
    perDiemDays: payload.perDiemDays,
    perDiemRateId: payload.perDiemRateId ? BigInt(payload.perDiemRateId) : undefined,
    clientRequestId,
    paymentMode: { tag: "OutOfPocket" } as ExpensePaymentMode,
  }
}

function delayedSyncPayloadJson(
  payload: ExpenseCapturePayload,
  clientRequestId: string,
): string {
  return JSON.stringify({
    employee_id: Number(payload.employeeId),
    currency_id: Number(payload.currencyId),
    name: payload.name,
    unit_amount: payload.unitAmount,
    quantity: payload.quantity,
    description: payload.description,
    client_request_id: clientRequestId,
    attachment_ids: payload.hasReceipt ? [1] : [],
    project_id: payload.projectId ? Number(payload.projectId) : undefined,
  })
}

export function ExpensesCapturePanel({ organizationId }: { organizationId: number }) {
  const { t } = useTranslation()
  const orgId = BigInt(organizationId)
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n
  const createExpense = useCreateExpense(orgId, operatingCompanyId)
  const createIntent = useCreateExpenseIntegrationIntent(orgId, operatingCompanyId)
  const { data: employees = [] } = useEmployees(orgId)
  const { data: pricelists = [] } = usePricelists(orgId)

  const deviceId = useMemo(() => getOrCreateExpenseCaptureDeviceId(), [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const queued = useMemo(
    () => listQueuedExpenseCaptures(organizationId, deviceId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [organizationId, deviceId, tick, busy],
  )

  const [employeeId, setEmployeeId] = useState("")
  const [pricelistId, setPricelistId] = useState("")
  const [name, setName] = useState("")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [hasReceipt, setHasReceipt] = useState(true)
  const [lineKind, setLineKind] = useState<ExpenseCapturePayload["lineKind"]>("Standard")
  const [receiptNote, setReceiptNote] = useState("")

  const buildPayload = (): ExpenseCapturePayload | null => {
    const pl = pricelists.find((p) => String(p.id) === pricelistId)
    const currencyId = pl?.currencyId ?? pl?.currency_id
    if (!employeeId || !currencyId || !name.trim()) return null
    return {
      employeeId,
      name: name.trim(),
      date,
      unitAmount: Number(amount || 0),
      quantity: 1,
      currencyId: String(currencyId),
      description: receiptNote.trim() || undefined,
      hasReceipt,
      lineKind,
    }
  }

  const syncOne = async (payload: ExpenseCapturePayload, clientRequestId: string) => {
    try {
      await createIntent.mutateAsync({
        intentType: "delayed_sync",
        idempotencyKey: clientRequestId,
        deviceId,
        payload: delayedSyncPayloadJson(payload, clientRequestId),
      })
      await createExpense.mutateAsync(payloadToCreateParams(payload, clientRequestId))
    } catch {
      await createExpense.mutateAsync(payloadToCreateParams(payload, clientRequestId))
    }
  }

  const captureDelayedSync = async () => {
    const payload = buildPayload()
    if (!payload) {
      setError(t("expenses.capture.validation"))
      return
    }
    const clientRequestId = newExpenseClientRequestId()
    enqueueExpenseCapture(organizationId, {
      clientRequestId,
      deviceId,
      payload,
    })
    setBusy(true)
    setError(null)
    try {
      await syncOne(payload, clientRequestId)
      markExpenseCaptureSynced(organizationId, deviceId, clientRequestId)
      setName("")
      setAmount("")
      setReceiptNote("")
      setError(t("expenses.capture.queuedSynced"))
    } catch (e) {
      markExpenseCaptureError(
        organizationId,
        deviceId,
        clientRequestId,
        e instanceof Error ? e.message : String(e),
      )
      setError(t("expenses.capture.queuedOffline"))
    } finally {
      setBusy(false)
      setTick((n) => n + 1)
    }
  }

  const flushQueue = async () => {
    setBusy(true)
    setError(null)
    try {
      for (const item of listQueuedExpenseCaptures(organizationId, deviceId)) {
        if (item.syncState === "conflict") continue
        try {
          await syncOne(item.payload, item.clientRequestId)
          markExpenseCaptureSynced(organizationId, deviceId, item.clientRequestId)
        } catch (e) {
          markExpenseCaptureError(
            organizationId,
            deviceId,
            item.clientRequestId,
            e instanceof Error ? e.message : String(e),
          )
        }
      }
    } finally {
      setBusy(false)
      setTick((n) => n + 1)
    }
  }

  const retryItem = async (clientRequestId: string) => {
    requeueExpenseCapture(organizationId, deviceId, clientRequestId)
    setTick((n) => n + 1)
    const item = listQueuedExpenseCaptures(organizationId, deviceId).find(
      (i) => i.clientRequestId === clientRequestId,
    )
    if (!item) return
    setBusy(true)
    setError(null)
    try {
      await syncOne(item.payload, item.clientRequestId)
      markExpenseCaptureSynced(organizationId, deviceId, item.clientRequestId)
      setError(t("expenses.capture.queuedSynced"))
    } catch (e) {
      markExpenseCaptureError(
        organizationId,
        deviceId,
        item.clientRequestId,
        e instanceof Error ? e.message : String(e),
      )
      setError(t("expenses.capture.conflictHelp"))
    } finally {
      setBusy(false)
      setTick((n) => n + 1)
    }
  }

  const discardItem = (clientRequestId: string) => {
    discardExpenseCapture(organizationId, deviceId, clientRequestId)
    setTick((n) => n + 1)
  }

  return (
    <div
      className="rounded-lg border p-4 space-y-3 mb-4"
      data-testid="expenses-capture-panel"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">{t("expenses.capture.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("expenses.capture.description")}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || queued.length === 0}
          onClick={() => void flushQueue()}
          data-testid="expenses-capture-flush"
        >
          {t("expenses.capture.flushQueue")} ({queued.length})
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-muted-foreground" role="status" data-testid="expenses-capture-status">
          {error}
        </p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs space-y-1">
          <span>{t("expenses.forms.newExpense.fields.employeeId")}</span>
          <select
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            data-testid="expenses-capture-employee"
          >
            <option value="">{t("expenses.forms.newExpense.fields.employeePlaceholder")}</option>
            {employees.map((e) => (
              <option key={String(e.id)} value={String(e.id)}>
                {String(e.name ?? e.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs space-y-1">
          <span>{t("expenses.forms.newExpense.fields.pricelistId")}</span>
          <select
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={pricelistId}
            onChange={(e) => setPricelistId(e.target.value)}
            data-testid="expenses-capture-pricelist"
          >
            <option value="">{t("expenses.forms.newExpense.fields.pricelistPlaceholder")}</option>
            {pricelists.map((p) => (
              <option key={String(p.id)} value={String(p.id)}>
                {String(p.name ?? p.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs space-y-1 sm:col-span-2">
          <span>{t("expenses.forms.newExpense.fields.name")}</span>
          <input
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("expenses.forms.newExpense.fields.namePlaceholder")}
            data-testid="expenses-capture-name"
          />
        </label>
        <label className="text-xs space-y-1">
          <span>{t("expenses.forms.newExpense.fields.totalAmount")}</span>
          <input
            type="number"
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            data-testid="expenses-capture-amount"
          />
        </label>
        <label className="text-xs space-y-1">
          <span>{t("expenses.forms.newExpense.fields.date")}</span>
          <input
            type="date"
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="text-xs space-y-1">
          <span>{t("expenses.forms.newExpense.fields.lineKind")}</span>
          <select
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={lineKind}
            onChange={(e) => setLineKind(e.target.value as ExpenseCapturePayload["lineKind"])}
          >
            <option value="Standard">{t("expenses.forms.newExpense.fields.lineKindStandard")}</option>
            <option value="Mileage">{t("expenses.forms.newExpense.fields.lineKindMileage")}</option>
            <option value="PerDiem">{t("expenses.forms.newExpense.fields.lineKindPerDiem")}</option>
          </select>
        </label>
        <label className="text-xs flex items-center gap-2 pt-5">
          <input
            type="checkbox"
            checked={hasReceipt}
            onChange={(e) => setHasReceipt(e.target.checked)}
          />
          <span>{t("expenses.capture.receiptStub")}</span>
        </label>
        <label className="text-xs space-y-1 sm:col-span-2">
          <span>{t("expenses.capture.receiptNote")}</span>
          <input
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={receiptNote}
            onChange={(e) => setReceiptNote(e.target.value)}
            placeholder={t("expenses.capture.receiptNotePlaceholder")}
          />
        </label>
      </div>

      <Button
        type="button"
        disabled={busy}
        onClick={() => void captureDelayedSync()}
        data-testid="expenses-capture-submit"
      >
        {t("expenses.capture.submit")}
      </Button>

      {queued.length > 0 ? (
        <ul className="text-xs text-muted-foreground space-y-2" data-testid="expenses-capture-queue">
          {queued.map((q) => (
            <li
              key={q.clientRequestId}
              className="flex flex-wrap items-center gap-2"
              data-testid={`expenses-capture-item-${q.syncState}`}
            >
              <span>
                {q.payload.name} · {q.syncState}
                {q.lastError ? ` — ${q.lastError}` : ""}
              </span>
              {(q.syncState === "error" || q.syncState === "conflict") && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void retryItem(q.clientRequestId)}
                    data-testid="expenses-capture-retry"
                  >
                    {t("expenses.capture.retry")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => discardItem(q.clientRequestId)}
                    data-testid="expenses-capture-discard"
                  >
                    {t("expenses.capture.discard")}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

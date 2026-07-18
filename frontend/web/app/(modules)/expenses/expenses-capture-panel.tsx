"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  createExpenseReceiptAndResolveId,
  useCreateExpense,
  useCreateExpenseIntegrationIntent,
  useExpenseMileageRates,
  useExpensePerDiemRates,
} from "@lumiere/query-hooks/hooks/expenses"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useEmployees } from "@lumiere/query-hooks/hooks/hr"
import { usePricelists } from "@lumiere/query-hooks/hooks/sales"
import { Button } from "@lumiere/ui"
import { expenseRateRowsToSelectOptions } from "@/lib/form-lookup"
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
import { newExpenseReceiptClientRequestId } from "@/lib/expenses-create-params"
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
  attachmentIds: bigint[],
  paymentMode: ExpensePaymentMode,
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
    attachmentIds,
    projectId: payload.projectId ? BigInt(payload.projectId) : undefined,
    lineKind: lineKindTag(payload.lineKind),
    mileageDistance: payload.mileageDistance,
    mileageRateId: payload.mileageRateId ? BigInt(payload.mileageRateId) : undefined,
    perDiemDays: payload.perDiemDays,
    perDiemRateId: payload.perDiemRateId ? BigInt(payload.perDiemRateId) : undefined,
    clientRequestId,
    paymentMode,
    merchantKey: payload.merchantKey,
  }
}

function delayedSyncPayloadJson(
  payload: ExpenseCapturePayload,
  clientRequestId: string,
  attachmentIds: number[],
): string {
  return JSON.stringify({
    employee_id: Number(payload.employeeId),
    currency_id: Number(payload.currencyId),
    name: payload.name,
    unit_amount: payload.unitAmount,
    quantity: payload.quantity,
    description: payload.description,
    client_request_id: clientRequestId,
    attachment_ids: attachmentIds,
    project_id: payload.projectId ? Number(payload.projectId) : undefined,
    payment_mode: payload.paymentMode ?? "OutOfPocket",
    merchant_key: payload.merchantKey,
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
  const { data: mileageRates = [] } = useExpenseMileageRates(orgId)
  const { data: perDiemRates = [] } = useExpensePerDiemRates(orgId)
  const mileageRateOptions = useMemo(
    () => expenseRateRowsToSelectOptions(mileageRates),
    [mileageRates],
  )
  const perDiemRateOptions = useMemo(
    () => expenseRateRowsToSelectOptions(perDiemRates),
    [perDiemRates],
  )

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
  const [paymentMode, setPaymentMode] = useState<"OutOfPocket" | "CorporateCard">("OutOfPocket")
  const [lineKind, setLineKind] = useState<ExpenseCapturePayload["lineKind"]>("Standard")
  const [receiptNote, setReceiptNote] = useState("")
  const [mileageDistance, setMileageDistance] = useState("")
  const [mileageRateId, setMileageRateId] = useState("")
  const [perDiemDays, setPerDiemDays] = useState("")
  const [perDiemRateId, setPerDiemRateId] = useState("")

  const buildPayload = (): ExpenseCapturePayload | null => {
    const pl = pricelists.find((p) => String(p.id) === pricelistId)
    const currencyId = pl?.currencyId ?? pl?.currency_id
    if (!employeeId || !currencyId || !name.trim()) return null
    if (lineKind === "Mileage" && (!mileageDistance || !mileageRateId)) return null
    if (lineKind === "PerDiem" && (!perDiemDays || !perDiemRateId)) return null
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
      paymentMode,
      mileageDistance:
        lineKind === "Mileage" && mileageDistance ? Number(mileageDistance) : undefined,
      mileageRateId: lineKind === "Mileage" && mileageRateId ? mileageRateId : undefined,
      perDiemDays: lineKind === "PerDiem" && perDiemDays ? Number(perDiemDays) : undefined,
      perDiemRateId: lineKind === "PerDiem" && perDiemRateId ? perDiemRateId : undefined,
    }
  }

  const resolveAttachmentIds = async (payload: ExpenseCapturePayload): Promise<bigint[]> => {
    if (!payload.hasReceipt) return []
    const receiptClientRequestId = newExpenseReceiptClientRequestId()
    const storageKey = `capture:${deviceId}:${receiptClientRequestId}`
    const receiptId = await createExpenseReceiptAndResolveId(orgId, {
      companyId: operatingCompanyId,
      employeeId: BigInt(payload.employeeId),
      storageKey,
      clientRequestId: receiptClientRequestId,
      fileName: "capture-receipt",
      mimeType: "application/octet-stream",
    })
    return [receiptId]
  }

  const syncOne = async (payload: ExpenseCapturePayload, clientRequestId: string) => {
    const attachmentIds = await resolveAttachmentIds(payload)
    const attachmentNums = attachmentIds.map((id) => Number(id))
    const mode = {
      tag: (payload.paymentMode ?? "OutOfPocket") as "OutOfPocket" | "CorporateCard",
    } as ExpensePaymentMode
    try {
      await createIntent.mutateAsync({
        intentType: "delayed_sync",
        idempotencyKey: clientRequestId,
        deviceId,
        payload: delayedSyncPayloadJson(payload, clientRequestId, attachmentNums),
      })
      await createExpense.mutateAsync(
        payloadToCreateParams(payload, clientRequestId, attachmentIds, mode),
      )
    } catch {
      await createExpense.mutateAsync(
        payloadToCreateParams(payload, clientRequestId, attachmentIds, mode),
      )
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

      {error && (
        <p className="text-sm text-muted-foreground" role="status" data-testid="expenses-capture-status">
          {error}
        </p>
      )}

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
        <label className="text-xs space-y-1">
          <span>{t("expenses.forms.newExpense.fields.paymentMode")}</span>
          <select
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={paymentMode}
            onChange={(e) =>
              setPaymentMode(e.target.value as "OutOfPocket" | "CorporateCard")
            }
          >
            <option value="OutOfPocket">
              {t("expenses.forms.newExpense.fields.paymentModeOutOfPocket")}
            </option>
            <option value="CorporateCard">
              {t("expenses.forms.newExpense.fields.paymentModeCorporateCard")}
            </option>
          </select>
        </label>
        {lineKind === "Mileage" ? (
          <>
            <label className="text-xs space-y-1">
              <span>{t("expenses.forms.newExpense.fields.mileageDistance")}</span>
              <input
                type="number"
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={mileageDistance}
                onChange={(e) => setMileageDistance(e.target.value)}
                data-testid="expenses-capture-distance"
              />
            </label>
            <label className="text-xs space-y-1">
              <span>{t("expenses.forms.newExpense.fields.mileageRateId")}</span>
              <select
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={mileageRateId}
                onChange={(e) => setMileageRateId(e.target.value)}
                data-testid="expenses-capture-mileage-rate"
              >
                <option value="">
                  {mileageRateOptions.length === 0
                    ? t("expenses.forms.newExpense.fields.noMileageRates")
                    : t("expenses.forms.newExpense.fields.rateIdPlaceholder")}
                </option>
                {mileageRateOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        {lineKind === "PerDiem" ? (
          <>
            <label className="text-xs space-y-1">
              <span>{t("expenses.forms.newExpense.fields.perDiemDays")}</span>
              <input
                type="number"
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={perDiemDays}
                onChange={(e) => setPerDiemDays(e.target.value)}
                data-testid="expenses-capture-per-diem-days"
              />
            </label>
            <label className="text-xs space-y-1">
              <span>{t("expenses.forms.newExpense.fields.perDiemRateId")}</span>
              <select
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={perDiemRateId}
                onChange={(e) => setPerDiemRateId(e.target.value)}
                data-testid="expenses-capture-per-diem-rate"
              >
                <option value="">
                  {perDiemRateOptions.length === 0
                    ? t("expenses.forms.newExpense.fields.noPerDiemRates")
                    : t("expenses.forms.newExpense.fields.rateIdPlaceholder")}
                </option>
                {perDiemRateOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        <label className="text-xs space-y-1 sm:col-span-2">
          <span>{t("expenses.forms.newExpense.fields.description")}</span>
          <input
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={receiptNote}
            onChange={(e) => setReceiptNote(e.target.value)}
          />
        </label>
        <label className="text-xs flex items-center gap-2 sm:col-span-2">
          <input
            type="checkbox"
            checked={hasReceipt}
            onChange={(e) => setHasReceipt(e.target.checked)}
          />
          <span>{t("expenses.forms.newExpense.fields.hasReceipt")}</span>
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => void captureDelayedSync()}
          data-testid="expenses-capture-submit"
        >
          {t("expenses.capture.submit")}
        </Button>
      </div>

      {queued.length > 0 && (
        <ul className="text-xs text-muted-foreground space-y-2" data-testid="expenses-capture-queue">
          {queued.map((item) => (
            <li
              key={item.clientRequestId}
              className="flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1.5"
              data-testid={`expenses-capture-item-${item.syncState}`}
            >
              <span>
                {item.payload.name} · {item.syncState}
                {item.lastError ? ` — ${item.lastError}` : ""}
              </span>
              <span className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void retryItem(item.clientRequestId)}
                  data-testid="expenses-capture-retry"
                >
                  {t("expenses.capture.retry")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => discardItem(item.clientRequestId)}
                  data-testid="expenses-capture-discard"
                >
                  {t("expenses.capture.discard")}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

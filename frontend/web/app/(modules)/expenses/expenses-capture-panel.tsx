"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  createExpenseReceiptAndResolveId,
  useCreateExpense,
  useExpenseMileageRates,
  useExpensePerDiemRates,
} from "@lumiere/query-hooks/hooks/expenses"
import { fetchQueryList } from "@lumiere/query-hooks/http"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useEmployees } from "@lumiere/query-hooks/hooks/hr"
import { usePricelists } from "@lumiere/query-hooks/hooks/sales"
import { Button } from "@lumiere/ui/components/button"
import { Input } from "@lumiere/ui/components/input"
import { Checkbox } from "@lumiere/ui/components/checkbox"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@lumiere/ui/components/field"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@lumiere/ui/components/card"
import { Alert, AlertDescription } from "@lumiere/ui/components/alert"
import { Badge } from "@lumiere/ui/components/badge"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lumiere/ui/components/select"
import { expenseRateRowsToSelectOptions } from "../../../lib/form-lookup"
import { uploadDocumentBlob } from "../../../lib/document-blob-upload"
import {
  discardExpenseCapture,
  enqueueExpenseCapture,
  getOrCreateExpenseCaptureDeviceId,
  listQueuedExpenseCaptures,
  newExpenseClientRequestId,
  saveExpenseCaptureCheckpoint,
  type ExpenseCaptureOutboxItem,
  type ExpenseCapturePayload,
} from "../../../lib/expense-capture-outbox"
import { newExpenseReceiptClientRequestId } from "../../../lib/expenses-create-params"
import { expenseCompanyLookupRows } from "./expense-capture-input"
import { captureFileMatches, syncExpenseCapture } from "./expense-capture-sync"
import { CaptureAttachmentPreview } from "./capture-attachment-preview"

export function ExpensesCapturePanel({
  organizationId,
}: {
  organizationId: number
}) {
  const { t } = useTranslation()
  const orgId = BigInt(organizationId)
  const companyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n
  const createExpense = useCreateExpense(orgId, companyId)
  const { data: employees = [] } = useEmployees(orgId)
  const { data: pricelists = [] } = usePricelists(orgId)
  const { data: mileageRates = [] } = useExpenseMileageRates(orgId)
  const { data: perDiemRates = [] } = useExpensePerDiemRates(orgId)
  const scopedEmployees = expenseCompanyLookupRows(employees, orgId, companyId)
  const mileageOptions = expenseRateRowsToSelectOptions(
    expenseCompanyLookupRows(mileageRates, orgId, companyId),
  )
  const dailyOptions = expenseRateRowsToSelectOptions(
    expenseCompanyLookupRows(perDiemRates, orgId, companyId),
  )
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [files] = useState(() => new Map<string, File>())
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    try {
      setDeviceId(getOrCreateExpenseCaptureDeviceId())
    } catch {
      setError(
        t("expenses.capture.attachments.storageUnavailable", {
          defaultValue:
            "Local queue storage is unavailable. No capture can be saved on this device.",
        }),
      )
    }
  }, [t])
  const queued = useMemo(
    () => (deviceId ? listQueuedExpenseCaptures(organizationId, deviceId) : []),
    [organizationId, deviceId, tick],
  )
  const [employeeId, setEmployeeId] = useState("")
  const [pricelistId, setPricelistId] = useState("")
  const [name, setName] = useState("")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [hasReceipt, setHasReceipt] = useState(true)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [paymentMode, setPaymentMode] = useState<
    "OutOfPocket" | "CorporateCard"
  >("OutOfPocket")
  const [lineKind, setLineKind] =
    useState<ExpenseCapturePayload["lineKind"]>("Standard")
  const [receiptNote, setReceiptNote] = useState("")
  const [mileageDistance, setMileageDistance] = useState("")
  const [mileageRateId, setMileageRateId] = useState("")
  const [perDiemDays, setPerDiemDays] = useState("")
  const [perDiemRateId, setPerDiemRateId] = useState("")

  const buildPayload = (): ExpenseCapturePayload | null => {
    const currencyId = pricelists.find(
      (row) => String(row.id) === pricelistId,
    )?.currencyId
    if (
      !scopedEmployees.some((row) => String(row.id) === employeeId) ||
      !currencyId ||
      !name.trim() ||
      companyId <= 0n ||
      !date ||
      !Number.isFinite(new Date(date).getTime())
    )
      return null
    if (
      lineKind === "Standard" &&
      (!amount.trim() || !Number.isFinite(Number(amount)) || Number(amount) < 0)
    )
      return null
    if (
      lineKind === "Mileage" &&
      (!(Number(mileageDistance) > 0) ||
        !mileageOptions.some((option) => option.value === mileageRateId))
    )
      return null
    if (
      lineKind === "PerDiem" &&
      (!(Number(perDiemDays) > 0) ||
        !dailyOptions.some((option) => option.value === perDiemRateId))
    )
      return null
    return {
      employeeId,
      name: name.trim(),
      date,
      unitAmount: lineKind === "Standard" ? Number(amount) : 0,
      quantity: 1,
      currencyId: String(currencyId),
      description: receiptNote.trim() || undefined,
      hasReceipt,
      lineKind,
      paymentMode,
      mileageDistance:
        lineKind === "Mileage" ? Number(mileageDistance) : undefined,
      mileageRateId: lineKind === "Mileage" ? mileageRateId : undefined,
      perDiemDays: lineKind === "PerDiem" ? Number(perDiemDays) : undefined,
      perDiemRateId: lineKind === "PerDiem" ? perDiemRateId : undefined,
    }
  }

  const syncOne = async (item: ExpenseCaptureOutboxItem) => {
    if (!deviceId) return
    setStatus(null)
    try {
      const result = await syncExpenseCapture(
        item,
        { organizationId: orgId, companyId },
        files.get(item.clientRequestId),
        {
          readExpenses: () =>
            fetchQueryList(
              "/api/query/expenses",
              "Unable to confirm the expense capture",
            ),
          readReceipts: () =>
            fetchQueryList(
              "/api/query/expense-receipts",
              "Unable to confirm the receipt",
            ),
          upload: (file, scopeCompanyId) =>
            uploadDocumentBlob({ file, companyId: scopeCompanyId }),
          register: (params) => createExpenseReceiptAndResolveId(orgId, params),
          create: (params) => createExpense.mutateAsync(params),
          save: (next) => {
            saveExpenseCaptureCheckpoint(organizationId, deviceId, next)
            setTick((value) => value + 1)
          },
        },
      )
      if (result.syncState === "synced") {
        files.delete(result.clientRequestId)
        setStatus(
          t("expenses.capture.attachments.confirmed", {
            id: result.expenseId,
            defaultValue: "Expense {{id}} is confirmed in the saved records.",
          }),
        )
      } else if (result.syncState === "rejected") {
        setStatus(null)
        setError(
          result.lastError ??
            t("expenses.capture.attachments.rejected", {
              defaultValue:
                "The server rejected this capture. Retry after the cause is corrected, or discard it and capture corrected values.",
            }),
        )
      } else
        setStatus(
          t("expenses.capture.attachments.outcomeUnknown", {
            defaultValue:
              "The expense result is not confirmed. Check its status; no automatic resend will occur.",
          }),
        )
    } catch (cause) {
      setStatus(null)
      setError(
        cause instanceof Error
          ? cause.message
          : t("expenses.capture.attachments.failed", {
              defaultValue: "Capture failed",
            }),
      )
      setTick((value) => value + 1)
    }
  }

  const captureDelayedSync = async () => {
    const payload = buildPayload()
    if (!payload || !deviceId) {
      setError(t("expenses.capture.validation"))
      return
    }
    if (
      hasReceipt &&
      (!receiptFile ||
        receiptFile.size === 0 ||
        !(
          receiptFile.type.startsWith("image/") ||
          receiptFile.type === "application/pdf"
        ))
    ) {
      setError(
        t("expenses.capture.attachments.fileRequired", {
          defaultValue:
            "Choose a non-empty image or PDF receipt, or clear the receipt checkbox.",
        }),
      )
      return
    }
    setError(null)
    setStatus(null)
    const clientRequestId = newExpenseClientRequestId()
    try {
      const item = enqueueExpenseCapture(organizationId, {
        clientRequestId,
        deviceId,
        companyId: String(companyId),
        payload,
        receipt:
          hasReceipt && receiptFile
            ? {
                state: "queued",
                clientRequestId: newExpenseReceiptClientRequestId(),
                fileName: receiptFile.name,
                mimeType: receiptFile.type,
                fileSize: receiptFile.size,
                lastModified: receiptFile.lastModified,
              }
            : undefined,
      })
      if (receiptFile && hasReceipt) files.set(clientRequestId, receiptFile)
      setTick((value) => value + 1)
      setName("")
      setAmount("")
      setReceiptNote("")
      setReceiptFile(null)
      if (fileInput.current) fileInput.current.value = ""
      setStatus(
        t("expenses.capture.attachments.queued", {
          defaultValue: "Capture queued on this device.",
        }),
      )
      if (navigator.onLine) {
        setBusy(true)
        await syncOne(item)
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("expenses.capture.attachments.queueFailed", {
              defaultValue:
                "The capture could not be saved in the local queue.",
            }),
      )
    } finally {
      setBusy(false)
    }
  }

  const runQueued = async (items: ExpenseCaptureOutboxItem[]) => {
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      for (const item of items) await syncOne(item)
    } finally {
      setBusy(false)
    }
  }
  const reattach = (item: ExpenseCaptureOutboxItem, file: File | undefined) => {
    if (!file || !item.receipt) return
    if (!captureFileMatches(file, item.receipt)) {
      setError(
        t("expenses.capture.attachments.originalFile", {
          defaultValue:
            "Select the original receipt file with the same name, size, type, and modified date.",
        }),
      )
      return
    }
    files.set(item.clientRequestId, file)
    setError(null)
    setTick((value) => value + 1)
  }

  return (
    <Card
      data-testid="expenses-capture-panel"
      className="min-w-0 max-w-full [overflow-wrap:anywhere] [&_button]:h-auto [&_button]:min-h-7 [&_button]:min-w-0 [&_button]:max-w-full [&_button]:whitespace-normal"
    >
      <CardHeader className="min-w-0 max-w-full">
        <div className="flex min-w-0 max-w-full flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-full">
            <CardTitle>{t("expenses.capture.title")}</CardTitle>
            <CardDescription>
              {t("expenses.capture.description")}
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              busy ||
              !queued.some(
                (item) =>
                  item.syncState === "queued" || item.syncState === "error",
              )
            }
            onClick={() =>
              void runQueued(
                queued.filter(
                  (item) =>
                    item.syncState === "queued" || item.syncState === "error",
                ),
              )
            }
            data-testid="expenses-capture-flush"
          >
            {t("expenses.capture.flushQueue")} ({queued.length})
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex min-w-0 max-w-full flex-col gap-4">
        <Alert>
          <AlertDescription>
            {t("expenses.capture.attachments.persistenceLimit", {
              defaultValue:
                "Capture details and completed upload checkpoints are saved on this device. Unuploaded file bytes stay in this capture panel only. After leaving this panel or reloading, reattach the original file before syncing.",
            })}
          </AlertDescription>
        </Alert>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription data-testid="expenses-capture-status">
              {error}
            </AlertDescription>
          </Alert>
        ) : null}
        {status ? (
          <p
            role="status"
            className="text-sm text-muted-foreground"
            data-testid="expenses-capture-status"
          >
            {status}
          </p>
        ) : null}
        <FieldGroup className="grid min-w-0 grid-cols-1 sm:grid-cols-2">
          <Field className="min-w-0">
            <FieldLabel htmlFor="capture-employee">
              {t("expenses.forms.newExpense.fields.employeeId")}
            </FieldLabel>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger
                className="min-w-0 max-w-full"
                id="capture-employee"
                data-testid="expenses-capture-employee"
              >
                <SelectValue
                  placeholder={t(
                    "expenses.forms.newExpense.fields.employeePlaceholder",
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {scopedEmployees.map((row) => (
                    <SelectItem key={String(row.id)} value={String(row.id)}>
                      {String(row.name)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field className="min-w-0">
            <FieldLabel htmlFor="capture-pricelist">
              {t("expenses.forms.newExpense.fields.pricelistId")}
            </FieldLabel>
            <Select value={pricelistId} onValueChange={setPricelistId}>
              <SelectTrigger
                className="min-w-0 max-w-full"
                id="capture-pricelist"
                data-testid="expenses-capture-pricelist"
              >
                <SelectValue
                  placeholder={t(
                    "expenses.forms.newExpense.fields.pricelistPlaceholder",
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {pricelists.map((row) => (
                    <SelectItem key={String(row.id)} value={String(row.id)}>
                      {String(row.name)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field className="min-w-0 sm:col-span-2">
            <FieldLabel htmlFor="capture-name">
              {t("expenses.forms.newExpense.fields.name")}
            </FieldLabel>
            <Input
              id="capture-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              data-testid="expenses-capture-name"
            />
          </Field>
          <Field className="min-w-0">
            <FieldLabel htmlFor="capture-kind">
              {t("expenses.forms.newExpense.fields.lineKind")}
            </FieldLabel>
            <Select
              value={lineKind}
              onValueChange={(value) =>
                setLineKind(value as ExpenseCapturePayload["lineKind"])
              }
            >
              <SelectTrigger
                className="min-w-0 max-w-full"
                id="capture-kind"
                data-testid="expenses-capture-kind"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="Standard">
                    {t("expenses.forms.newExpense.fields.lineKindStandard")}
                  </SelectItem>
                  <SelectItem value="Mileage">
                    {t("expenses.forms.newExpense.fields.lineKindMileage")}
                  </SelectItem>
                  <SelectItem value="PerDiem">
                    {t("expenses.forms.newExpense.fields.lineKindPerDiem")}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field className="min-w-0">
            <FieldLabel htmlFor="capture-date">
              {t("expenses.forms.newExpense.fields.date")}
            </FieldLabel>
            <Input
              id="capture-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
          {lineKind === "Standard" ? (
            <Field className="min-w-0">
              <FieldLabel htmlFor="capture-amount">
                {t("expenses.forms.newExpense.fields.totalAmount")}
              </FieldLabel>
              <Input
                id="capture-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                data-testid="expenses-capture-amount"
              />
            </Field>
          ) : null}
          {lineKind === "Mileage" ? (
            <>
              <Field className="min-w-0">
                <FieldLabel htmlFor="capture-distance">
                  {t("expenses.forms.newExpense.fields.mileageDistance")}
                </FieldLabel>
                <Input
                  id="capture-distance"
                  type="number"
                  min="0"
                  step="0.01"
                  value={mileageDistance}
                  onChange={(event) => setMileageDistance(event.target.value)}
                  data-testid="expenses-capture-distance"
                />
              </Field>
              <Field className="min-w-0">
                <FieldLabel htmlFor="capture-mileage-rate">
                  {t("expenses.forms.newExpense.fields.mileageRateId")}
                </FieldLabel>
                <Select value={mileageRateId} onValueChange={setMileageRateId}>
                  <SelectTrigger
                    className="min-w-0 max-w-full"
                    id="capture-mileage-rate"
                    data-testid="expenses-capture-mileage-rate"
                  >
                    <SelectValue
                      placeholder={t(
                        "expenses.forms.newExpense.fields.rateIdPlaceholder",
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {mileageOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </>
          ) : null}
          {lineKind === "PerDiem" ? (
            <>
              <Field className="min-w-0">
                <FieldLabel htmlFor="capture-days">
                  {t("expenses.forms.newExpense.fields.perDiemDays")}
                </FieldLabel>
                <Input
                  id="capture-days"
                  type="number"
                  min="0"
                  step="0.5"
                  value={perDiemDays}
                  onChange={(event) => setPerDiemDays(event.target.value)}
                  data-testid="expenses-capture-per-diem-days"
                />
              </Field>
              <Field className="min-w-0">
                <FieldLabel htmlFor="capture-daily-rate">
                  {t("expenses.forms.newExpense.fields.perDiemRateId")}
                </FieldLabel>
                <Select value={perDiemRateId} onValueChange={setPerDiemRateId}>
                  <SelectTrigger
                    className="min-w-0 max-w-full"
                    id="capture-daily-rate"
                    data-testid="expenses-capture-per-diem-rate"
                  >
                    <SelectValue
                      placeholder={t(
                        "expenses.forms.newExpense.fields.rateIdPlaceholder",
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {dailyOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </>
          ) : null}
          <Field className="min-w-0">
            <FieldLabel htmlFor="capture-payment">
              {t("expenses.forms.newExpense.fields.paymentMode")}
            </FieldLabel>
            <Select
              value={paymentMode}
              onValueChange={(value) =>
                setPaymentMode(value as "OutOfPocket" | "CorporateCard")
              }
            >
              <SelectTrigger id="capture-payment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="OutOfPocket">
                    {t(
                      "expenses.forms.newExpense.fields.paymentModeOutOfPocket",
                    )}
                  </SelectItem>
                  <SelectItem value="CorporateCard">
                    {t(
                      "expenses.forms.newExpense.fields.paymentModeCorporateCard",
                    )}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field className="min-w-0 sm:col-span-2">
            <FieldLabel htmlFor="capture-note">
              {t("expenses.forms.newExpense.fields.description")}
            </FieldLabel>
            <Input
              id="capture-note"
              value={receiptNote}
              onChange={(event) => setReceiptNote(event.target.value)}
            />
          </Field>
          <Field orientation="horizontal" className="min-w-0 sm:col-span-2">
            <Checkbox
              id="capture-has-receipt"
              checked={hasReceipt}
              onCheckedChange={(checked) => {
                setHasReceipt(checked === true)
                if (!checked) {
                  setReceiptFile(null)
                  if (fileInput.current) fileInput.current.value = ""
                }
              }}
              data-testid="expenses-capture-has-receipt"
            />
            <FieldLabel htmlFor="capture-has-receipt">
              {t("expenses.forms.newExpense.fields.hasReceipt")}
            </FieldLabel>
          </Field>
          {hasReceipt ? (
            <Field className="min-w-0 sm:col-span-2">
              <FieldLabel htmlFor="capture-file">
                {t("expenses.forms.newExpense.fields.receiptFile")}
              </FieldLabel>
              <Input
                ref={fileInput}
                id="capture-file"
                type="file"
                accept="image/*,application/pdf"
                onChange={(event) =>
                  setReceiptFile(event.target.files?.[0] ?? null)
                }
                data-testid="expenses-capture-file"
              />
              <FieldDescription>
                {t("expenses.capture.attachments.fileHint", {
                  defaultValue:
                    "Attach an image or PDF. A note alone is not a receipt.",
                })}
              </FieldDescription>
            </Field>
          ) : null}
        </FieldGroup>
        {hasReceipt && receiptFile ? (
          <CaptureAttachmentPreview file={receiptFile} />
        ) : null}
        <div>
          <Button
            type="button"
            size="sm"
            disabled={busy || !deviceId || companyId <= 0n}
            onClick={() => void captureDelayedSync()}
            data-testid="expenses-capture-submit"
          >
            {t("expenses.capture.submit")}
          </Button>
        </div>
        {queued.length > 0 ? (
          <ul
            className="flex flex-col gap-3"
            data-testid="expenses-capture-queue"
          >
            {queued.map((item) => {
              const file = files.get(item.clientRequestId)
              const missing =
                item.payload.hasReceipt && !item.receipt?.uploaded && !file
              const unknown =
                item.syncState === "unknown" || item.syncState === "submitting"
              return (
                <li
                  key={item.clientRequestId}
                  className="flex flex-col gap-3 rounded-lg border p-3"
                  data-testid={`expenses-capture-item-${item.syncState}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{item.payload.name}</strong>
                    <Badge
                      variant="outline"
                      className="min-w-0 max-w-full whitespace-normal"
                    >
                      {unknown
                        ? t("expenses.capture.attachments.awaiting", {
                            defaultValue: "Awaiting confirmation",
                          })
                        : item.syncState === "rejected" ||
                            item.syncState === "error" ||
                            item.syncState === "conflict"
                          ? t("expenses.capture.attachments.failed", {
                              defaultValue: "Capture failed",
                            })
                          : t("expenses.capture.attachments.queuedLabel", {
                              defaultValue: "Queued",
                            })}
                    </Badge>
                    {item.receipt ? (
                      <Badge
                        variant="secondary"
                        className="min-w-0 max-w-full whitespace-normal"
                      >
                        {item.receipt.state === "attached"
                          ? t("expenses.capture.attachments.attached", {
                              defaultValue: "Receipt attached",
                            })
                          : item.receipt.state === "uploading" && busy
                            ? t("expenses.capture.attachments.uploading", {
                                defaultValue: "Uploading receipt",
                              })
                            : item.receipt.state === "failed"
                              ? t(
                                  "expenses.capture.attachments.receiptFailed",
                                  { defaultValue: "Receipt failed" },
                                )
                              : t(
                                  "expenses.capture.attachments.receiptQueued",
                                  { defaultValue: "Receipt queued" },
                                )}
                      </Badge>
                    ) : null}
                  </div>
                  {item.receipt ? (
                    <p className="text-sm text-muted-foreground">
                      {item.receipt.fileName}
                    </p>
                  ) : null}
                  {!item.companyId ||
                  (item.payload.hasReceipt && !item.receipt) ? (
                    <p className="text-sm text-muted-foreground">
                      {t("expenses.capture.attachments.legacy", {
                        defaultValue:
                          "This older capture cannot be resumed safely. Discard it and capture it again.",
                      })}
                    </p>
                  ) : item.companyId !== String(companyId) ? (
                    <p className="text-sm text-muted-foreground">
                      {t("expenses.capture.attachments.companyMismatch", {
                        defaultValue:
                          "Switch to the company saved with this capture before syncing.",
                      })}
                    </p>
                  ) : null}
                  {item.syncState === "rejected" ? (
                    <p className="text-sm text-muted-foreground">
                      {t("expenses.capture.attachments.rejected", {
                        defaultValue:
                          "The server rejected this capture. Retry after the cause is corrected, or discard it and capture corrected values.",
                      })}
                    </p>
                  ) : null}
                  {item.lastError ? (
                    <p role="alert" className="text-sm text-destructive">
                      {item.lastError}
                    </p>
                  ) : null}
                  {missing ? (
                    <Field className="min-w-0">
                      <FieldLabel htmlFor={`reattach-${item.clientRequestId}`}>
                        {t("expenses.capture.attachments.reattach", {
                          defaultValue: "Reattach the original receipt",
                        })}
                      </FieldLabel>
                      <Input
                        id={`reattach-${item.clientRequestId}`}
                        type="file"
                        accept="image/*,application/pdf"
                        disabled={busy || !item.receipt}
                        onChange={(event) =>
                          reattach(item, event.target.files?.[0])
                        }
                        data-testid="expenses-capture-reattach"
                      />
                    </Field>
                  ) : null}
                  {file ? (
                    <CaptureAttachmentPreview
                      file={file}
                      attached={item.receipt?.state === "attached"}
                    />
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={
                        busy ||
                        item.companyId !== String(companyId) ||
                        (missing && !unknown)
                      }
                      onClick={() => void runQueued([item])}
                      data-testid="expenses-capture-retry"
                    >
                      {unknown
                        ? t("expenses.capture.attachments.checkStatus", {
                            defaultValue: "Check status",
                          })
                        : item.syncState === "rejected"
                          ? t("expenses.capture.attachments.retryRejected", {
                              defaultValue: "Retry rejected capture",
                            })
                          : t("expenses.capture.retry")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        if (deviceId)
                          discardExpenseCapture(
                            organizationId,
                            deviceId,
                            item.clientRequestId,
                          )
                        files.delete(item.clientRequestId)
                        setTick((value) => value + 1)
                      }}
                      data-testid="expenses-capture-discard"
                    >
                      {t("expenses.capture.discard")}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}

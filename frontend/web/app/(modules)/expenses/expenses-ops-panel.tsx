"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  useApplyPendingExpenseIntegrationIntents,
  useCreateExpenseCardStatementLine,
  useMatchExpenseCardStatementLine,
  useSeedStatutoryExpenseMileageRates,
  useUnmatchExpenseCardStatementLine,
  useUpsertExpenseMileageRate,
  useUpsertExpensePerDiemRate,
} from "@lumiere/query-hooks/hooks/expenses"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useCurrencies } from "@lumiere/query-hooks/hooks/settings"
import {
  Button,
  FormModal,
  mergeFieldDefaultValues,
  mergeSelectOptionsForFields,
  upsertExpenseMileageRateForm,
  upsertExpensePerDiemRateForm,
} from "@lumiere/ui"
import { optionalBigIntU64 } from "@lumiere/erp-shared/form-coercion"
import { stbTimestampFromDate } from "@/lib/stb-timestamp"
import { currencyOptionsFromRows } from "@/lib/form-lookup"

/**
 * Wave E ops: card statement match + OCR/email inbox intent flush.
 * Wave G: mileage / per diem rate admin (upsert_expense_mileage_rate, upsert_expense_per_diem_rate).
 */
export function ExpensesOpsPanel({ organizationId }: { organizationId: number }) {
  const { t } = useTranslation()
  const orgId = BigInt(organizationId)
  const companyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n
  const createStmt = useCreateExpenseCardStatementLine(orgId, companyId)
  const matchStmt = useMatchExpenseCardStatementLine(orgId)
  const unmatchStmt = useUnmatchExpenseCardStatementLine(orgId)
  const applyPending = useApplyPendingExpenseIntegrationIntents(orgId)
  const upsertMileage = useUpsertExpenseMileageRate(orgId, companyId)
  const upsertPerDiem = useUpsertExpensePerDiemRate(orgId, companyId)
  const seedStatutoryMileage = useSeedStatutoryExpenseMileageRates(orgId, companyId)
  const { data: currencies = [] } = useCurrencies()
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [rateForm, setRateForm] = useState<"mileage" | "perDiem" | null>(null)

  const [externalRef, setExternalRef] = useState("")
  const [merchantKey, setMerchantKey] = useState("")
  const [amount, setAmount] = useState("")
  const [fxFee, setFxFee] = useState("0")
  const [currencyId, setCurrencyId] = useState("")
  const [statementLineId, setStatementLineId] = useState("")
  const [expenseId, setExpenseId] = useState("")

  const currencyOptions = useMemo(() => currencyOptionsFromRows(currencies), [currencies])
  const mileageForm = useMemo(
    () =>
      mergeFieldDefaultValues(
        mergeSelectOptionsForFields(upsertExpenseMileageRateForm(t), { currencyId: currencyOptions }),
        { currencyId },
      ),
    [t, currencyOptions, currencyId],
  )
  const perDiemForm = useMemo(
    () =>
      mergeFieldDefaultValues(
        mergeSelectOptionsForFields(upsertExpensePerDiemRateForm(t), { currencyId: currencyOptions }),
        { currencyId },
      ),
    [t, currencyOptions, currencyId],
  )

  useEffect(() => {
    if (!currencyId && currencyOptions[0]) setCurrencyId(currencyOptions[0].value)
  }, [currencyId, currencyOptions])

  const requireCurrencyId = (value: unknown): bigint => {
    const parsed = optionalBigIntU64(value)
    if (parsed === undefined || parsed === 0n) throw new Error("Choose an active currency")
    return parsed
  }

  const run = async (fn: () => Promise<void>, okMsg: string) => {
    setBusy(true)
    setStatus(null)
    try {
      await fn()
      setStatus(okMsg)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const optionalDate = (v: unknown) => {
    if (v == null || String(v).trim() === "") return undefined
    const d = new Date(String(v))
    return Number.isNaN(d.getTime()) ? undefined : stbTimestampFromDate(d)
  }

  return (
    <div
      className="rounded-lg border p-4 space-y-3 mb-4"
      data-testid="expenses-ops-panel"
    >
      <div>
        <h2 className="text-sm font-medium">{t("expenses.ops.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("expenses.ops.description")}</p>
      </div>

      {status ? (
        <p className="text-sm text-muted-foreground" role="status" data-testid="expenses-ops-status">
          {status}
        </p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2" data-testid="expenses-ops-card-match">
        <input
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
          placeholder={t("expenses.ops.externalRef")}
          value={externalRef}
          onChange={(e) => setExternalRef(e.target.value)}
          data-testid="expenses-ops-external-ref"
        />
        <input
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
          placeholder={t("expenses.ops.merchantKey")}
          value={merchantKey}
          onChange={(e) => setMerchantKey(e.target.value)}
        />
        <input
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
          placeholder={t("expenses.ops.amount")}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          data-testid="expenses-ops-amount"
        />
        <input
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
          placeholder={t("expenses.ops.fxFee")}
          value={fxFee}
          onChange={(e) => setFxFee(e.target.value)}
        />
        <select
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
          value={currencyId}
          onChange={(e) => setCurrencyId(e.target.value)}
          aria-label={t("expenses.ops.currencyId")}
        >
          {currencyOptions.map((currency) => (
            <option key={currency.value} value={currency.value}>{currency.label}</option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          disabled={busy || !externalRef.trim() || !amount || !currencyId}
          data-testid="expenses-ops-create-statement"
          onClick={() =>
            void run(async () => {
              await createStmt.mutateAsync({
                externalRef: externalRef.trim(),
                merchantKey: merchantKey.trim() || undefined,
                amount: Number(amount),
                currencyId: requireCurrencyId(currencyId),
                transactionDate: stbTimestampFromDate(new Date()),
                fxFeeAmount: Number(fxFee || 0),
              })
            }, t("expenses.ops.createdStatement"))
          }
        >
          {t("expenses.ops.createStatement")}
        </Button>
        <input
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
          placeholder={t("expenses.ops.statementLineId")}
          value={statementLineId}
          onChange={(e) => setStatementLineId(e.target.value)}
          data-testid="expenses-ops-statement-id"
        />
        <input
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
          placeholder={t("expenses.ops.expenseId")}
          value={expenseId}
          onChange={(e) => setExpenseId(e.target.value)}
          data-testid="expenses-ops-expense-id"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !statementLineId || !expenseId}
          data-testid="expenses-ops-match"
          onClick={() =>
            void run(async () => {
              await matchStmt.mutateAsync({
                statementLineId,
                expenseId,
              })
            }, t("expenses.ops.matched"))
          }
        >
          {t("expenses.ops.match")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy || !statementLineId}
          data-testid="expenses-ops-unmatch"
          onClick={() =>
            void run(async () => {
              await unmatchStmt.mutateAsync({ statementLineId })
            }, t("expenses.ops.unmatched"))
          }
        >
          {t("expenses.ops.unmatch")}
        </Button>
      </div>

      <div className="space-y-2 border-t pt-3" data-testid="expenses-ops-rates">
        <div>
          <h3 className="text-sm font-medium">{t("expenses.ops.ratesTitle")}</h3>
          <p className="text-xs text-muted-foreground">{t("expenses.ops.ratesDescription")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            data-testid="expenses-ops-upsert-mileage"
            onClick={() => setRateForm("mileage")}
          >
            {t("expenses.ops.upsertMileage")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            data-testid="expenses-ops-upsert-per-diem"
            onClick={() => setRateForm("perDiem")}
          >
            {t("expenses.ops.upsertPerDiem")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy || seedStatutoryMileage.isPending}
            data-testid="expenses-ops-seed-statutory-mileage"
            onClick={() =>
              void run(async () => {
                const seedCurrencyId = requireCurrencyId(currencyId)
                await seedStatutoryMileage.mutateAsync({ currencyId: seedCurrencyId })
              }, t("expenses.ops.statutoryMileageSeeded"))
            }
          >
            {t("expenses.ops.seedStatutoryMileage")}
          </Button>
        </div>
      </div>

      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={busy}
        data-testid="expenses-ops-flush-intents"
        onClick={() =>
          void run(async () => {
            await applyPending.mutateAsync(20)
          }, t("expenses.ops.flushedIntents"))
        }
      >
        {t("expenses.ops.flushIntents")}
      </Button>

      <FormModal
        open={rateForm !== null}
        onOpenChange={(open) => {
          if (!open) setRateForm(null)
        }}
        config={rateForm === "perDiem" ? perDiemForm : mileageForm}
        isPending={upsertMileage.isPending || upsertPerDiem.isPending}
        onSubmit={async (formData) => {
          const rateId = optionalBigIntU64(formData.rateId)
          if (rateForm === "mileage") {
            await upsertMileage.mutateAsync({
              rateId: rateId ?? null,
              params: {
                name: String(formData.name ?? ""),
                currencyId: requireCurrencyId(formData.currencyId),
                ratePerUnit: Number(formData.ratePerUnit ?? 0),
                unit: String(formData.unit ?? "km"),
                effectiveFrom: optionalDate(formData.effectiveFrom),
                effectiveTo: optionalDate(formData.effectiveTo),
                active: formData.active !== false && formData.active !== "false",
              },
            })
            setStatus(t("expenses.ops.mileageSaved"))
          } else if (rateForm === "perDiem") {
            await upsertPerDiem.mutateAsync({
              rateId: rateId ?? null,
              params: {
                name: String(formData.name ?? ""),
                currencyId: requireCurrencyId(formData.currencyId),
                locationCode: String(formData.locationCode ?? ""),
                amountPerDay: Number(formData.amountPerDay ?? 0),
                effectiveFrom: optionalDate(formData.effectiveFrom),
                effectiveTo: optionalDate(formData.effectiveTo),
                active: formData.active !== false && formData.active !== "false",
              },
            })
            setStatus(t("expenses.ops.perDiemSaved"))
          }
          setRateForm(null)
        }}
      />
    </div>
  )
}

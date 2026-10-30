"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  useCreateExpenseCardStatementLine,
  useMatchExpenseCardStatementLine,
  useUnmatchExpenseCardStatementLine,
  useSeedStatutoryExpenseMileageRates,
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
import { ExpenseRecordPicker } from "./expense-record-picker"
import { ExpenseTextField } from "./expense-text-field"
import { FieldGroup } from "@lumiere/ui/components/field"
import { cardMatchCandidates, companyWorkflowRows, workflowOptions } from "./expense-workflow-model"
import { moduleCollection, moduleQueryState } from "@lumiere/ui/lib/module-data-state"
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice"
import { useExpenses, useExpenseCardStatementUnmatched } from "@lumiere/query-hooks/hooks/expenses"
import { currencyOptionsFromRows } from "@/lib/form-lookup"

/**
 * Wave E ops: card statement match + OCR/email inbox intent flush.
 * Wave G: mileage / per diem rate admin (upsert_expense_mileage_rate, upsert_expense_per_diem_rate).
 */
export function ExpensesOpsPanel({ organizationId, section = "cards" }: { organizationId: number; section?: "cards" | "rates" }) {
  const { t } = useTranslation()
  const orgId = BigInt(organizationId)
  const companyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n
  const createStmt = useCreateExpenseCardStatementLine(orgId, companyId)
  const unmatchStmt = useUnmatchExpenseCardStatementLine(orgId)
  const [unmatchStatementId, setUnmatchStatementId] = useState("")
  const matchStmt = useMatchExpenseCardStatementLine(orgId)
  const upsertMileage = useUpsertExpenseMileageRate(orgId, companyId)
  const upsertPerDiem = useUpsertExpensePerDiemRate(orgId, companyId)
  const seedStatutoryMileage = useSeedStatutoryExpenseMileageRates(orgId, companyId)
  const currenciesQuery = useCurrencies()
  const currencies = currenciesQuery.data ?? []
  const currencyState = moduleQueryState(currenciesQuery)
  const expensesRead = moduleCollection(useExpenses(orgId))
  const cardsRead = moduleCollection(useExpenseCardStatementUnmatched(orgId))
  const statementOptions = workflowOptions(companyWorkflowRows(cardsRead.rows, orgId, companyId))

  const matchReady = expensesRead.state.status === "ready" && cardsRead.state.status === "ready"
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
  const selectedStatement = cardsRead.rows.find(row => String(row.id) === statementLineId)
  const expenseOptions = workflowOptions(selectedStatement ? cardMatchCandidates(companyWorkflowRows(expensesRead.rows, orgId, companyId), selectedStatement) : [])
  useEffect(() => { setStatementLineId(""); setExpenseId(""); setCurrencyId(""); setUnmatchStatementId("") }, [orgId, companyId])

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
        <h2 className="text-sm font-medium">{t(section === "cards" ? "expenses.workflowUi.reconciliation" : "expenses.ops.ratesTitle")}</h2>
        <p className="text-xs text-muted-foreground">{t(section === "cards" ? "expenses.workflowUi.reconciliationHint" : "expenses.ops.ratesDescription")}</p>
      </div>

      {status ? (
        <p className="text-sm text-muted-foreground" role="status" data-testid="expenses-ops-status">
          {status}
        </p>
      ) : null}

      <ModuleDataNotice state={currencyState} />
      <ExpenseRecordPicker label={t("expenses.workflowUi.currency")} value={currencyId} onChange={setCurrencyId}
        options={currencyOptions} disabled={busy || currencyState.status !== "ready"} testId="expenses-ops-currency" />
      {section === "cards" && <>
      <ModuleDataNotice state={expensesRead.state} /><ModuleDataNotice state={cardsRead.state} />
      <FieldGroup className="grid items-start gap-4 sm:grid-cols-2" data-testid="expenses-ops-card-match">
        <ExpenseTextField
          label={t("expenses.ops.externalRef")}
          value={externalRef}
          onChange={(e) => setExternalRef(e.target.value)}
          data-testid="expenses-ops-external-ref"
        />
        <ExpenseTextField
          label={t("expenses.ops.merchantKey")}
          value={merchantKey}
          onChange={(e) => setMerchantKey(e.target.value)}
        />
        <ExpenseTextField
          label={t("expenses.ops.amount")}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          data-testid="expenses-ops-amount"
        />
        <ExpenseTextField
          label={t("expenses.ops.fxFee")}
          inputMode="decimal"
          value={fxFee}
          onChange={(e) => setFxFee(e.target.value)}
        />
        <Button
          type="button"
          className="w-fit max-w-full whitespace-normal sm:col-span-2"
          disabled={busy || currencyState.status !== "ready" || !externalRef.trim() || !amount || !currencyOptions.some(option => option.value === currencyId)}
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
        <ExpenseRecordPicker label={t("expenses.workflowUi.statement")} value={statementLineId} onChange={setStatementLineId}
          options={statementOptions} disabled={busy || !matchReady} testId="expenses-ops-statement-id" />
        <ExpenseRecordPicker label={t("expenses.workflowUi.expense")} value={expenseId} onChange={setExpenseId}
          options={expenseOptions} disabled={busy || !matchReady} testId="expenses-ops-expense-id" />
        <Button
          type="button"
          className="w-fit max-w-full whitespace-normal sm:col-span-2"
          variant="outline"
          disabled={busy || !matchReady || !statementOptions.some(option => option.value === statementLineId) || !expenseOptions.some(option => option.value === expenseId)}
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

      </FieldGroup>

      <details className="rounded-md border p-3 space-y-2">
        <summary>{t("expenses.workflowUi.unmatchTitle")}</summary>
        <p className="text-sm text-muted-foreground">{t("expenses.workflowUi.unmatchHint")}</p>
        <ExpenseTextField id="expense-unmatch-statement" label={t("expenses.ops.statementLineId")} inputMode="numeric" value={unmatchStatementId} onChange={event => setUnmatchStatementId(event.target.value)} />
        <Button variant="outline" disabled={busy || !optionalBigIntU64(unmatchStatementId)} data-testid="expenses-ops-unmatch"
          onClick={() => { void run(async () => { await unmatchStmt.mutateAsync({ statementLineId: unmatchStatementId }) }, t("expenses.ops.unmatched")) }}>{t("expenses.ops.unmatch")}</Button>
      </details>
      </>}
      {section === "rates" && <div className="space-y-2 border-t pt-3" data-testid="expenses-ops-rates">
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
            disabled={busy || seedStatutoryMileage.isPending || currencyState.status !== "ready" || !currencyOptions.some(option => option.value === currencyId)}
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
      </div>}
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

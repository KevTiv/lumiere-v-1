"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  useApplyExpenseAdvanceToSheet,
  useApproveExpensePolicyException,
  useCreateExpenseAdvance,
  useExpenseAdvances,
  useExpensePolicyExceptions,
  useRejectExpensePolicyException,
  useRequestExpensePolicyException,
  useSetExpenseFraudHold,
} from "@lumiere/query-hooks/hooks/expenses"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { Button } from "@lumiere/ui"
import { stbTimestampFromDate } from "@/lib/stb-timestamp"

/**
 * Wave H admin: advances (issue/apply), policy exception queue, fraud hold.
 * Reducers: create_expense_advance, apply_expense_advance_to_sheet,
 * request_expense_policy_exception, approve_expense_policy_exception,
 * reject_expense_policy_exception, set_expense_fraud_hold (fraud_hold / policy_exception UI).
 */
export function ExpensesAdminPanel({ organizationId }: { organizationId: number }) {
  const { t } = useTranslation()
  const orgId = BigInt(organizationId)
  const companyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n
  const advancesQ = useExpenseAdvances(orgId)
  const exceptionsQ = useExpensePolicyExceptions(orgId)
  const createAdvance = useCreateExpenseAdvance(orgId, companyId)
  const applyAdvance = useApplyExpenseAdvanceToSheet(orgId)
  const requestExc = useRequestExpensePolicyException(orgId)
  const approveExc = useApproveExpensePolicyException(orgId)
  const rejectExc = useRejectExpensePolicyException(orgId)
  const fraudHold = useSetExpenseFraudHold(orgId)

  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [advEmployeeId, setAdvEmployeeId] = useState("")
  const [advName, setAdvName] = useState("")
  const [advAmount, setAdvAmount] = useState("")
  const [advJournalId, setAdvJournalId] = useState("")
  const [advCashId, setAdvCashId] = useState("")
  const [advAccountId, setAdvAccountId] = useState("")
  const [advCurrencyId, setAdvCurrencyId] = useState("1")
  const [applyAdvanceId, setApplyAdvanceId] = useState("")
  const [applySheetId, setApplySheetId] = useState("")
  const [applyAmount, setApplyAmount] = useState("")

  const [excExpenseId, setExcExpenseId] = useState("")
  const [excReason, setExcReason] = useState("")
  const [rejectReason, setRejectReason] = useState("")

  const [fraudExpenseId, setFraudExpenseId] = useState("")
  const [fraudReason, setFraudReason] = useState("")

  const advances = useMemo(() => {
    const rows = (advancesQ.data ?? []) as Record<string, unknown>[]
    return rows.filter((r) => Number(r.residual ?? r.Residual ?? 0) > 0.0001)
  }, [advancesQ.data])

  const exceptions = useMemo(
    () => (exceptionsQ.data ?? []) as Record<string, unknown>[],
    [exceptionsQ.data],
  )

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

  const rowId = (row: Record<string, unknown>) => String(row.id ?? "")

  return (
    <div
      className="rounded-lg border p-4 space-y-4 mb-4"
      data-testid="expenses-admin-panel"
    >
      <div>
        <h2 className="text-sm font-medium">{t("expenses.admin.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("expenses.admin.description")}</p>
      </div>

      {status ? (
        <p className="text-sm text-muted-foreground" role="status" data-testid="expenses-admin-status">
          {status}
        </p>
      ) : null}

      {/* Advances */}
      <section className="space-y-2 border-t pt-3" data-testid="expenses-admin-advances">
        <h3 className="text-sm font-medium">{t("expenses.admin.advancesTitle")}</h3>
        <p className="text-xs text-muted-foreground">{t("expenses.admin.advancesDescription")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            placeholder={t("expenses.admin.employeeId")}
            value={advEmployeeId}
            onChange={(e) => setAdvEmployeeId(e.target.value)}
            data-testid="expenses-admin-adv-employee"
          />
          <input
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            placeholder={t("expenses.admin.advanceName")}
            value={advName}
            onChange={(e) => setAdvName(e.target.value)}
            data-testid="expenses-admin-adv-name"
          />
          <input
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            placeholder={t("expenses.admin.amount")}
            value={advAmount}
            onChange={(e) => setAdvAmount(e.target.value)}
            data-testid="expenses-admin-adv-amount"
          />
          <input
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            placeholder={t("expenses.admin.currencyId")}
            value={advCurrencyId}
            onChange={(e) => setAdvCurrencyId(e.target.value)}
          />
          <input
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            placeholder={t("expenses.admin.journalId")}
            value={advJournalId}
            onChange={(e) => setAdvJournalId(e.target.value)}
            data-testid="expenses-admin-adv-journal"
          />
          <input
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            placeholder={t("expenses.admin.cashAccountId")}
            value={advCashId}
            onChange={(e) => setAdvCashId(e.target.value)}
            data-testid="expenses-admin-adv-cash"
          />
          <input
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            placeholder={t("expenses.admin.advanceAccountId")}
            value={advAccountId}
            onChange={(e) => setAdvAccountId(e.target.value)}
            data-testid="expenses-admin-adv-account"
          />
          <Button
            type="button"
            size="sm"
            disabled={
              busy ||
              !advEmployeeId ||
              !advName.trim() ||
              !advAmount ||
              !advJournalId ||
              !advCashId ||
              !advAccountId
            }
            data-testid="expenses-admin-create-advance"
            onClick={() =>
              void run(async () => {
                await createAdvance.mutateAsync({
                  employeeId: BigInt(advEmployeeId),
                  name: advName.trim(),
                  amount: Number(advAmount),
                  currencyId: BigInt(advCurrencyId || "1"),
                  journalId: BigInt(advJournalId),
                  cashAccountId: BigInt(advCashId),
                  advanceAccountId: BigInt(advAccountId),
                  accountingDate: stbTimestampFromDate(new Date()),
                  clientRequestId: `adv-ui-${Date.now()}`,
                })
              }, t("expenses.admin.advanceCreated"))
            }
          >
            {t("expenses.admin.createAdvance")}
          </Button>
        </div>

        {advances.length > 0 ? (
          <ul className="text-xs space-y-1" data-testid="expenses-admin-advance-list">
            {advances.map((row) => (
              <li key={rowId(row)} className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                <span>#{rowId(row)}</span>
                <span>{String(row.name ?? "")}</span>
                <span>
                  {t("expenses.admin.residual")}: {Number(row.residual ?? 0).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">{t("expenses.admin.noAdvances")}</p>
        )}

        <div className="grid gap-2 sm:grid-cols-3">
          <input
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            placeholder={t("expenses.admin.advanceId")}
            value={applyAdvanceId}
            onChange={(e) => setApplyAdvanceId(e.target.value)}
            data-testid="expenses-admin-apply-advance-id"
          />
          <input
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            placeholder={t("expenses.admin.sheetId")}
            value={applySheetId}
            onChange={(e) => setApplySheetId(e.target.value)}
            data-testid="expenses-admin-apply-sheet-id"
          />
          <input
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            placeholder={t("expenses.admin.amount")}
            value={applyAmount}
            onChange={(e) => setApplyAmount(e.target.value)}
            data-testid="expenses-admin-apply-amount"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !applyAdvanceId || !applySheetId || !applyAmount}
            data-testid="expenses-admin-apply-advance"
            onClick={() =>
              void run(async () => {
                await applyAdvance.mutateAsync({
                  advanceId: applyAdvanceId,
                  sheetId: applySheetId,
                  amount: Number(applyAmount),
                })
              }, t("expenses.admin.advanceApplied"))
            }
          >
            {t("expenses.admin.applyAdvance")}
          </Button>
        </div>
      </section>

      {/* Policy exceptions */}
      <section className="space-y-2 border-t pt-3" data-testid="expenses-admin-exceptions">
        <h3 className="text-sm font-medium">{t("expenses.admin.exceptionsTitle")}</h3>
        <p className="text-xs text-muted-foreground">{t("expenses.admin.exceptionsDescription")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            placeholder={t("expenses.admin.expenseId")}
            value={excExpenseId}
            onChange={(e) => setExcExpenseId(e.target.value)}
            data-testid="expenses-admin-exc-expense"
          />
          <input
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            placeholder={t("expenses.admin.exceptionReason")}
            value={excReason}
            onChange={(e) => setExcReason(e.target.value)}
            data-testid="expenses-admin-exc-reason"
          />
          <Button
            type="button"
            size="sm"
            disabled={busy || !excExpenseId || !excReason.trim()}
            data-testid="expenses-admin-request-exception"
            onClick={() =>
              void run(async () => {
                await requestExc.mutateAsync({
                  expenseId: excExpenseId,
                  reason: excReason.trim(),
                })
              }, t("expenses.admin.exceptionRequested"))
            }
          >
            {t("expenses.admin.requestException")}
          </Button>
        </div>

        {exceptions.length > 0 ? (
          <ul className="space-y-2" data-testid="expenses-admin-exception-list">
            {exceptions.map((row) => {
              const id = rowId(row)
              return (
                <li
                  key={id}
                  className="flex flex-wrap items-center gap-2 text-xs border rounded-md p-2"
                >
                  <span className="font-medium">#{id}</span>
                  <span className="text-muted-foreground">
                    {t("expenses.admin.expenseId")}: {String(row.expenseId ?? row.expense_id ?? "")}
                  </span>
                  <span className="text-muted-foreground flex-1 min-w-[8rem]">
                    {String(row.reason ?? "")}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    data-testid={`expenses-admin-approve-exc-${id}`}
                    onClick={() =>
                      void run(async () => {
                        await approveExc.mutateAsync(id)
                      }, t("expenses.admin.exceptionApproved"))
                    }
                  >
                    {t("expenses.admin.approve")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || !rejectReason.trim()}
                    data-testid={`expenses-admin-reject-exc-${id}`}
                    onClick={() =>
                      void run(async () => {
                        await rejectExc.mutateAsync({
                          exceptionId: id,
                          reason: rejectReason.trim(),
                        })
                      }, t("expenses.admin.exceptionRejected"))
                    }
                  >
                    {t("expenses.admin.reject")}
                  </Button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">{t("expenses.admin.noExceptions")}</p>
        )}
        <input
          className="rounded-md border bg-background px-2 py-1.5 text-sm w-full max-w-md"
          placeholder={t("expenses.admin.rejectReason")}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          data-testid="expenses-admin-reject-reason"
        />
      </section>

      {/* Fraud hold */}
      <section className="space-y-2 border-t pt-3" data-testid="expenses-admin-fraud">
        <h3 className="text-sm font-medium">{t("expenses.admin.fraudTitle")}</h3>
        <p className="text-xs text-muted-foreground">{t("expenses.admin.fraudDescription")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            placeholder={t("expenses.admin.expenseId")}
            value={fraudExpenseId}
            onChange={(e) => setFraudExpenseId(e.target.value)}
            data-testid="expenses-admin-fraud-expense"
          />
          <input
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            placeholder={t("expenses.admin.fraudReason")}
            value={fraudReason}
            onChange={(e) => setFraudReason(e.target.value)}
            data-testid="expenses-admin-fraud-reason"
          />
          <Button
            type="button"
            size="sm"
            disabled={busy || !fraudExpenseId}
            data-testid="expenses-admin-set-fraud"
            onClick={() =>
              void run(async () => {
                await fraudHold.mutateAsync({
                  expenseId: fraudExpenseId,
                  fraudHold: true,
                  fraudReason: fraudReason.trim() || undefined,
                })
              }, t("expenses.admin.fraudSet"))
            }
          >
            {t("expenses.admin.setFraudHold")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !fraudExpenseId}
            data-testid="expenses-admin-clear-fraud"
            onClick={() =>
              void run(async () => {
                await fraudHold.mutateAsync({
                  expenseId: fraudExpenseId,
                  fraudHold: false,
                })
              }, t("expenses.admin.fraudCleared"))
            }
          >
            {t("expenses.admin.clearFraudHold")}
          </Button>
        </div>
      </section>
    </div>
  )
}

"use client"

import { useEffect, useMemo, useRef, useState } from "react"
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
import { useEmployees } from "@lumiere/query-hooks/hooks/hr"
import { useCurrencies } from "@lumiere/query-hooks/hooks/settings"
import { useAccountAccounts, useAccountJournals } from "@lumiere/query-hooks/hooks/accounting"
import { useExpenses, useExpenseSheets } from "@lumiere/query-hooks/hooks/expenses"
import { moduleCollection } from "@lumiere/ui/lib/module-data-state"
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice"
import { ExpenseRecordPicker } from "./expense-record-picker"
import { companyWorkflowRows, workflowOptions } from "./expense-workflow-model"
import { currencyOptionsFromRows } from "../../../lib/form-lookup"
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
  const employeeRead = moduleCollection(useEmployees(orgId))
  const expenseRead = moduleCollection(useExpenses(orgId))
  const reportRead = moduleCollection(useExpenseSheets(orgId))
  const journalRead = moduleCollection(useAccountJournals(orgId))
  const accountRead = moduleCollection(useAccountAccounts(orgId))
  const currencyRead = moduleCollection(useCurrencies())
  const advancesQ = moduleCollection(useExpenseAdvances(orgId))
  const exceptionsQ = moduleCollection(useExpensePolicyExceptions(orgId))
  const createAdvance = useCreateExpenseAdvance(orgId, companyId)
  const applyAdvance = useApplyExpenseAdvanceToSheet(orgId)
  const requestExc = useRequestExpensePolicyException(orgId)
  const approveExc = useApproveExpensePolicyException(orgId)
  const rejectExc = useRejectExpensePolicyException(orgId)
  const fraudHold = useSetExpenseFraudHold(orgId)

  const employeeOptions = workflowOptions(companyWorkflowRows(employeeRead.rows, orgId, companyId))
  const expenseOptions = workflowOptions(companyWorkflowRows(expenseRead.rows, orgId, companyId))
  const reportOptions = workflowOptions(companyWorkflowRows(reportRead.rows, orgId, companyId))
  const journalOptions = workflowOptions(companyWorkflowRows(journalRead.rows, orgId, companyId))
  const accountOptions = workflowOptions(companyWorkflowRows(accountRead.rows, orgId, companyId))
  const currencyOptions = currencyOptionsFromRows(currencyRead.rows)
  const sources = [employeeRead, expenseRead, reportRead, journalRead, accountRead, currencyRead, advancesQ, exceptionsQ]
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)

  const [advEmployeeId, setAdvEmployeeId] = useState("")
  const [advName, setAdvName] = useState("")
  const [advAmount, setAdvAmount] = useState("")
  const [advJournalId, setAdvJournalId] = useState("")
  const [advCashId, setAdvCashId] = useState("")
  const [advAccountId, setAdvAccountId] = useState("")
  const [advCurrencyId, setAdvCurrencyId] = useState("")
  const [applyAdvanceId, setApplyAdvanceId] = useState("")
  const [applySheetId, setApplySheetId] = useState("")
  const [applyAmount, setApplyAmount] = useState("")

  const [excExpenseId, setExcExpenseId] = useState("")
  const [excReason, setExcReason] = useState("")
  const [rejectReason, setRejectReason] = useState("")

  const [fraudExpenseId, setFraudExpenseId] = useState("")
  const [fraudReason, setFraudReason] = useState("")

  const advances = useMemo(() => {
    const rows = (companyWorkflowRows(advancesQ.rows, orgId, companyId))
    return rows.filter((r) => Number(r.residual ?? 0) > 0.0001)
  }, [advancesQ.rows, orgId, companyId])

  const exceptions = useMemo(
    () => (companyWorkflowRows(exceptionsQ.rows, orgId, companyId)),
    [exceptionsQ.rows, orgId, companyId],
  )

  const advanceReady = companyId > 0n && [employeeRead, journalRead, accountRead, currencyRead].every(source => source.state.status === "ready")
    && employeeOptions.some(option => option.value === advEmployeeId) && currencyOptions.some(option => option.value === advCurrencyId)
    && journalOptions.some(option => option.value === advJournalId) && accountOptions.some(option => option.value === advCashId)
    && accountOptions.some(option => option.value === advAccountId)
  const applyReady = advancesQ.state.status === "ready" && reportRead.state.status === "ready"
    && advances.some(row => String(row.id) === applyAdvanceId) && reportOptions.some(option => option.value === applySheetId)
  const expenseReady = expenseRead.state.status === "ready"
  const exceptionsReady = exceptionsQ.state.status === "ready"
  useEffect(() => {
    setAdvEmployeeId(""); setAdvCurrencyId(""); setAdvJournalId(""); setAdvCashId(""); setAdvAccountId("")
    setApplyAdvanceId(""); setApplySheetId(""); setExcExpenseId(""); setFraudExpenseId(""); setStatus(null)
  }, [orgId, companyId])

  const run = async (fn: () => Promise<void>, okMsg: string, ready: boolean) => {
    if (!ready || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setStatus(null)
    try {
      await fn()
      setStatus(okMsg)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const rowId = (row: { id?: unknown }) => String(row.id ?? "")

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

      {sources.map((source, index) => <ModuleDataNotice key={index} state={source.state} />)}
      {sources.some(source => source.state.status === "loading") && <p role="status">{t("common.loading")}</p>}
      {/* Advances */}
      <section className="space-y-2 border-t pt-3" data-testid="expenses-admin-advances">
        <h3 className="text-sm font-medium">{t("expenses.admin.advancesTitle")}</h3>
        <p className="text-xs text-muted-foreground">{t("expenses.admin.advancesDescription")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <ExpenseRecordPicker label={t("expenses.workflowUi.employee")} value={advEmployeeId} onChange={setAdvEmployeeId}
            options={employeeOptions} disabled={busy || employeeRead.state.status !== "ready"} testId="expenses-admin-adv-employee" />
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
          <ExpenseRecordPicker label={t("expenses.workflowUi.currency")} value={advCurrencyId} onChange={setAdvCurrencyId}
            options={currencyOptions} disabled={busy || currencyRead.state.status !== "ready"} />
          <ExpenseRecordPicker label={t("expenses.workflowUi.journal")} value={advJournalId} onChange={setAdvJournalId}
            options={journalOptions} disabled={busy || journalRead.state.status !== "ready"} testId="expenses-admin-adv-journal" />
          <ExpenseRecordPicker label={t("expenses.workflowUi.cashAccount")} value={advCashId} onChange={setAdvCashId}
            options={accountOptions} disabled={busy || accountRead.state.status !== "ready"} testId="expenses-admin-adv-cash" />
          <ExpenseRecordPicker label={t("expenses.workflowUi.advanceAccount")} value={advAccountId} onChange={setAdvAccountId}
            options={accountOptions} disabled={busy || accountRead.state.status !== "ready"} testId="expenses-admin-adv-account" />
          <Button
            type="button"
            size="sm"
            disabled={
              busy || !advanceReady ||
              !advEmployeeId ||
              !advName.trim() ||
              !advAmount ||
              !advCurrencyId ||
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
                  currencyId: BigInt(advCurrencyId),
                  journalId: BigInt(advJournalId),
                  cashAccountId: BigInt(advCashId),
                  advanceAccountId: BigInt(advAccountId),
                  accountingDate: stbTimestampFromDate(new Date()),
                  clientRequestId: `adv-ui-${Date.now()}`,
                })
              }, t("expenses.admin.advanceCreated"), advanceReady)
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
          <ExpenseRecordPicker label={t("expenses.workflowUi.advance")} value={applyAdvanceId} onChange={setApplyAdvanceId}
            options={workflowOptions(advances)} disabled={busy || advancesQ.state.status !== "ready"} testId="expenses-admin-apply-advance-id" />
          <ExpenseRecordPicker label={t("expenses.workflowUi.report")} value={applySheetId} onChange={setApplySheetId}
            options={reportOptions} disabled={busy || reportRead.state.status !== "ready"} testId="expenses-admin-apply-sheet-id" />
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
            disabled={busy || !applyReady || !applyAdvanceId || !applySheetId || !applyAmount}
            data-testid="expenses-admin-apply-advance"
            onClick={() =>
              void run(async () => {
                await applyAdvance.mutateAsync({
                  advanceId: applyAdvanceId,
                  sheetId: applySheetId,
                  amount: Number(applyAmount),
                })
              }, t("expenses.admin.advanceApplied"), applyReady)
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
          <ExpenseRecordPicker label={t("expenses.workflowUi.expense")} value={excExpenseId} onChange={setExcExpenseId}
            options={expenseOptions} disabled={busy || expenseRead.state.status !== "ready"} testId="expenses-admin-exc-expense" />
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
            disabled={busy || !expenseReady || !expenseOptions.some(option => option.value === excExpenseId) || !excExpenseId || !excReason.trim()}
            data-testid="expenses-admin-request-exception"
            onClick={() =>
              void run(async () => {
                await requestExc.mutateAsync({
                  expenseId: excExpenseId,
                  reason: excReason.trim(),
                })
              }, t("expenses.admin.exceptionRequested"), expenseReady && expenseOptions.some(option => option.value === excExpenseId))
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
                    {t("expenses.admin.expenseId")}: {String(row.expenseId ?? "")}
                  </span>
                  <span className="text-muted-foreground flex-1 min-w-[8rem]">
                    {String(row.reason ?? "")}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || !exceptionsReady}
                    data-testid={`expenses-admin-approve-exc-${id}`}
                    onClick={() =>
                      void run(async () => {
                        await approveExc.mutateAsync(id)
                      }, t("expenses.admin.exceptionApproved"), exceptionsReady)
                    }
                  >
                    {t("expenses.admin.approve")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || !exceptionsReady || !rejectReason.trim()}
                    data-testid={`expenses-admin-reject-exc-${id}`}
                    onClick={() =>
                      void run(async () => {
                        await rejectExc.mutateAsync({
                          exceptionId: id,
                          reason: rejectReason.trim(),
                        })
                      }, t("expenses.admin.exceptionRejected"), exceptionsReady)
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
          <ExpenseRecordPicker label={t("expenses.workflowUi.expense")} value={fraudExpenseId} onChange={setFraudExpenseId}
            options={expenseOptions} disabled={busy || expenseRead.state.status !== "ready"} testId="expenses-admin-fraud-expense" />
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
            disabled={busy || !expenseReady || !expenseOptions.some(option => option.value === fraudExpenseId) || !fraudExpenseId}
            data-testid="expenses-admin-set-fraud"
            onClick={() =>
              void run(async () => {
                await fraudHold.mutateAsync({
                  expenseId: fraudExpenseId,
                  fraudHold: true,
                  fraudReason: fraudReason.trim() || undefined,
                })
              }, t("expenses.admin.fraudSet"), expenseReady && expenseOptions.some(option => option.value === fraudExpenseId))
            }
          >
            {t("expenses.admin.setFraudHold")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !expenseReady || !expenseOptions.some(option => option.value === fraudExpenseId) || !fraudExpenseId}
            data-testid="expenses-admin-clear-fraud"
            onClick={() =>
              void run(async () => {
                await fraudHold.mutateAsync({
                  expenseId: fraudExpenseId,
                  fraudHold: false,
                })
              }, t("expenses.admin.fraudCleared"), expenseReady && expenseOptions.some(option => option.value === fraudExpenseId))
            }
          >
            {t("expenses.admin.clearFraudHold")}
          </Button>
        </div>
      </section>
    </div>
  )
}

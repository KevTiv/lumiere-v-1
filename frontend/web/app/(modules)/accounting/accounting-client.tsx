"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  EntityView,
  newJournalEntryForm,
  newTaxForm,
  newFiscalYearForm,
  editFiscalYearForm,
  fiscalYearsTableConfig,
  newAccountPeriodForm,
  editAccountPeriodForm,
  accountPeriodsTableConfig,
  newAnalyticLineForm,
  newAnalyticDistributionModelForm,
  newBankStatementLineForm,
  editBankStatementLineForm,
  newReconciliationWidgetForm,
  editReconciliationWidgetForm,
  reconciliationWidgetsTableConfig,
  editAnalyticAccountForm,
  editAnalyticLineForm,
  editAnalyticDistributionModelForm,
  MissingOrganization,
  mergeSelectOptionsByFieldName,
  mergeFieldDefaultValues,
  budgetsTableConfig,
  bankStatementsTableConfig,
  fixedAssetsTableConfig,
  intercompanyRulesTableConfig,
  intercompanyTransactionsTableConfig,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@lumiere/ui"
import { Input } from "@lumiere/ui/components/input"
import { Label } from "@lumiere/ui/components/label"
import type { EntityTableConfig, EntityViewConfig, FormConfig, ModuleConfig } from "@lumiere/ui"
import {
  accountingParamsToJson,
  analyticParamsToJson,
  toCreateAccountAccountParams,
  toCreateAccountMoveFromInvoiceModal,
  toCreateAccountTaxParams,
  toCreateCrossoveredBudgetParams,
  toCreateJournalEntryMoveParams,
  toCreateAnalyticAccountParams,
  toCreateAnalyticLineParams,
  toCreateAnalyticDistributionModelParams,
  toUpdateAnalyticAccountParams,
  toUpdateAnalyticLineParams,
  toUpdateAnalyticDistributionModelParams,
  toCreateAccountBankStatementLineParams,
  toUpdateAccountBankStatementLineParams,
  bankStatementLineParamsToJson,
  bankStatementTimestampToDateInput,
  toCreateAccountReconciliationWidgetParams,
  toUpdateAccountReconciliationWidgetParams,
  reconciliationWidgetParamsToJson,
  bankReconcileParamsToJson,
  toCreateAccountAccountTypeParams,
  toUpdateAccountAccountTypeParams,
  toCreateAccountGroupParams,
  toUpdateAccountGroupParams,
  fiscalYearStateTag,
  fiscalYearRowToFormDefaults,
  toCreateFiscalYearParams,
  toUpdateFiscalYearParams,
  accountPeriodStateTag,
  accountPeriodRowToFormDefaults,
  toCreateAccountPeriodParams,
  toUpdateAccountPeriodParams,
  toCreateIntercompanyRuleParams,
  intercompanyRuleParamsToJson,
  toCreateIntercompanyTransactionParams,
  intercompanyTransactionParamsToJson,
  toUpdateAccountMoveLineParams,
  updateAccountMoveLineParamsToJson,
} from "@/lib/accounting-create-params"
import { accountingModuleConfig } from "@/lib/module-dashboard-configs"
import {
  useAccountAccounts,
  useAccountMoves,
  useAccountTaxes,
  useCrossoveredBudgets,
  useAccountAnalyticAccounts,
  useAccountAnalyticLines,
  useAccountAnalyticDistributionModels,
  useAccountBankStatements,
  useAccountBankStatementLines,
  useAccountFixedAssets,
  useAccountJournals,
  useAccountAccountTypes,
  useAccountGroups,
  useCreateAccountAccount,
  useCreateAccountMove,
  useCreateAccountTax,
  useCreateCrossoveredBudget,
  usePostAccountMove,
  useCancelAccountMove,
  useCreateAnalyticAccount,
  useUpdateAnalyticAccount,
  useSetAnalyticAccountActive,
  useCreateAnalyticLine,
  useUpdateAnalyticLine,
  useDeleteAnalyticLine,
  useCreateAnalyticDistributionModel,
  useUpdateAnalyticDistributionModel,
  usePostAccountBankStatement,
  useDeleteAccountBankStatement,
  useCreateAccountBankStatementLine,
  useUpdateAccountBankStatementLine,
  useDeleteAccountBankStatementLine,
  useBankMatchCandidates,
  useMatchBankLine,
  useApplyReconciliationRules,
  useReconcileAccountBankStatementLine,
  useUnreconciledAccountBankStatementLine,
  useAccountReconciliationWidgets,
  useCreateAccountReconciliationWidget,
  useUpdateAccountReconciliationWidget,
  useDeleteAccountReconciliationWidget,
  useCreateAccountAccountType,
  useUpdateAccountAccountType,
  useCreateAccountGroup,
  useUpdateAccountGroup,
  useConsolidationAccounts,
  useConsolidationJournals,
  useConsolidationEliminationEntries,
  useCreateConsolidationAccount,
  useUpdateConsolidationAccount,
  useCreateConsolidationJournal,
  useCreateEliminationEntry,
  useProcessConsolidation,
  useValidateConsolidation,
  useCancelConsolidation,
  useMatchEliminationEntries,
  useUnmatchEliminationEntry,
  useAccountFiscalYears,
  useCreateFiscalYear,
  useUpdateFiscalYear,
  useDeleteFiscalYear,
  useOpenFiscalYear,
  useCloseFiscalYear,
  useAccountPeriods,
  useCreateAccountPeriod,
  useUpdateAccountPeriod,
  useDeleteAccountPeriod,
  useOpenAccountPeriod,
  useCloseAccountPeriod,
  useDepreciationLines,
  useDeleteAccountAsset,
  useConfirmAccountAsset,
  useCloseAccountAsset,
  useCreateDepreciationLine,
  useComputeDepreciationBoard,
  useIntercompanyRules,
  useIntercompanyTransactions,
  useCreateIntercompanyRule,
  useUpdateIntercompanyRule,
  useDeleteIntercompanyRule,
  useSetIntercompanyRuleActive,
  useCreateIntercompanyTransaction,
  useApproveIntercompanyTransaction,
  useProcessIntercompanyTransaction,
  useCompleteIntercompanyTransaction,
  useErrorIntercompanyTransaction,
  useCancelIntercompanyTransaction,
  useRetryIntercompanyTransaction,
  useUpdateAccountMoveLine,
  useReconcilePaymentWithInvoice,
} from "@/hooks/accounting"
import { accountJournalRowsToSelectOptions } from "@/lib/form-lookup"
import type { AccountMove } from "@/hooks/accounting"
import {
  InvoiceListView,
  InvoiceDetailModal,
  CreateInvoiceModal,
  BillsListView,
  ChartOfAccountsView,
  ChartStructureWorkspace,
  GeneralLedgerView,
  ConsolidationWorkspace,
} from "@lumiere/ui"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { Button } from "@lumiere/ui/components/button"
import { cn } from "@lumiere/ui/lib/utils"

function moveTypeTag(row: Record<string, unknown>): string {
  const v = row.moveType
  if (v != null && typeof v === "object" && "tag" in v) return String((v as { tag: string }).tag)
  return String(v ?? "")
}

function moveStateStr(row: Record<string, unknown>): string {
  const v = row.state
  if (v != null && typeof v === "object" && "tag" in v) return String((v as { tag: string }).tag)
  return String(v ?? "")
}

function budgetStateStr(row: Record<string, unknown>): string {
  const v = row.state
  if (v != null && typeof v === "object" && "tag" in v) return String((v as { tag: string }).tag)
  return String(v ?? "")
}

function bankStatementStateStr(row: Record<string, unknown>): string {
  const v = row.state
  if (v != null && typeof v === "object" && "tag" in v) return String((v as { tag: string }).tag)
  return String(v ?? "")
}

function assetStateTag(row: Record<string, unknown>): string {
  const v = row.state
  if (v != null && typeof v === "object" && "tag" in v) return String((v as { tag: string }).tag)
  return String(v ?? "")
}

function parseOptionalRuleId(s: string): number | null {
  const x = s.trim()
  if (x === "") return null
  const n = Number(x)
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null
}

function moveLineIdsFromRow(line: Record<string, unknown>): bigint[] {
  const raw = line.moveIds
  if (!Array.isArray(raw)) return []
  return raw.map((id) => BigInt(String(id)))
}

interface AccountingClientProps {
  initialAccounts?: Record<string, unknown>[]
  initialMoves?: Record<string, unknown>[]
  initialTaxes?: Record<string, unknown>[]
  initialBudgets?: Record<string, unknown>[]
  initialAnalytic?: Record<string, unknown>[]
  initialJournals?: Record<string, unknown>[]
  initialFiscalYears?: Record<string, unknown>[]
  initialAccountPeriods?: Record<string, unknown>[]
  organizationId?: number
}

type AccountingClientLoadedProps = Omit<AccountingClientProps, "organizationId"> & {
  organizationId: number
}

export function AccountingClient(props: AccountingClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <AccountingClientLoaded {...props} organizationId={props.organizationId} />
}

function AccountingClientLoaded({
  initialAccounts,
  initialMoves,
  initialTaxes,
  initialBudgets,
  initialAnalytic,
  initialJournals,
  initialFiscalYears,
  initialAccountPeriods,
  organizationId,
}: AccountingClientLoadedProps) {
  const { t } = useTranslation()
  const moduleConfigBase = useMemo(() => accountingModuleConfig(t), [t])
  const { companyId } = orgBigInts(organizationId)

  // Quick-action form modal (dashboard tab)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  // Invoice detail modal
  const [selectedInvoice, setSelectedInvoice] = useState<AccountMove | null>(null)
  // Create invoice / bill modals
  const [showCreateInvoice, setShowCreateInvoice] = useState(false)
  const [showCreateBill, setShowCreateBill] = useState(false)
  // Analytic row editors (click row on Analytic tabs)
  const [analyticAccountEdit, setAnalyticAccountEdit] = useState<Record<string, unknown> | null>(null)
  const [analyticLineEdit, setAnalyticLineEdit] = useState<Record<string, unknown> | null>(null)
  const [analyticDistEdit, setAnalyticDistEdit] = useState<Record<string, unknown> | null>(null)
  const [bankStatementDetail, setBankStatementDetail] = useState<Record<string, unknown> | null>(null)
  const [bankLineCreateOpen, setBankLineCreateOpen] = useState(false)
  const [bankLineEdit, setBankLineEdit] = useState<Record<string, unknown> | null>(null)
  const [bankLineMatchFocus, setBankLineMatchFocus] = useState<Record<string, unknown> | null>(null)
  const [reconciliationRuleIdInput, setReconciliationRuleIdInput] = useState("")
  const [manualReconcileMoveIds, setManualReconcileMoveIds] = useState("")
  const [manualReconcileResidual, setManualReconcileResidual] = useState("0")
  const [reconciliationWidgetEdit, setReconciliationWidgetEdit] = useState<Record<string, unknown> | null>(null)
  const [fiscalYearEdit, setFiscalYearEdit] = useState<Record<string, unknown> | null>(null)
  const [accountPeriodEdit, setAccountPeriodEdit] = useState<Record<string, unknown> | null>(null)

  // ── Data hooks ──────────────────────────────────────────────────────────────
  const { data: accounts = [] } = useAccountAccounts(companyId, { enabled: !!companyId })
  const { data: allMoves = [] } = useAccountMoves(companyId, { enabled: !!companyId })
  const { data: taxes = [] } = useAccountTaxes(companyId, { enabled: !!companyId })
  const { data: budgets = [] } = useCrossoveredBudgets(companyId, { enabled: !!companyId })
  const { data: analytic = [] } = useAccountAnalyticAccounts(companyId, { enabled: !!companyId })
  const { data: analyticLines = [] } = useAccountAnalyticLines(companyId, { enabled: !!companyId })
  const { data: analyticDistribution = [] } = useAccountAnalyticDistributionModels(companyId, {
    enabled: !!companyId,
  })
  const { data: bankStatements = [] } = useAccountBankStatements(companyId, { enabled: !!companyId })
  const { data: bankStatementLines = [] } = useAccountBankStatementLines(companyId, { enabled: !!companyId })
  const { data: bankMatchCandidates = [] } = useBankMatchCandidates(companyId, { enabled: !!companyId })
  const { data: reconciliationWidgets = [] } = useAccountReconciliationWidgets(companyId, { enabled: !!companyId })
  const { data: fixedAssets = [] } = useAccountFixedAssets(companyId, { enabled: !!companyId })
  const { data: depreciationLines = [] } = useDepreciationLines(companyId, { enabled: !!companyId })
  const { data: intercompanyRules = [] } = useIntercompanyRules(companyId, { enabled: !!companyId })
  const { data: intercompanyTransactions = [] } = useIntercompanyTransactions(companyId, { enabled: !!companyId })
  const { data: journals = [] } = useAccountJournals(companyId, { enabled: !!companyId })
  const { data: accountTypes = [] } = useAccountAccountTypes(companyId, { enabled: !!companyId })
  const { data: accountGroups = [] } = useAccountGroups(companyId, { enabled: !!companyId })
  const { data: consolidationAccounts = [] } = useConsolidationAccounts(companyId, {
    enabled: !!companyId,
  })
  const { data: consolidationJournals = [] } = useConsolidationJournals(companyId, {
    enabled: !!companyId,
  })
  const { data: eliminationEntries = [] } = useConsolidationEliminationEntries(companyId, {
    enabled: !!companyId,
  })
  const { data: fiscalYearsRaw = [] } = useAccountFiscalYears(companyId, {
    enabled: !!companyId,
    initialData: initialFiscalYears,
  })
  const { data: accountPeriodsRaw = [] } = useAccountPeriods(companyId, {
    enabled: !!companyId,
    initialData: initialAccountPeriods,
  })

  const createFiscalYear = useCreateFiscalYear(organizationId, companyId)
  const updateFiscalYear = useUpdateFiscalYear(organizationId, companyId)
  const deleteFiscalYear = useDeleteFiscalYear(organizationId, companyId)
  const openFiscalYear = useOpenFiscalYear(organizationId, companyId)
  const closeFiscalYear = useCloseFiscalYear(organizationId, companyId)

  const createAccountPeriod = useCreateAccountPeriod(organizationId, companyId)
  const updateAccountPeriod = useUpdateAccountPeriod(organizationId, companyId)
  const deleteAccountPeriod = useDeleteAccountPeriod(organizationId, companyId)
  const openAccountPeriod = useOpenAccountPeriod(organizationId, companyId)
  const closeAccountPeriod = useCloseAccountPeriod(organizationId, companyId)

  const fiscalYearNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const fy of fiscalYearsRaw as Record<string, unknown>[]) {
      m.set(String(fy.id ?? ""), String(fy.name ?? fy.id ?? ""))
    }
    return m
  }, [fiscalYearsRaw])

  const fiscalYearsDisplay = useMemo(
    () =>
      (fiscalYearsRaw as Record<string, unknown>[]).map((row) => ({
        ...row,
        stateLabel: fiscalYearStateTag(row),
      })),
    [fiscalYearsRaw],
  )

  const accountPeriodsDisplay = useMemo(
    () =>
      (accountPeriodsRaw as Record<string, unknown>[]).map((row) => ({
        ...row,
        stateLabel: accountPeriodStateTag(row),
        fiscalYearLabel:
          fiscalYearNameById.get(String(row.fiscalYearId ?? "")) ?? String(row.fiscalYearId ?? ""),
      })),
    [accountPeriodsRaw, fiscalYearNameById],
  )

  const fiscalYearSelectOptionsForPeriods = useMemo(() => {
    const rows = fiscalYearsRaw as Record<string, unknown>[]
    if (rows.length === 0) {
      return [
        {
          value: "",
          label: t("accounting.forms.accountPeriod.fields.fiscalYearPlaceholder"),
          disabled: true,
        },
      ]
    }
    return rows.map((fy) => ({
      value: String(fy.id ?? ""),
      label: String(fy.name ?? fy.id ?? ""),
    }))
  }, [fiscalYearsRaw, t])

  const accountPeriodCreateFormConfig = useMemo(
    () =>
      mergeSelectOptionsByFieldName(
        newAccountPeriodForm(t),
        "fiscalYearId",
        fiscalYearSelectOptionsForPeriods,
      ),
    [t, fiscalYearSelectOptionsForPeriods],
  )

  const journalRowsAsSelectOptions = useMemo(
    () => accountJournalRowsToSelectOptions(journals),
    [journals],
  )

  const journalFieldOptionsForModularForm = useMemo(() => {
    if (journalRowsAsSelectOptions.length > 0) return journalRowsAsSelectOptions
    return [{ value: "", label: t("common.lookup.noJournals"), disabled: true }]
  }, [journalRowsAsSelectOptions, t])

  const glAccountSelectOptions = useMemo(
    () =>
      accounts.map((a) => ({
        value: String(a.id),
        label: `${a.code != null && String(a.code).trim() !== "" ? `${String(a.code)} — ` : ""}${String(a.name ?? "")}`,
      })),
    [accounts],
  )

  const glAccountFieldOptions = useMemo(() => {
    if (glAccountSelectOptions.length > 0) return glAccountSelectOptions
    return [{ value: "", label: t("common.noData"), disabled: true }]
  }, [glAccountSelectOptions, t])

  const journalEntryFormConfig = useMemo(
    () =>
      mergeSelectOptionsByFieldName(newJournalEntryForm(t), "journalId", journalFieldOptionsForModularForm),
    [t, journalFieldOptionsForModularForm],
  )

  const defaultCurrencyId = useMemo(() => {
    const cid = accounts.find((a) => a.currencyId != null)?.currencyId
    return cid != null ? BigInt(String(cid)) : 1n
  }, [accounts])

  const analyticAccountSelectOptions = useMemo(
    () =>
      analytic.map((a) => ({
        value: String(a.id),
        label: `${a.code != null && String(a.code).trim() !== "" ? `${String(a.code)} — ` : ""}${String(a.name ?? "")}`,
      })),
    [analytic],
  )

  const analyticAccountFieldOptions = useMemo(() => {
    if (analyticAccountSelectOptions.length > 0) return analyticAccountSelectOptions
    return [{ value: "", label: t("common.lookup.noAnalyticAccounts"), disabled: true }]
  }, [analyticAccountSelectOptions, t])

  const analyticLineFormConfig = useMemo(
    () => mergeSelectOptionsByFieldName(newAnalyticLineForm(t), "accountId", analyticAccountFieldOptions),
    [t, analyticAccountFieldOptions],
  )

  const analyticDistFormConfig = useMemo(
    () =>
      mergeSelectOptionsByFieldName(
        newAnalyticDistributionModelForm(t),
        "analyticAccountId",
        analyticAccountFieldOptions,
      ),
    [t, analyticAccountFieldOptions],
  )

  // ── Mutations ───────────────────────────────────────────────────────────────
  const createAccount = useCreateAccountAccount()
  const createAccountType = useCreateAccountAccountType(organizationId)
  const updateAccountType = useUpdateAccountAccountType(organizationId)
  const createAccountGroup = useCreateAccountGroup(organizationId)
  const updateAccountGroup = useUpdateAccountGroup(organizationId)
  const createMove = useCreateAccountMove()
  const createTax = useCreateAccountTax()
  const createBudget = useCreateCrossoveredBudget(organizationId)
  const postMove = usePostAccountMove()
  const cancelMove = useCancelAccountMove()
  const createAnalyticAccount = useCreateAnalyticAccount(organizationId)
  const updateAnalyticAccount = useUpdateAnalyticAccount(organizationId)
  const setAnalyticAccountActive = useSetAnalyticAccountActive(organizationId)
  const createAnalyticLine = useCreateAnalyticLine(organizationId)
  const updateAnalyticLine = useUpdateAnalyticLine(organizationId)
  const deleteAnalyticLine = useDeleteAnalyticLine(organizationId)
  const createAnalyticDistributionModel = useCreateAnalyticDistributionModel(organizationId)
  const updateAnalyticDistributionModel = useUpdateAnalyticDistributionModel(organizationId)
  const postBankStatement = usePostAccountBankStatement(organizationId)
  const deleteBankStatement = useDeleteAccountBankStatement(organizationId)
  const createBankStatementLine = useCreateAccountBankStatementLine(organizationId)
  const updateBankStatementLine = useUpdateAccountBankStatementLine(organizationId)
  const deleteBankStatementLine = useDeleteAccountBankStatementLine(organizationId)
  const matchBankLine = useMatchBankLine(organizationId)
  const applyReconciliationRules = useApplyReconciliationRules(organizationId)
  const reconcileBankLine = useReconcileAccountBankStatementLine(organizationId)
  const unreconcileBankLine = useUnreconciledAccountBankStatementLine(organizationId)
  const createReconciliationWidget = useCreateAccountReconciliationWidget(organizationId)
  const updateReconciliationWidget = useUpdateAccountReconciliationWidget(organizationId)
  const deleteReconciliationWidget = useDeleteAccountReconciliationWidget(organizationId)
  const createConsolidationAccount = useCreateConsolidationAccount(organizationId)
  const updateConsolidationAccount = useUpdateConsolidationAccount(organizationId)
  const createConsolidationJournal = useCreateConsolidationJournal(organizationId)
  const createEliminationEntry = useCreateEliminationEntry(organizationId)
  const processConsolidation = useProcessConsolidation(organizationId)
  const validateConsolidation = useValidateConsolidation(organizationId)
  const cancelConsolidation = useCancelConsolidation(organizationId)
  const matchEliminationEntries = useMatchEliminationEntries(organizationId)
  const unmatchEliminationEntry = useUnmatchEliminationEntry(organizationId)

  const deleteAccountAsset = useDeleteAccountAsset(organizationId, companyId)
  const confirmAccountAsset = useConfirmAccountAsset(organizationId, companyId)
  const closeAccountAsset = useCloseAccountAsset(organizationId, companyId)
  const createDepreciationLine = useCreateDepreciationLine(organizationId, companyId)
  const computeDepreciationBoard = useComputeDepreciationBoard(organizationId, companyId)

  const createIntercompanyRule = useCreateIntercompanyRule(organizationId)
  const updateIntercompanyRule = useUpdateIntercompanyRule(organizationId, companyId)
  const deleteIntercompanyRule = useDeleteIntercompanyRule(organizationId, companyId)
  const setIntercompanyRuleActive = useSetIntercompanyRuleActive(organizationId, companyId)
  const createIntercompanyTransaction = useCreateIntercompanyTransaction(organizationId)
  const approveIntercompanyTransaction = useApproveIntercompanyTransaction(organizationId, companyId)
  const processIntercompanyTransaction = useProcessIntercompanyTransaction(organizationId, companyId)
  const completeIntercompanyTransaction = useCompleteIntercompanyTransaction(organizationId, companyId)
  const errorIntercompanyTransaction = useErrorIntercompanyTransaction(organizationId, companyId)
  const cancelIntercompanyTransaction = useCancelIntercompanyTransaction(organizationId, companyId)
  const retryIntercompanyTransaction = useRetryIntercompanyTransaction(organizationId, companyId)

  const updateAccountMoveLine = useUpdateAccountMoveLine(organizationId, companyId)
  const reconcilePaymentWithInvoice = useReconcilePaymentWithInvoice(organizationId, companyId)

  const analyticAccountEditFormConfig = useMemo(() => {
    const base = editAnalyticAccountForm(t)
    if (!analyticAccountEdit) return base
    return mergeFieldDefaultValues(base, {
      accountId: String(analyticAccountEdit.id ?? ""),
      name: String(analyticAccountEdit.name ?? ""),
      code: analyticAccountEdit.code != null ? String(analyticAccountEdit.code) : "",
      isRequiredInMoveLines: Boolean(analyticAccountEdit.isRequiredInMoveLines),
      active: Boolean(analyticAccountEdit.active),
    })
  }, [analyticAccountEdit, t])

  const analyticLineEditFormConfig = useMemo(() => {
    const base = editAnalyticLineForm(t)
    if (!analyticLineEdit) return base
    return mergeFieldDefaultValues(base, {
      lineId: String(analyticLineEdit.id ?? ""),
      name: String(analyticLineEdit.name ?? ""),
      amount: Number(analyticLineEdit.amount ?? 0),
    })
  }, [analyticLineEdit, t])

  const analyticDistEditFormConfig = useMemo(() => {
    const base = editAnalyticDistributionModelForm(t)
    if (!analyticDistEdit) return base
    return mergeFieldDefaultValues(base, {
      modelId: String(analyticDistEdit.id ?? ""),
      name:
        analyticDistEdit.name != null && String(analyticDistEdit.name).trim() !== ""
          ? String(analyticDistEdit.name)
          : "",
      analyticDistribution: String(analyticDistEdit.analyticDistribution ?? "[]"),
      isActive: Boolean(analyticDistEdit.isActive),
    })
  }, [analyticDistEdit, t])

  const fiscalYearEditFormConfig = useMemo(() => {
    const base = editFiscalYearForm(t)
    if (!fiscalYearEdit) return base
    return mergeFieldDefaultValues(base, fiscalYearRowToFormDefaults(fiscalYearEdit))
  }, [fiscalYearEdit, t])

  const accountPeriodEditFormConfig = useMemo(() => {
    const base = editAccountPeriodForm(t)
    if (!accountPeriodEdit) return base
    return mergeFieldDefaultValues(base, accountPeriodRowToFormDefaults(accountPeriodEdit))
  }, [accountPeriodEdit, t])

  const bankStatementsEntityConfig = useMemo(() => bankStatementsTableConfig(t), [t])

  const detailStatementLines = useMemo(() => {
    if (!bankStatementDetail?.id) return []
    const sid = String(bankStatementDetail.id)
    return bankStatementLines.filter((l) => String(l.statementId) === sid)
  }, [bankStatementDetail, bankStatementLines])

  const statementBalancesMatch = useMemo(() => {
    if (!bankStatementDetail) return false
    const end = Number(bankStatementDetail.balanceEnd ?? 0)
    const real = Number(bankStatementDetail.balanceEndReal ?? 0)
    return Math.abs(end - real) <= 0.01
  }, [bankStatementDetail])

  const newBankStatementLineFormConfig = useMemo(() => {
    if (!bankStatementDetail?.id) {
      return newBankStatementLineForm(t, { statementId: "", defaultCurrencyId: "1" })
    }
    const stCur =
      bankStatementDetail.currencyId != null
        ? String(bankStatementDetail.currencyId)
        : defaultCurrencyId.toString()
    return newBankStatementLineForm(t, {
      statementId: String(bankStatementDetail.id),
      defaultCurrencyId: stCur,
    })
  }, [bankStatementDetail, defaultCurrencyId, t])

  const reconciliationWidgetCreateFormConfig = useMemo(
    () => mergeSelectOptionsByFieldName(newReconciliationWidgetForm(t), "accountId", glAccountFieldOptions),
    [t, glAccountFieldOptions],
  )

  const reconciliationWidgetsEntityConfig = useMemo(() => reconciliationWidgetsTableConfig(t), [t])

  const reconciliationWidgetEditFormConfig = useMemo(() => {
    const empty: Parameters<typeof editReconciliationWidgetForm>[1] = {
      widgetId: "",
      accountId: "",
      partnerId: "",
      mode: "bank",
      moveLineIds: "",
      toCheck: false,
    }
    if (!reconciliationWidgetEdit) return editReconciliationWidgetForm(t, empty)
    const ml = reconciliationWidgetEdit.moveLineIds
    const moveLineIds = Array.isArray(ml) ? ml.map((x) => String(x)).join(", ") : ""
    return mergeSelectOptionsByFieldName(
      editReconciliationWidgetForm(t, {
        widgetId: String(reconciliationWidgetEdit.id ?? ""),
        accountId: String(reconciliationWidgetEdit.accountId ?? ""),
        partnerId:
          reconciliationWidgetEdit.partnerId != null ? String(reconciliationWidgetEdit.partnerId) : "",
        mode: String(reconciliationWidgetEdit.mode ?? "bank"),
        moveLineIds,
        toCheck: Boolean(reconciliationWidgetEdit.toCheck),
      }),
      "accountId",
      glAccountFieldOptions,
    )
  }, [reconciliationWidgetEdit, t, glAccountFieldOptions])

  const matchCandidatesForFocusedLine = useMemo(() => {
    if (!bankLineMatchFocus?.id) return []
    const lid = String(bankLineMatchFocus.id)
    return bankMatchCandidates.filter((c) => String(c.statementLineId) === lid)
  }, [bankLineMatchFocus, bankMatchCandidates])

  useEffect(() => {
    if (bankLineMatchFocus?.id != null) {
      setManualReconcileResidual(String(bankLineMatchFocus.amount ?? 0))
      setManualReconcileMoveIds("")
    }
  }, [bankLineMatchFocus?.id])

  const editBankStatementLineFormConfig = useMemo(() => {
    const empty = {
      lineId: "",
      date: "",
      amount: 0,
      amountCurrency: 0,
      accountNumber: "",
      transactionType: "",
    }
    if (!bankLineEdit) return editBankStatementLineForm(t, empty)
    return editBankStatementLineForm(t, {
      lineId: String(bankLineEdit.id ?? ""),
      date: bankStatementTimestampToDateInput(bankLineEdit.date),
      amount: Number(bankLineEdit.amount ?? 0),
      amountCurrency: Number(bankLineEdit.amountCurrency ?? bankLineEdit.amount ?? 0),
      accountNumber: bankLineEdit.accountNumber != null ? String(bankLineEdit.accountNumber) : "",
      transactionType: bankLineEdit.transactionType != null ? String(bankLineEdit.transactionType) : "",
    })
  }, [bankLineEdit, t])

  const onSubmitAnalyticAccountEdit = useCallback(
    async (formData: Record<string, unknown>) => {
      const idRaw = formData.accountId
      if (idRaw === "" || idRaw == null) return
      const id = BigInt(String(idRaw))
      const prevActive = analyticAccountEdit?.active === true
      const nextActive = Boolean(formData.active)
      const params = toUpdateAnalyticAccountParams({
        name: formData.name,
        code: formData.code,
        isRequiredInMoveLines: formData.isRequiredInMoveLines,
      })
      await updateAnalyticAccount.mutateAsync({
        accountId: id,
        params: analyticParamsToJson(params),
      })
      if (nextActive !== prevActive) {
        await setAnalyticAccountActive.mutateAsync({ accountId: id, active: nextActive })
      }
      setAnalyticAccountEdit(null)
    },
    [analyticAccountEdit, updateAnalyticAccount, setAnalyticAccountActive],
  )

  const onSubmitAnalyticLineEdit = useCallback(
    async (formData: Record<string, unknown>) => {
      const lineIdRaw = formData.lineId
      if (lineIdRaw === "" || lineIdRaw == null) return
      const id = BigInt(String(lineIdRaw))
      const params = toUpdateAnalyticLineParams({
        name: formData.name,
        amount: formData.amount,
        unitAmount: formData.amount,
      })
      await updateAnalyticLine.mutateAsync({
        lineId: id,
        params: analyticParamsToJson(params),
      })
      setAnalyticLineEdit(null)
    },
    [updateAnalyticLine],
  )

  const onSubmitAnalyticDistEdit = useCallback(
    async (formData: Record<string, unknown>) => {
      const modelIdRaw = formData.modelId
      if (modelIdRaw === "" || modelIdRaw == null) return
      const id = BigInt(String(modelIdRaw))
      const params = toUpdateAnalyticDistributionModelParams({
        name: formData.name,
        analyticDistribution: formData.analyticDistribution,
        isActive: formData.isActive,
      })
      await updateAnalyticDistributionModel.mutateAsync({
        modelId: id,
        params: analyticParamsToJson(params),
      })
      setAnalyticDistEdit(null)
    },
    [updateAnalyticDistributionModel],
  )

  const onSubmitNewBankStatementLine = useCallback(
    async (formData: Record<string, unknown>) => {
      const sidRaw = formData.statementId
      if (sidRaw === "" || sidRaw == null) return
      const params = toCreateAccountBankStatementLineParams(formData)
      if (!params) return
      await createBankStatementLine.mutateAsync({
        statementId: BigInt(String(sidRaw)),
        params: bankStatementLineParamsToJson(params),
      })
      setBankLineCreateOpen(false)
    },
    [createBankStatementLine],
  )

  const onSubmitEditBankStatementLine = useCallback(
    async (formData: Record<string, unknown>) => {
      const lineIdRaw = formData.lineId
      if (lineIdRaw === "" || lineIdRaw == null) return
      const params = toUpdateAccountBankStatementLineParams(formData)
      await updateBankStatementLine.mutateAsync({
        lineId: BigInt(String(lineIdRaw)),
        params,
      })
      setBankLineEdit(null)
    },
    [updateBankStatementLine],
  )

  const onSubmitReconciliationWidgetEdit = useCallback(
    async (formData: Record<string, unknown>) => {
      const wid = formData.widgetId
      if (wid === "" || wid == null) return
      const params = toUpdateAccountReconciliationWidgetParams(formData)
      if (!params) return
      await updateReconciliationWidget.mutateAsync({
        widgetId: BigInt(String(wid)),
        params,
      })
      setReconciliationWidgetEdit(null)
    },
    [updateReconciliationWidget],
  )

  const onSubmitFiscalYearEdit = useCallback(
    async (formData: Record<string, unknown>) => {
      const id = formData.fiscalYearId
      if (id == null || String(id).trim() === "") return
      const params = toUpdateFiscalYearParams(formData)
      await updateFiscalYear.mutateAsync({
        fiscalYearId: BigInt(String(id)),
        params,
      })
      setFiscalYearEdit(null)
    },
    [updateFiscalYear],
  )

  const onSubmitAccountPeriodEdit = useCallback(
    async (formData: Record<string, unknown>) => {
      const id = formData.accountPeriodId
      if (id == null || String(id).trim() === "") return
      const params = toUpdateAccountPeriodParams(formData)
      await updateAccountPeriod.mutateAsync({
        periodId: BigInt(String(id)),
        params,
      })
      setAccountPeriodEdit(null)
    },
    [updateAccountPeriod],
  )

  const budgetsEntityConfig = useMemo((): EntityViewConfig => {
    const view = budgetsTableConfig.view as EntityTableConfig
    return {
      ...budgetsTableConfig,
      view: {
        ...view,
        actions: [],
      },
    }
  }, [t])

  const fiscalYearsEntityConfig = useMemo((): EntityViewConfig => {
    const base = fiscalYearsTableConfig(t)
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: "fy-open",
            label: t("accounting.entities.fiscalYears.actions.openSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                if (fiscalYearStateTag(r as Record<string, unknown>) === "Draft") {
                  void openFiscalYear.mutateAsync(BigInt(String(r.id)))
                }
              }
            },
          },
          {
            id: "fy-close",
            label: t("accounting.entities.fiscalYears.actions.closeSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                if (fiscalYearStateTag(r as Record<string, unknown>) === "Running") {
                  void closeFiscalYear.mutateAsync(BigInt(String(r.id)))
                }
              }
            },
          },
          {
            id: "fy-delete",
            label: t("accounting.entities.fiscalYears.actions.deleteSelected"),
            requiresSelection: true,
            variant: "destructive",
            onClick: (rows) => {
              for (const r of rows) {
                if (fiscalYearStateTag(r as Record<string, unknown>) === "Draft") {
                  void deleteFiscalYear.mutateAsync(BigInt(String(r.id)))
                }
              }
            },
          },
        ],
      },
    }
  }, [t, openFiscalYear, closeFiscalYear, deleteFiscalYear])

  const accountPeriodsEntityConfig = useMemo((): EntityViewConfig => {
    const base = accountPeriodsTableConfig(t)
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: "ap-open",
            label: t("accounting.entities.accountPeriods.actions.openSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                if (accountPeriodStateTag(r as Record<string, unknown>) === "Draft") {
                  void openAccountPeriod.mutateAsync(BigInt(String(r.id)))
                }
              }
            },
          },
          {
            id: "ap-close",
            label: t("accounting.entities.accountPeriods.actions.closeSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                if (accountPeriodStateTag(r as Record<string, unknown>) === "Open") {
                  void closeAccountPeriod.mutateAsync(BigInt(String(r.id)))
                }
              }
            },
          },
          {
            id: "ap-delete",
            label: t("accounting.entities.accountPeriods.actions.deleteSelected"),
            requiresSelection: true,
            variant: "destructive",
            onClick: (rows) => {
              for (const r of rows) {
                if (accountPeriodStateTag(r as Record<string, unknown>) !== "Closed") {
                  void deleteAccountPeriod.mutateAsync(BigInt(String(r.id)))
                }
              }
            },
          },
        ],
      },
    }
  }, [t, openAccountPeriod, closeAccountPeriod, deleteAccountPeriod])

  const fixedAssetsEntityConfig = useMemo((): EntityViewConfig => {
    const base = fixedAssetsTableConfig(t)
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: "asset-confirm",
            label: t("accounting.entities.fixedAssets.actions.confirmSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                if (assetStateTag(r as Record<string, unknown>) === "Draft") {
                  void confirmAccountAsset.mutateAsync(BigInt(String(r.id)))
                }
              }
            },
          },
          {
            id: "asset-close",
            label: t("accounting.entities.fixedAssets.actions.closeSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                if (assetStateTag(r as Record<string, unknown>) === "Open") {
                  void closeAccountAsset.mutateAsync(BigInt(String(r.id)))
                }
              }
            },
          },
          {
            id: "asset-compute-depreciation",
            label: t("accounting.entities.fixedAssets.actions.computeDepreciation"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                void computeDepreciationBoard.mutateAsync(BigInt(String(r.id)))
              }
            },
          },
          {
            id: "asset-delete",
            label: t("accounting.entities.fixedAssets.actions.deleteSelected"),
            requiresSelection: true,
            variant: "destructive",
            onClick: (rows) => {
              for (const r of rows) {
                if (assetStateTag(r as Record<string, unknown>) === "Draft") {
                  void deleteAccountAsset.mutateAsync(BigInt(String(r.id)))
                }
              }
            },
          },
        ],
      },
    }
  }, [t, confirmAccountAsset, closeAccountAsset, deleteAccountAsset, computeDepreciationBoard])

  // Helper to get intercompany rule active state
  const intercompanyRuleIsActive = (row: Record<string, unknown>): boolean => {
    return row.isActive === true
  }

  const intercompanyRulesEntityConfig = useMemo((): EntityViewConfig => {
    const base = intercompanyRulesTableConfig(t)
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: "ic-rule-activate",
            label: t("accounting.entities.intercompanyRules.actions.activateSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                if (!intercompanyRuleIsActive(r as Record<string, unknown>)) {
                  void setIntercompanyRuleActive.mutateAsync({
                    ruleId: BigInt(String(r.id)),
                    isActive: true,
                  })
                }
              }
            },
          },
          {
            id: "ic-rule-deactivate",
            label: t("accounting.entities.intercompanyRules.actions.deactivateSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                if (intercompanyRuleIsActive(r as Record<string, unknown>)) {
                  void setIntercompanyRuleActive.mutateAsync({
                    ruleId: BigInt(String(r.id)),
                    isActive: false,
                  })
                }
              }
            },
          },
          {
            id: "ic-rule-delete",
            label: t("accounting.entities.intercompanyRules.actions.deleteSelected"),
            requiresSelection: true,
            variant: "destructive",
            onClick: (rows) => {
              for (const r of rows) {
                void deleteIntercompanyRule.mutateAsync(BigInt(String(r.id)))
              }
            },
          },
        ],
      },
    }
  }, [t, setIntercompanyRuleActive, deleteIntercompanyRule])

  // Helper to get intercompany transaction state
  const intercompanyTransactionState = (row: Record<string, unknown>): string => {
    const v = row.state
    if (v != null && typeof v === "object" && "tag" in v) return String((v as { tag: string }).tag)
    return String(v ?? "")
  }

  const intercompanyTransactionsEntityConfig = useMemo((): EntityViewConfig => {
    const base = intercompanyTransactionsTableConfig(t)
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: "ic-tx-approve",
            label: t("accounting.entities.intercompanyTransactions.actions.approveSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                const state = intercompanyTransactionState(r as Record<string, unknown>)
                if (state === "Pending" || state === "Draft") {
                  void approveIntercompanyTransaction.mutateAsync(BigInt(String(r.id)))
                }
              }
            },
          },
          {
            id: "ic-tx-process",
            label: t("accounting.entities.intercompanyTransactions.actions.processSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                const state = intercompanyTransactionState(r as Record<string, unknown>)
                if (state === "Approved") {
                  void processIntercompanyTransaction.mutateAsync({
                    transactionId: BigInt(String(r.id)),
                    params: {}, // Process params would come from a modal in a full implementation
                  })
                }
              }
            },
          },
          {
            id: "ic-tx-complete",
            label: t("accounting.entities.intercompanyTransactions.actions.completeSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                const state = intercompanyTransactionState(r as Record<string, unknown>)
                if (state === "Processing") {
                  void completeIntercompanyTransaction.mutateAsync(BigInt(String(r.id)))
                }
              }
            },
          },
          {
            id: "ic-tx-retry",
            label: t("accounting.entities.intercompanyTransactions.actions.retrySelected"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                const state = intercompanyTransactionState(r as Record<string, unknown>)
                if (state === "Error") {
                  void retryIntercompanyTransaction.mutateAsync(BigInt(String(r.id)))
                }
              }
            },
          },
          {
            id: "ic-tx-cancel",
            label: t("accounting.entities.intercompanyTransactions.actions.cancelSelected"),
            requiresSelection: true,
            variant: "destructive",
            onClick: (rows) => {
              for (const r of rows) {
                const state = intercompanyTransactionState(r as Record<string, unknown>)
                if (state !== "Completed" && state !== "Cancelled") {
                  void cancelIntercompanyTransaction.mutateAsync({
                    transactionId: BigInt(String(r.id)),
                    reason: "Cancelled by user",
                  })
                }
              }
            },
          },
        ],
      },
    }
  }, [t, approveIntercompanyTransaction, processIntercompanyTransaction, completeIntercompanyTransaction, retryIntercompanyTransaction, cancelIntercompanyTransaction])

  const postDraft = useCallback(
    (move: unknown) => {
      const row = move as Record<string, unknown>
      if (row.id) {
        postMove.mutate(BigInt(String(row.id)))
      }
    },
    [postMove],
  )

  // ── Derived data ────────────────────────────────────────────────────────────
  const invoices = useMemo(
    () => allMoves.filter((m) => moveTypeTag(m as Record<string, unknown>) === "OutInvoice"),
    [allMoves],
  )
  const bills = useMemo(
    () => allMoves.filter((m) => moveTypeTag(m as Record<string, unknown>) === "InInvoice"),
    [allMoves],
  )

  // ── Live KPIs for dashboard ─────────────────────────────────────────────────
  const liveSections = useMemo(() => {
    const ar = invoices.reduce((s, m) => s + Number(m.amountResidual ?? 0), 0)
    const ap = bills.reduce((s, m) => s + Number(m.amountResidual ?? 0), 0)
    const cash = accounts
      .filter((a) => a.isBankAccount)
      .reduce((s, a) => s + Number(a.openingBalance ?? 0), 0)
    const revenue = invoices
      .filter((m) => moveStateStr(m as Record<string, unknown>) === "Posted")
      .reduce((s, m) => s + Number(m.amountTotal ?? 0), 0)

    const dashboardTab = moduleConfigBase.tabs.find((tb) => tb.id === "dashboard")
    if (!dashboardTab?.sections) return []

    return dashboardTab.sections.map((section) => ({
      ...section,
      widgets: section.widgets.map((w) => {
        if (w.type === "stat-cards") {
          return {
            ...w,
            data: {
              stats: [
                { label: t("accounting.dashboard.accountsReceivable"), value: `$${ar.toLocaleString()}`, icon: "TrendingUp" },
                { label: t("accounting.dashboard.accountsPayable"), value: `$${ap.toLocaleString()}`, icon: "TrendingDown" },
                { label: t("accounting.dashboard.cashBalance"), value: `$${cash.toLocaleString()}`, icon: "DollarSign" },
                { label: t("accounting.dashboard.revenueMTD"), value: `$${revenue.toLocaleString()}`, icon: "BarChart2" },
              ],
            },
          }
        }
        if (w.type === "cash-flow") {
          return { ...w, data: { arTotal: ar, apTotal: ap, netPosition: ar - ap } }
        }
        if (w.type === "quick-actions") {
          const handlers: Record<string, () => void> = {
            create_invoice: () => setShowCreateInvoice(true),
            create_bill: () => setShowCreateBill(true),
            journal_entry: () => setQuickActionForm({ form: journalEntryFormConfig, action: "createMove" }),
            create_tax: () => setQuickActionForm({ form: newTaxForm(t), action: "createTax" }),
          }

          return {
            ...w,
            data: {
              ...w.data,
              actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] })),
            },
          }
        }
        if (w.id === "acc-overdue") {
          const overdueInvoices = invoices.filter((m) => Number(m.amountResidual ?? 0) > 0)
          const totalAmount = overdueInvoices.reduce((s, m) => s + Number(m.amountResidual ?? 0), 0)
          const nowMs = Date.now()
          const oldestDays = overdueInvoices.reduce((max, m) => {
            if (!m.invoiceDateDue) return max
            const dueMs = Number(m.invoiceDateDue) / 1000
            const days = Math.max(0, Math.round((nowMs - dueMs) / 86400000))
            return Math.max(max, days)
          }, 0)
          return { ...w, data: { count: overdueInvoices.length, totalAmount, oldestDays } }
        }
        if (w.id === "acc-budget") {
          const budgetRows = budgets.slice(0, 5).map((b) => ({
            name: String(b.name ?? ""),
            planned: Number(b.totalPlanned ?? 0),
            actual: Number(b.totalPractical ?? 0),
            variance: Number(b.variancePercentage ?? 0),
          }))
          return { ...w, data: { budgets: budgetRows } }
        }
        if (w.id === "acc-balances") {
          const accountRows = accounts.slice(0, 5).map((a) => ({
            code: String(a.code ?? ""),
            name: String(a.name ?? ""),
            balance: Number(a.openingBalance ?? 0),
            type: String(a.internalGroup ?? "Asset"),
          }))
          return { ...w, data: { accounts: accountRows } }
        }
        return w
      }),
    }))
  }, [accounts, invoices, bills, budgets, moduleConfigBase, t, journalEntryFormConfig])

  const chartStructurePanel = useMemo(
    () => (
      <ChartStructureWorkspace
        accountTypes={accountTypes as unknown as Record<string, unknown>[]}
        accountGroups={accountGroups as unknown as Record<string, unknown>[]}
        onCreateAccountType={async (fd) => {
          const p = toCreateAccountAccountTypeParams(fd)
          if (p.name.trim() && p.type.trim()) {
            await createAccountType.mutateAsync(p as unknown as Record<string, unknown>)
          }
        }}
        onUpdateAccountType={async (typeId, fd) => {
          await updateAccountType.mutateAsync({
            typeId,
            params: toUpdateAccountAccountTypeParams(fd) as unknown as Record<string, unknown>,
          })
        }}
        onCreateAccountGroup={async (fd) => {
          const p = toCreateAccountGroupParams(fd)
          if (p.name.trim()) {
            await createAccountGroup.mutateAsync(p as unknown as Record<string, unknown>)
          }
        }}
        onUpdateAccountGroup={async (groupId, fd) => {
          await updateAccountGroup.mutateAsync({
            groupId,
            params: toUpdateAccountGroupParams(fd) as unknown as Record<string, unknown>,
          })
        }}
      />
    ),
    [
      accountTypes,
      accountGroups,
      createAccountType,
      updateAccountType,
      createAccountGroup,
      updateAccountGroup,
    ],
  )

  // ── Form submit handler (entity tabs: taxes, budgets) ───────────────────────
  const handleFormSubmit = (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createAccount") {
      const p = toCreateAccountAccountParams(formData)
      if (p) createAccount.mutate(accountingParamsToJson(p))
    } else if (action === "createMove") {
      const p = toCreateJournalEntryMoveParams(formData)
      if (p) createMove.mutate(accountingParamsToJson(p))
    } else if (action === "createTax") {
      createTax.mutate(accountingParamsToJson(toCreateAccountTaxParams(formData)))
    } else if (action === "createBudget") {
      createBudget.mutate(accountingParamsToJson(toCreateCrossoveredBudgetParams(formData)))
    } else if (action === "createAnalyticAccount") {
      const fd = { ...formData }
      if (fd.currencyId === "" || fd.currencyId == null) {
        fd.currencyId = defaultCurrencyId.toString()
      }
      const p = toCreateAnalyticAccountParams(fd, defaultCurrencyId)
      if (p) createAnalyticAccount.mutate(analyticParamsToJson(p))
    } else if (action === "createAnalyticLine") {
      const p = toCreateAnalyticLineParams(formData, defaultCurrencyId)
      if (p) createAnalyticLine.mutate(analyticParamsToJson(p))
    } else if (action === "createAnalyticDistributionModel") {
      const p = toCreateAnalyticDistributionModelParams(formData)
      if (p) createAnalyticDistributionModel.mutate(analyticParamsToJson(p))
    } else if (action === "createReconciliationWidget") {
      const p = toCreateAccountReconciliationWidgetParams(formData)
      if (p) createReconciliationWidget.mutate(reconciliationWidgetParamsToJson(p))
    } else if (action === "createFiscalYear") {
      const p = toCreateFiscalYearParams(formData)
      if (p) createFiscalYear.mutate(accountingParamsToJson(p))
    } else if (action === "createAccountPeriod") {
      const p = toCreateAccountPeriodParams(formData)
      if (p) createAccountPeriod.mutate(accountingParamsToJson(p))
    }
  }

  // ── Config: inject rich custom content for invoices/bills/accounts/ledger ───
  const config = useMemo(
    () => ({
      ...moduleConfigBase,
      tabs: moduleConfigBase.tabs.map((tab) => {
        if (tab.id === "analytic-lines") {
          return { ...tab, createForm: analyticLineFormConfig }
        }
        if (tab.id === "analytic-distribution") {
          return { ...tab, createForm: analyticDistFormConfig }
        }
        if (tab.id === "dashboard") {
          return { ...tab, sections: liveSections }
        }
        if (tab.id === "invoices") {
          return {
            ...tab,
            type: "custom" as const,
            customContent: (
              <InvoiceListView
                invoices={invoices as unknown as AccountMove[]}
                onSelectInvoice={(invoice) => setSelectedInvoice(invoice as unknown as AccountMove)}
                onCreateInvoice={() => setShowCreateInvoice(true)}
              />
            ),
          }
        }
        if (tab.id === "bills") {
          return {
            ...tab,
            type: "custom" as const,
            customContent: (
              <BillsListView
                bills={bills as unknown as AccountMove[]}
                onCreateBill={() => setShowCreateBill(true)}
              />
            ),
          }
        }
        if (tab.id === "accounts") {
          return {
            ...tab,
            type: "custom" as const,
            customContent: (
              <ChartOfAccountsView
                accounts={accounts as unknown as Parameters<typeof ChartOfAccountsView>[0]["accounts"]}
                chartStructureContent={chartStructurePanel}
                onCreate={(data) => {
                  const p = toCreateAccountAccountParams(data as Record<string, unknown>)
                  if (p) createAccount.mutate(accountingParamsToJson(p))
                }}
              />
            ),
          }
        }
        if (tab.id === "journal-entries") {
          return {
            ...tab,
            type: "custom" as const,
            customContent: (
              <GeneralLedgerView
                moves={allMoves as unknown as AccountMove[]}
                onCreate={() => setQuickActionForm({ form: journalEntryFormConfig, action: "createMove" })}
                onPostMove={(move) => postDraft(move)}
                onCancelMove={(move) => cancelMove.mutate(move.id)}
                postMovePending={postMove.isPending}
                cancelMovePending={cancelMove.isPending}
              />
            ),
          }
        }
        if (tab.id === "budgets") {
          return { ...tab, entityConfig: budgetsEntityConfig }
        }
        if (tab.id === "fiscal-years") {
          return { ...tab, entityConfig: fiscalYearsEntityConfig }
        }
        if (tab.id === "account-periods") {
          return {
            ...tab,
            entityConfig: accountPeriodsEntityConfig,
            createForm: accountPeriodCreateFormConfig,
          }
        }
        if (tab.id === "fixed-assets") {
          return { ...tab, entityConfig: fixedAssetsEntityConfig }
        }
        if (tab.id === "intercompany-rules") {
          return { ...tab, entityConfig: intercompanyRulesEntityConfig }
        }
        if (tab.id === "intercompany-transactions") {
          return { ...tab, entityConfig: intercompanyTransactionsEntityConfig }
        }
        if (tab.id === "bank-statements") {
          return {
            ...tab,
            type: "custom" as const,
            customContent: (
              <div className="space-y-3">
                <EntityView
                  config={bankStatementsEntityConfig}
                  data={bankStatements as unknown as Record<string, unknown>[]}
                  onRowClick={(row) => setBankStatementDetail(row)}
                />
              </div>
            ),
          }
        }
        if (tab.id === "reconciliation-widgets") {
          return {
            ...tab,
            createForm: reconciliationWidgetCreateFormConfig,
          }
        }
        if (tab.id === "consolidation") {
          return {
            ...tab,
            type: "custom" as const,
            customContent: (
              <ConsolidationWorkspace
                consolidationAccounts={consolidationAccounts as unknown as Record<string, unknown>[]}
                consolidationJournals={consolidationJournals as unknown as Record<string, unknown>[]}
                eliminationEntries={eliminationEntries as unknown as Record<string, unknown>[]}
                onCreateConsolidationAccount={(params) =>
                  createConsolidationAccount.mutateAsync(params)
                }
                onUpdateConsolidationAccount={(accountId, params) =>
                  updateConsolidationAccount.mutateAsync({ accountId, params })
                }
                onCreateConsolidationJournal={(params) =>
                  createConsolidationJournal.mutateAsync(params)
                }
                onCreateEliminationEntry={(params) => createEliminationEntry.mutateAsync(params)}
                onProcessConsolidation={(journalId) => processConsolidation.mutateAsync(journalId)}
                onValidateConsolidation={(journalId) =>
                  validateConsolidation.mutateAsync(journalId)
                }
                onCancelConsolidation={(journalId, reason) =>
                  cancelConsolidation.mutateAsync({ journalId, reason })
                }
                onMatchEliminationEntries={(entryId, matchedEntryId) =>
                  matchEliminationEntries.mutateAsync({ entryId, matchedEntryId })
                }
                onUnmatchEliminationEntry={(entryId) =>
                  unmatchEliminationEntry.mutateAsync(entryId)
                }
                processConsolidationPending={processConsolidation.isPending}
                validateConsolidationPending={validateConsolidation.isPending}
                cancelConsolidationPending={cancelConsolidation.isPending}
              />
            ),
          }
        }
        return tab
      }),
    }) as ModuleConfig,
    [
      liveSections,
      chartStructurePanel,
      invoices,
      bills,
      accounts,
      allMoves,
      bankStatements,
      bankStatementsEntityConfig,
      createAccount.mutate,
      t,
      moduleConfigBase,
      journalEntryFormConfig,
      budgetsEntityConfig,
      fiscalYearsEntityConfig,
      accountPeriodsEntityConfig,
      accountPeriodCreateFormConfig,
      fixedAssetsEntityConfig,
      intercompanyRulesEntityConfig,
      intercompanyTransactionsEntityConfig,
      postMove,
      cancelMove,
      postDraft,
      analyticLineFormConfig,
      analyticDistFormConfig,
      reconciliationWidgetCreateFormConfig,
      consolidationAccounts,
      consolidationJournals,
      eliminationEntries,
      createConsolidationAccount.mutateAsync,
      updateConsolidationAccount.mutateAsync,
      createConsolidationJournal.mutateAsync,
      createEliminationEntry.mutateAsync,
      processConsolidation.isPending,
      processConsolidation.mutateAsync,
      validateConsolidation.isPending,
      validateConsolidation.mutateAsync,
      cancelConsolidation.isPending,
      cancelConsolidation.mutateAsync,
      matchEliminationEntries.mutateAsync,
      unmatchEliminationEntry.mutateAsync,
    ],
  )

  // Entity tab data (taxes, budgets, analytic, etc. — non-rich tabs)
  const data = useMemo(
    () => ({
      taxes: taxes as unknown as Record<string, unknown>[],
      budgets: budgets as unknown as Record<string, unknown>[],
      analytic: analytic as unknown as Record<string, unknown>[],
      "analytic-lines": analyticLines as unknown as Record<string, unknown>[],
      "analytic-distribution": analyticDistribution as unknown as Record<string, unknown>[],
      "reconciliation-widgets": reconciliationWidgets as unknown as Record<string, unknown>[],
      "fixed-assets": fixedAssets as unknown as Record<string, unknown>[],
      "fiscal-years": fiscalYearsDisplay as unknown as Record<string, unknown>[],
      "account-periods": accountPeriodsDisplay as unknown as Record<string, unknown>[],
      "intercompany-rules": intercompanyRules as unknown as Record<string, unknown>[],
      "intercompany-transactions": intercompanyTransactions as unknown as Record<string, unknown>[],
    }),
    [
      taxes,
      budgets,
      analytic,
      analyticLines,
      analyticDistribution,
      reconciliationWidgets,
      fixedAssets,
      fiscalYearsDisplay,
      accountPeriodsDisplay,
      intercompanyRules,
      intercompanyTransactions,
    ],
  )

  const handleEntityRowClick = useCallback((tabId: string, row: Record<string, unknown>) => {
    if (tabId === "analytic") setAnalyticAccountEdit(row)
    else if (tabId === "analytic-lines") setAnalyticLineEdit(row)
    else if (tabId === "analytic-distribution") setAnalyticDistEdit(row)
    else if (tabId === "reconciliation-widgets") setReconciliationWidgetEdit(row)
    else if (tabId === "fiscal-years") {
      const st = fiscalYearStateTag(row)
      if (st === "Draft" || st === "Running") setFiscalYearEdit(row)
    } else if (tabId === "account-periods") {
      const st = accountPeriodStateTag(row)
      if (st === "Draft" || st === "Open") setAccountPeriodEdit(row)
    }
  }, [])

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
        onRowClick={handleEntityRowClick}
      />

      {/* Invoice detail */}
      <InvoiceDetailModal
        invoice={selectedInvoice}
        open={!!selectedInvoice}
        onClose={() => setSelectedInvoice(null)}
        onPostDraft={selectedInvoice ? () => postDraft(selectedInvoice) : undefined}
        postDraftPending={postMove.isPending}
      />

      {/* Create invoice */}
      <CreateInvoiceModal
        open={showCreateInvoice}
        onClose={() => setShowCreateInvoice(false)}
        journalOptions={journalRowsAsSelectOptions.length > 0 ? journalRowsAsSelectOptions : undefined}
        onSave={(params) => {
          if (journals.length === 0) return
          const jid = params.journalId
          if (jid == null) return
          const journalId = typeof jid === "bigint" ? jid : BigInt(String(jid))
          const p = toCreateAccountMoveFromInvoiceModal(
            params as Record<string, unknown>,
            "OutInvoice",
            journalId,
            "Customer Invoice",
          )
          createMove.mutate(accountingParamsToJson(p))
        }}
      />

      {/* Create bill (same form, different move type) */}
      <CreateInvoiceModal
        open={showCreateBill}
        onClose={() => setShowCreateBill(false)}
        journalOptions={journalRowsAsSelectOptions.length > 0 ? journalRowsAsSelectOptions : undefined}
        onSave={(params) => {
          if (journals.length === 0) return
          const jid = params.journalId
          if (jid == null) return
          const journalId = typeof jid === "bigint" ? jid : BigInt(String(jid))
          const p = toCreateAccountMoveFromInvoiceModal(
            params as Record<string, unknown>,
            "InInvoice",
            journalId,
            "Vendor Bill",
          )
          createMove.mutate(accountingParamsToJson(p))
        }}
      />

      {/* Dashboard quick-action form modal */}
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? journalEntryFormConfig}
        onSubmit={(formData) => {
          if (quickActionForm) {
            handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />

      <FormModal
        key={fiscalYearEdit ? `fy-${String(fiscalYearEdit.id)}` : "fy-closed"}
        open={!!fiscalYearEdit}
        onOpenChange={(open) => {
          if (!open) setFiscalYearEdit(null)
        }}
        config={fiscalYearEditFormConfig}
        onSubmit={onSubmitFiscalYearEdit}
      />

      <FormModal
        key={accountPeriodEdit ? `ap-${String(accountPeriodEdit.id)}` : "ap-closed"}
        open={!!accountPeriodEdit}
        onOpenChange={(open) => {
          if (!open) setAccountPeriodEdit(null)
        }}
        config={accountPeriodEditFormConfig}
        onSubmit={onSubmitAccountPeriodEdit}
      />

      <FormModal
        key={analyticAccountEdit ? `acc-${String(analyticAccountEdit.id)}` : "acc-closed"}
        open={!!analyticAccountEdit}
        onOpenChange={(open) => {
          if (!open) setAnalyticAccountEdit(null)
        }}
        config={analyticAccountEditFormConfig}
        onSubmit={onSubmitAnalyticAccountEdit}
      />

      <FormModal
        key={analyticLineEdit ? `line-${String(analyticLineEdit.id)}` : "line-closed"}
        open={!!analyticLineEdit}
        onOpenChange={(open) => {
          if (!open) setAnalyticLineEdit(null)
        }}
        config={analyticLineEditFormConfig}
        onSubmit={onSubmitAnalyticLineEdit}
        formLeadingActions={
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={!analyticLineEdit?.id || deleteAnalyticLine.isPending}
            onClick={async () => {
              if (!analyticLineEdit?.id) return
              if (!window.confirm(`${t("common.delete")}?`)) return
              await deleteAnalyticLine.mutateAsync(BigInt(String(analyticLineEdit.id)))
              setAnalyticLineEdit(null)
            }}
          >
            {t("common.delete")}
          </Button>
        }
      />

      <FormModal
        key={analyticDistEdit ? `dist-${String(analyticDistEdit.id)}` : "dist-closed"}
        open={!!analyticDistEdit}
        onOpenChange={(open) => {
          if (!open) setAnalyticDistEdit(null)
        }}
        config={analyticDistEditFormConfig}
        onSubmit={onSubmitAnalyticDistEdit}
      />

      <FormModal
        key={reconciliationWidgetEdit ? `rw-${String(reconciliationWidgetEdit.id)}` : "rw-closed"}
        open={!!reconciliationWidgetEdit}
        onOpenChange={(open) => {
          if (!open) setReconciliationWidgetEdit(null)
        }}
        config={reconciliationWidgetEditFormConfig}
        onSubmit={onSubmitReconciliationWidgetEdit}
        formLeadingActions={
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={!reconciliationWidgetEdit?.id || deleteReconciliationWidget.isPending}
            onClick={async () => {
              if (!reconciliationWidgetEdit?.id) return
              if (!window.confirm(`${t("common.delete")}?`)) return
              await deleteReconciliationWidget.mutateAsync(BigInt(String(reconciliationWidgetEdit.id)))
              setReconciliationWidgetEdit(null)
            }}
          >
            {t("common.delete")}
          </Button>
        }
      />

      <Dialog
        open={!!bankStatementDetail}
        onOpenChange={(open) => {
          if (!open) {
            setBankStatementDetail(null)
            setBankLineCreateOpen(false)
            setBankLineMatchFocus(null)
            setReconciliationRuleIdInput("")
            setManualReconcileMoveIds("")
            setManualReconcileResidual("0")
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t("accounting.bankStatementDetail.title")}
              {bankStatementDetail?.name != null && String(bankStatementDetail.name).trim() !== ""
                ? ` — ${String(bankStatementDetail.name)}`
                : bankStatementDetail?.id != null
                  ? ` #${String(bankStatementDetail.id)}`
                  : ""}
            </DialogTitle>
          </DialogHeader>
          {bankStatementDetail ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div>
                  <span className="text-muted-foreground">{t("accounting.entities.bankStatements.columns.state")}</span>
                  <div className="font-medium">{bankStatementStateStr(bankStatementDetail)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("accounting.entities.bankStatements.columns.balanceStart")}</span>
                  <div className="font-medium">{Number(bankStatementDetail.balanceStart ?? 0).toLocaleString()}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("accounting.entities.bankStatements.columns.balanceEndReal")}</span>
                  <div className="font-medium">{Number(bankStatementDetail.balanceEndReal ?? 0).toLocaleString()}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("accounting.entities.bankStatements.columns.balanceEnd")}</span>
                  <div className="font-medium">{Number(bankStatementDetail.balanceEnd ?? 0).toLocaleString()}</div>
                </div>
              </div>
              {bankStatementStateStr(bankStatementDetail) === "Open" && !statementBalancesMatch ? (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-900 dark:text-amber-100">
                  {t("accounting.bankStatementDetail.balanceMismatch")}
                </p>
              ) : null}
              {bankStatementStateStr(bankStatementDetail) === "Posted" ? (
                <p className="text-muted-foreground">{t("accounting.bankStatementDetail.postedHint")}</p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    bankStatementStateStr(bankStatementDetail) !== "Open" ||
                    !statementBalancesMatch ||
                    postBankStatement.isPending
                  }
                  onClick={async () => {
                    if (!bankStatementDetail.id) return
                    await postBankStatement.mutateAsync(BigInt(String(bankStatementDetail.id)))
                    setBankStatementDetail(null)
                  }}
                >
                  {t("accounting.actions.postStatement")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={bankStatementStateStr(bankStatementDetail) === "Posted" || deleteBankStatement.isPending}
                  onClick={() => {
                    if (!bankStatementDetail.id) return
                    if (!window.confirm(t("accounting.bankStatementDetail.deleteStatementConfirm"))) return
                    void deleteBankStatement.mutateAsync(BigInt(String(bankStatementDetail.id))).then(() => {
                      setBankStatementDetail(null)
                    })
                  }}
                >
                  {t("common.delete")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={bankStatementStateStr(bankStatementDetail) === "Posted"}
                  onClick={() => setBankLineCreateOpen(true)}
                >
                  {t("accounting.bankStatementDetail.addLineButton")}
                </Button>
              </div>

              <div>
                <h3 className="mb-2 font-semibold">{t("accounting.bankStatementDetail.linesHeading")}</h3>
                {detailStatementLines.length === 0 ? (
                  <p className="text-muted-foreground">{t("accounting.bankStatementDetail.emptyLines")}</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-left text-xs sm:text-sm">
                      <thead className="border-b bg-muted/50">
                        <tr>
                          <th className="p-2">{t("accounting.forms.bankStatementLine.fields.date")}</th>
                          <th className="p-2 text-right">{t("accounting.forms.bankStatementLine.fields.amount")}</th>
                          <th className="p-2">{t("accounting.bankStatementDetail.columnReconciled")}</th>
                          <th className="p-2 min-w-[9rem]">{t("accounting.reconciliation.title")}</th>
                          <th className="p-2 w-28" />
                        </tr>
                      </thead>
                      <tbody>
                        {detailStatementLines.map((line) => {
                          const lineRow = line as Record<string, unknown>
                          const focused =
                            bankLineMatchFocus?.id != null &&
                            String(bankLineMatchFocus.id) === String(line.id)
                          return (
                            <tr
                              key={String(line.id)}
                              className={cn(
                                "border-b last:border-0",
                                focused && "bg-muted/40",
                              )}
                            >
                              <td className="p-2 whitespace-nowrap">
                                {bankStatementTimestampToDateInput(line.date)}
                              </td>
                              <td className="p-2 text-right font-mono">
                                {Number(line.amount ?? 0).toLocaleString()}
                              </td>
                              <td className="p-2">
                                {line.isReconciled ? t("common.yes") : t("common.no")}
                              </td>
                              <td className="p-2">
                                <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={focused ? "secondary" : "outline"}
                                    className="h-7 px-2"
                                    onClick={() =>
                                      setBankLineMatchFocus((prev) =>
                                        prev?.id != null && String(prev.id) === String(line.id) ? null : lineRow,
                                      )
                                    }
                                  >
                                    {t("accounting.bankStatementDetail.focusLineButton")}
                                  </Button>
                                  {line.isReconciled ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2"
                                      disabled={unreconcileBankLine.isPending}
                                      onClick={() => {
                                        if (!line.id) return
                                        if (!window.confirm(t("accounting.bankStatementDetail.unreconcileConfirm")))
                                          return
                                        const lid = BigInt(String(line.id))
                                        const amt = Number(line.amount ?? 0)
                                        void unreconcileBankLine.mutateAsync({
                                          lineId: lid,
                                          params: bankReconcileParamsToJson([], amt),
                                        })
                                      }}
                                    >
                                      {t("accounting.bankStatementDetail.unreconcileLine")}
                                    </Button>
                                  ) : null}
                                </div>
                              </td>
                              <td className="p-2">
                                <div className="flex flex-wrap gap-1">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2"
                                    disabled={bankStatementStateStr(bankStatementDetail) === "Posted"}
                                    onClick={() => setBankLineEdit(lineRow)}
                                  >
                                    {t("common.edit")}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-destructive"
                                    disabled={
                                      bankStatementStateStr(bankStatementDetail) === "Posted" ||
                                      deleteBankStatementLine.isPending
                                    }
                                    onClick={() => {
                                      if (!line.id) return
                                      if (!window.confirm(t("accounting.bankStatementDetail.deleteLineConfirm")))
                                        return
                                      void deleteBankStatementLine.mutateAsync(BigInt(String(line.id)))
                                    }}
                                  >
                                    {t("common.delete")}
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="space-y-3 border-t border-border pt-4">
                <h3 className="font-semibold">{t("accounting.reconciliation.title")}</h3>
                <div className="space-y-2">
                  <Label htmlFor="recon-rule-id">{t("accounting.bankStatementDetail.reconciliationRuleId")}</Label>
                  <Input
                    id="recon-rule-id"
                    value={reconciliationRuleIdInput}
                    onChange={(e) => setReconciliationRuleIdInput(e.target.value)}
                    className="max-w-xs"
                    placeholder="—"
                  />
                  <p className="text-muted-foreground text-xs">
                    {t("accounting.bankStatementDetail.reconciliationRuleIdHint")}
                  </p>
                </div>
                {bankLineMatchFocus?.id ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={matchBankLine.isPending}
                        onClick={() => {
                          void matchBankLine.mutateAsync({
                            lineId: BigInt(String(bankLineMatchFocus.id)),
                            ruleId: parseOptionalRuleId(reconciliationRuleIdInput),
                          })
                        }}
                      >
                        {t("accounting.bankStatementDetail.matchBankLine")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={applyReconciliationRules.isPending}
                        onClick={() => {
                          void applyReconciliationRules.mutateAsync({
                            lineId: BigInt(String(bankLineMatchFocus.id)),
                            ruleId: parseOptionalRuleId(reconciliationRuleIdInput),
                          })
                        }}
                      >
                        {t("accounting.bankStatementDetail.applyRules")}
                      </Button>
                    </div>
                    <div>
                      <h4 className="mb-2 text-sm font-medium">
                        {t("accounting.bankStatementDetail.matchCandidatesHeading")}
                      </h4>
                      {matchCandidatesForFocusedLine.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                          {t("accounting.bankStatementDetail.noCandidates")}
                        </p>
                      ) : (
                        <div className="overflow-x-auto rounded-md border">
                          <table className="w-full text-left text-xs sm:text-sm">
                            <thead className="border-b bg-muted/50">
                              <tr>
                                <th className="p-2">{t("accounting.bankStatementDetail.candidateType")}</th>
                                <th className="p-2">{t("accounting.bankStatementDetail.candidateMoveLine")}</th>
                                <th className="p-2 text-right">{t("accounting.bankStatementDetail.candidateAmount")}</th>
                                <th className="p-2 text-right">{t("accounting.bankStatementDetail.candidateScore")}</th>
                                <th className="p-2 w-24" />
                              </tr>
                            </thead>
                            <tbody>
                              {matchCandidatesForFocusedLine.map((c) => (
                                <tr key={String(c.id)} className="border-b last:border-0">
                                  <td className="p-2">{String(c.matchType ?? "")}</td>
                                  <td className="p-2 font-mono">{String(c.entityId ?? "")}</td>
                                  <td className="p-2 text-right">{Number(c.amount ?? 0).toLocaleString()}</td>
                                  <td className="p-2 text-right">{String(c.score ?? "")}</td>
                                  <td className="p-2">
                                    <Button
                                      type="button"
                                      size="sm"
                                      className="h-7 px-2"
                                      disabled={reconcileBankLine.isPending || Boolean(bankLineMatchFocus.isReconciled)}
                                      onClick={() => {
                                        if (!bankLineMatchFocus.id || c.entityId == null) return
                                        void reconcileBankLine.mutateAsync({
                                          lineId: BigInt(String(bankLineMatchFocus.id)),
                                          params: bankReconcileParamsToJson(
                                            [BigInt(String(c.entityId))],
                                            0,
                                          ),
                                        })
                                      }}
                                    >
                                      {t("accounting.bankStatementDetail.reconcileWithCandidate")}
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                    <div className="space-y-2 rounded-md border border-dashed p-3">
                      <h4 className="text-sm font-medium">
                        {t("accounting.bankStatementDetail.manualReconcileHeading")}
                      </h4>
                      <div className="space-y-1">
                        <Label htmlFor="manual-move-ids">
                          {t("accounting.bankStatementDetail.manualMoveLineIds")}
                        </Label>
                        <Input
                          id="manual-move-ids"
                          value={manualReconcileMoveIds}
                          onChange={(e) => setManualReconcileMoveIds(e.target.value)}
                          placeholder="e.g. 101, 102"
                        />
                        <p className="text-muted-foreground text-xs">
                          {t("accounting.bankStatementDetail.manualMoveLineIdsHint")}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="manual-residual">
                          {t("accounting.bankStatementDetail.manualAmountResidual")}
                        </Label>
                        <Input
                          id="manual-residual"
                          value={manualReconcileResidual}
                          onChange={(e) => setManualReconcileResidual(e.target.value)}
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        disabled={
                          reconcileBankLine.isPending ||
                          Boolean(bankLineMatchFocus.isReconciled) ||
                          manualReconcileMoveIds.trim() === ""
                        }
                        onClick={() => {
                          if (!bankLineMatchFocus.id) return
                          const parts = manualReconcileMoveIds
                            .split(/[\s,]+/)
                            .map((s) => s.trim())
                            .filter(Boolean)
                          const ids = parts.map((p) => BigInt(p))
                          const res = Number(manualReconcileResidual)
                          void reconcileBankLine.mutateAsync({
                            lineId: BigInt(String(bankLineMatchFocus.id)),
                            params: bankReconcileParamsToJson(
                              ids,
                              Number.isFinite(res) ? res : 0,
                            ),
                          })
                        }}
                      >
                        {t("accounting.bankStatementDetail.reconcileManual")}
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {t("accounting.bankStatementDetail.focusLineForMatches")}
                  </p>
                )}
              </div>
            </div>
          ) : null}
          <DialogFooter className="sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setBankStatementDetail(null)}>
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FormModal
        open={bankLineCreateOpen && !!bankStatementDetail?.id}
        onOpenChange={(open) => {
          if (!open) setBankLineCreateOpen(false)
        }}
        config={newBankStatementLineFormConfig}
        onSubmit={onSubmitNewBankStatementLine}
      />

      <FormModal
        key={bankLineEdit ? `bsl-${String(bankLineEdit.id)}` : "bsl-closed"}
        open={!!bankLineEdit}
        onOpenChange={(open) => {
          if (!open) setBankLineEdit(null)
        }}
        config={editBankStatementLineFormConfig}
        onSubmit={onSubmitEditBankStatementLine}
      />
    </>
  )
}

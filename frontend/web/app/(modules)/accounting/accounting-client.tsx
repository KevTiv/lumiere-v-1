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
  mergeSelectOptionsForFields,
  mergeFieldDefaultValues,
  bankStatementsTableConfig,
  fixedAssetsTableConfig,
  accountPaymentsTableConfig,
  paymentTermsTableConfig,
  paymentTermLinesTableConfig,
  accountJournalsTableConfig,
  accountMoveLinesTableConfig,
  newAccountPaymentForm,
  newPaymentTermLineForm,
  editPaymentTermLineForm,
  newAccountJournalForm,
  editAccountJournalForm,
  addAccountMoveLineForm,
  newCurrencyRateForm,
  registerPaymentInvoicesForm,
  reconcilePaymentInvoiceForm,
  createCreditNoteForm,
  intercompanyRulesTableConfig,
  intercompanyTransactionsTableConfig,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  csvImportForm,
  RecordChatterDialog,
} from "@lumiere/ui"
import { Input } from "@lumiere/ui/components/input"
import { Label } from "@lumiere/ui/components/label"
import type { EntityTableConfig, EntityViewConfig, FormConfig, ModuleConfig } from "@lumiere/ui"
import {
  accountingParamsToJson,
  createAccountAccountParamsToStdbHttpJson,
  analyticParamsToJson,
  toCreateAccountAccountParams,
  toCreateAccountMoveFromInvoiceModal,
  createAccountTaxParamsToStdbHttpJson,
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
  toCreateBudgetPostParams,
  toUpdateBudgetPostParams,
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
  toCreatePaymentParamsFromManualForm,
  toCreatePaymentTermParamsFromForm,
  toCreatePaymentTermLineParamsFromForm,
  toCreateCurrencyRateParamsFromForm,
  createCurrencyRateParamsToJson,
} from "@/lib/accounting-create-params"
import { optionalBigIntU64 } from "@/lib/form-coercion"
import { stdbParamsToJson } from "@/lib/stdb-params-json"
import type {
  AddAccountMoveLineParams,
  CreateAccountJournalParams,
  JournalType,
  UpdateAccountJournalParams,
} from "@lumiere/stdb/types"
import { accountingModuleConfig } from "@/lib/module-dashboard-configs"
import { chatterTargetFromRow, type ChatterTarget } from "@/lib/record-chatter"
import {
  useAccountAccounts,
  useAccountMoves,
  useAccountMoveLines,
  useAccountTaxes,
  useCrossoveredBudgets,
  useBudgetLines,
  useBudgetPosts,
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
  useUpdateCrossoveredBudget,
  useCreateBudgetLine,
  useUpdateBudgetLine,
  useConfirmBudget,
  useValidateBudget,
  useDoneBudget,
  useCancelBudget,
  useDeleteBudgetLine,
  useUpdateBudgetLineActuals,
  useCreateBudgetPost,
  useUpdateBudgetPost,
  usePostAccountMove,
  usePostInvoice,
  useCreateCreditNoteFromInvoice,
  useCancelAccountMove,
  useAddAccountMoveLine,
  useDeleteAccountMoveLine,
  useCreateAccountJournal,
  useUpdateAccountJournal,
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
  useSetupFiscalCalendar,
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
  useComputeInvoiceTotals,
  useReconcilePaymentWithInvoice,
  useRefreshTaxDeadlineStatuses,
  useScheduleTaxDeadlineUpdates,
  useTaxDeadlines,
  useAccountingCsvImportMutations,
  useAccountPayments,
  useAccountPaymentTerms,
  useAccountPaymentTermLines,
  useCreateAccountPayment,
  usePostAccountPayment,
  useCancelAccountPayment,
  useRegisterPaymentOnInvoice,
  useCreatePaymentTerm,
  useUpdatePaymentTerm,
  useDeletePaymentTerm,
  useCreatePaymentTermLine,
  useUpdatePaymentTermLine,
  useDeletePaymentTermLine,
  useCreateCurrencyRate,
  useSetAccountAssetActive,
} from "@lumiere/query-hooks/hooks/accounting"
import { useFinancialReports } from "@lumiere/query-hooks/hooks/reports"
import { accountJournalRowsToSelectOptions } from "@/lib/form-lookup"
import { useToast } from "@/hooks/use-toast"
import type { AccountMove } from "@lumiere/query-hooks/hooks/accounting"
import {
  InvoiceListView,
  InvoiceDetailModal,
  CreateInvoiceModal,
  BillsListView,
  ChartOfAccountsView,
  ChartStructureWorkspace,
  GeneralLedgerView,
  AccountGlDrilldownPanel,
  PeriodCloseChecklist,
  BudgetsWorkspace,
  ConsolidationWorkspace,
  type AccountAccount,
} from "@lumiere/ui"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import {
  downloadDocumentPdf,
  useDispatchQueuedMail,
  useMailTemplates,
  useQueueMailFromTemplate,
} from "@lumiere/query-hooks/hooks/templates"
import { stbTimestampFromDate } from "@/lib/stb-timestamp"
import {
  enumTag,
  isInvoiceLikeMoveType,
  resolveDefaultCogsInventoryAccountIds,
} from "@/lib/accounting-post-draft"
import { Button } from "@lumiere/ui/components/button"
import { cn } from "@lumiere/ui/lib/utils"

function moveTypeTag(row: Record<string, unknown>): string {
  return enumTag(row.moveType ?? row.move_type)
}

function paymentTermValueTag(
  raw: unknown,
): { tag: "Balance" } | { tag: "Percent" } | { tag: "Fixed" } {
  const s = String(raw ?? "Balance").trim()
  if (s === "Percent") return { tag: "Percent" }
  if (s === "Fixed") return { tag: "Fixed" }
  return { tag: "Balance" }
}

function journalTypeTagFromForm(raw: unknown): JournalType {
  const s = String(raw ?? "Sale").trim()
  if (s === "Purchase") return { tag: "Purchase" }
  if (s === "Bank") return { tag: "Bank" }
  if (s === "Cash") return { tag: "Cash" }
  if (s === "General") return { tag: "General" }
  return { tag: "Sale" }
}

function toCreateAccountJournalParamsFromForm(
  formData: Record<string, unknown>,
  companyId: bigint,
): CreateAccountJournalParams {
  const name = String(formData.name ?? "").trim()
  const code = String(formData.code ?? "").trim()
  return {
    companyId,
    name,
    code,
    type: journalTypeTagFromForm(formData.type),
    currencyId: undefined,
    defaultAccountId: undefined,
    suspenseAccountId: undefined,
    lossAccountId: undefined,
    profitAccountId: undefined,
    bankAccountId: undefined,
    paymentCreditAccountId: undefined,
    paymentDebitAccountId: undefined,
    invoiceReferenceType: undefined,
    invoiceReferenceModel: undefined,
    sequenceId: undefined,
    refundSequenceId: undefined,
    sequenceOverrideRegex: undefined,
    secureSequenceId: undefined,
    aliasName: undefined,
    aliasDomain: undefined,
    saleActivityTypeId: undefined,
    saleActivityUserId: undefined,
    saleActivityNote: undefined,
    saleActivityDateDeadline: undefined,
    restrictModeHashTable: false,
    active: formData.active !== false,
    atLeastOneInbound: false,
    atLeastOneOutbound: false,
    dedicatedPaymentMethodIds: [],
    saleActivityDone: false,
    metadata: undefined,
  }
}

function toAddAccountMoveLineParamsFromForm(
  formData: Record<string, unknown>,
): { moveId: bigint; params: AddAccountMoveLineParams } | null {
  const moveId = optionalBigIntU64(formData.moveId)
  const accountId = optionalBigIntU64(formData.accountId)
  const name = String(formData.name ?? "").trim()
  if (!moveId || !accountId || !name) return null
  const debit = Number(formData.debit ?? 0)
  const credit = Number(formData.credit ?? 0)
  return {
    moveId,
    params: {
      accountId,
      name,
      debit: Number.isFinite(debit) ? debit : 0,
      credit: Number.isFinite(credit) ? credit : 0,
      sequence: 10,
      quantity: 0,
      priceUnit: 0,
      discount: 0,
      taxIds: [],
      partnerId: undefined,
      productId: undefined,
      productUomId: undefined,
      productCategoryId: undefined,
      analyticAccountId: undefined,
      analyticTagIds: [],
      displayType: undefined,
      isDownpayment: false,
      excludeFromInvoiceTab: false,
      blocked: false,
      groupTaxId: undefined,
      taxLineId: undefined,
      taxGroupId: undefined,
      taxRepartitionLineId: undefined,
      taxAudit: undefined,
      reconcileModelId: undefined,
      paymentId: undefined,
      statementLineId: undefined,
      matchingNumber: undefined,
      matchingLabel: undefined,
      expectedPayDate: undefined,
      expectedPayDateCurrencyId: undefined,
      expectedPayDateAmount: 0,
      expectedPayDateResidual: 0,
      metadata: undefined,
    },
  }
}

function moveStateStr(row: Record<string, unknown>): string {
  const v = row.state
  if (v != null && typeof v === "object" && "tag" in v) return String((v as { tag: string }).tag)
  return String(v ?? "")
}

function taxDeadlineStatusStr(row: Record<string, unknown>): string {
  const v = row.status
  if (v != null && typeof v === "object" && "tag" in v) return String((v as { tag: string }).tag)
  return String(v ?? "")
}

/** SpacetimeDB timestamp JSON → milliseconds since epoch. */
function stdbTimestampToMs(ts: unknown): number | null {
  if (ts == null) return null
  const n = typeof ts === "bigint" ? Number(ts) : Number(ts)
  if (!Number.isFinite(n)) return null
  return n / 1000
}

function dateInputToStdbTimestamp(value: unknown, fallback = new Date()) {
  if (value != null && String(value).trim() !== "") {
    const d = new Date(String(value))
    if (!Number.isNaN(d.getTime())) return stbTimestampFromDate(d)
  }
  return stbTimestampFromDate(fallback)
}

function optionalText(value: unknown): string | undefined {
  if (value == null) return undefined
  const text = String(value).trim()
  return text === "" ? undefined : text
}

function toUpdateBudgetParams(formData: Record<string, unknown>): Record<string, unknown> {
  return {
    companyId: undefined,
    name: optionalText(formData.name),
    description: formData.description == null ? undefined : optionalText(formData.description) ?? null,
    dateFrom: formData.dateFrom ? dateInputToStdbTimestamp(formData.dateFrom) : undefined,
    dateTo: formData.dateTo ? dateInputToStdbTimestamp(formData.dateTo) : undefined,
    metadata: undefined,
  }
}

function toCreateBudgetLineParams(formData: Record<string, unknown>): Record<string, unknown> {
  const plannedAmount = Number(formData.plannedAmount ?? 0)
  return {
    analyticAccountId: optionalBigIntU64(formData.analyticAccountId),
    dateFrom: dateInputToStdbTimestamp(formData.dateFrom),
    dateTo: dateInputToStdbTimestamp(formData.dateTo),
    paidDate: undefined,
    plannedAmount,
    practicalAmount: 0,
    theoreticalAmount: 0,
    achievePercentage: 0,
    isAboveBudget: false,
    variance: -plannedAmount,
    variancePercentage: plannedAmount > 0 ? -100 : 0,
    metadata: optionalText(formData.metadata),
  }
}

function toUpdateBudgetLineParams(formData: Record<string, unknown>): Record<string, unknown> {
  return {
    plannedAmount:
      formData.plannedAmount === "" || formData.plannedAmount == null
        ? undefined
        : Number(formData.plannedAmount),
    analyticAccountId:
      "analyticAccountId" in formData
        ? optionalBigIntU64(formData.analyticAccountId) ?? null
        : undefined,
    dateFrom: formData.dateFrom ? dateInputToStdbTimestamp(formData.dateFrom) : undefined,
    dateTo: formData.dateTo ? dateInputToStdbTimestamp(formData.dateTo) : undefined,
    metadata: formData.metadata == null ? undefined : optionalText(formData.metadata) ?? null,
  }
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

function paymentStateTag(row: Record<string, unknown>): string {
  const v = row.state
  if (v != null && typeof v === "object" && "tag" in v) return String((v as { tag: string }).tag)
  return String(v ?? "")
}

function paymentTermIsActive(row: Record<string, unknown>): boolean {
  if (row.isActive === true || row.isActive === false) return Boolean(row.isActive)
  if (row.is_active === true || row.is_active === false) return Boolean(row.is_active)
  return true
}

function parseCommaSeparatedBigInts(raw: unknown): bigint[] {
  const s = String(raw ?? "").trim()
  if (!s) return []
  const parts = s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)
  const out: bigint[] = []
  for (const p of parts) {
    try {
      out.push(BigInt(p))
    } catch {
      /* skip invalid token */
    }
  }
  return out
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

/** Resolve journal for `create_account_move` from modal payload or first loaded journal. */
function journalIdFromInvoiceModalSave(
  params: unknown,
  journals: Record<string, unknown>[],
): bigint | null {
  const j = (params as { journalId?: unknown }).journalId
  if (j != null) {
    return typeof j === "bigint" ? j : BigInt(String(j))
  }
  const id = journals[0]?.id
  return id != null ? BigInt(String(id)) : null
}

type AccountingCsvImportKind =
  | "account"
  | "accountMove"
  | "accountMoveLine"
  | "tax"
  | "budget"
  | "budgetLine"
  | "analytic"

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
  const { toast } = useToast()
  const moduleConfigBase = useMemo(() => accountingModuleConfig(t), [t])
  /** BigInt organization id for `useStdbQuery` cache keys (not SpacetimeDB `company_id` reducers). */
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId) ?? 0n

  // Quick-action form modal (dashboard tab)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  // Invoice detail modal
  const [selectedInvoice, setSelectedInvoice] = useState<AccountMove | null>(null)
  // Create invoice / bill modals
  const [showCreateInvoice, setShowCreateInvoice] = useState(false)
  const [showCreateBill, setShowCreateBill] = useState(false)
  const [creditNoteSource, setCreditNoteSource] = useState<AccountMove | null>(null)
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
  const [fiscalSetupOpen, setFiscalSetupOpen] = useState(false)
  const [fiscalSetupError, setFiscalSetupError] = useState<string | null>(null)
  const [accountPeriodEdit, setAccountPeriodEdit] = useState<Record<string, unknown> | null>(null)
  const [csvKind, setCsvKind] = useState<AccountingCsvImportKind | null>(null)
  const [csvError, setCsvError] = useState<string | null>(null)
  const [registerPaymentForId, setRegisterPaymentForId] = useState<bigint | null>(null)
  const [registerPaymentError, setRegisterPaymentError] = useState<string | null>(null)
  const [reconcilePaymentOpen, setReconcilePaymentOpen] = useState(false)
  const [reconcilePaymentError, setReconcilePaymentError] = useState<string | null>(null)
  const [journalEdit, setJournalEdit] = useState<Record<string, unknown> | null>(null)
  const [paymentTermLineEdit, setPaymentTermLineEdit] = useState<Record<string, unknown> | null>(null)
  const [chatterTarget, setChatterTarget] = useState<ChatterTarget | null>(null)
  const [glDrilldownAccount, setGlDrilldownAccount] = useState<AccountAccount | null>(null)
  const [accountingActiveTab, setAccountingActiveTab] = useState<string>("dashboard")

  // ── Data hooks ──────────────────────────────────────────────────────────────
  const { data: accounts = [] } = useAccountAccounts(orgId, {
    enabled: organizationId > 0,
    initialData: initialAccounts,
  })
  const { data: allMoves = [] } = useAccountMoves(orgId, {
    enabled: organizationId > 0,
    initialData: initialMoves,
  })
  const { data: accountMoveLines = [] } = useAccountMoveLines(orgId, { enabled: organizationId > 0 })
  const { data: taxes = [] } = useAccountTaxes(orgId, { enabled: organizationId > 0 })
  const { data: budgets = [] } = useCrossoveredBudgets(orgId, {
    enabled: organizationId > 0,
    initialData: initialBudgets,
  })
  const { data: budgetLines = [] } = useBudgetLines(orgId, { enabled: organizationId > 0 })
  const { data: budgetPosts = [] } = useBudgetPosts(orgId, { enabled: organizationId > 0 })
  const { data: taxDeadlines = [] } = useTaxDeadlines(orgId, { enabled: organizationId > 0 })
  const { data: analytic = [] } = useAccountAnalyticAccounts(orgId, { enabled: organizationId > 0 })
  const { data: analyticLines = [] } = useAccountAnalyticLines(orgId, { enabled: organizationId > 0 })
  const { data: analyticDistribution = [] } = useAccountAnalyticDistributionModels(orgId, {
    enabled: organizationId > 0,
  })
  const { data: bankStatements = [] } = useAccountBankStatements(orgId, { enabled: organizationId > 0 })
  const { data: bankStatementLines = [] } = useAccountBankStatementLines(orgId, { enabled: organizationId > 0 })
  const { data: bankMatchCandidates = [] } = useBankMatchCandidates(orgId, { enabled: organizationId > 0 })
  const { data: reconciliationWidgets = [] } = useAccountReconciliationWidgets(orgId, {
    enabled: organizationId > 0,
  })
  const { data: fixedAssets = [] } = useAccountFixedAssets(orgId, { enabled: organizationId > 0 })
  const { data: accountPayments = [] } = useAccountPayments(orgId, { enabled: organizationId > 0 })
  const { data: paymentTerms = [] } = useAccountPaymentTerms(orgId, { enabled: organizationId > 0 })
  const { data: paymentTermLines = [] } = useAccountPaymentTermLines(orgId, { enabled: organizationId > 0 })
  const { data: depreciationLines = [] } = useDepreciationLines(orgId, { enabled: organizationId > 0 })
  const { data: intercompanyRules = [] } = useIntercompanyRules(orgId, { enabled: organizationId > 0 })
  const { data: intercompanyTransactions = [] } = useIntercompanyTransactions(orgId, {
    enabled: organizationId > 0,
  })
  const { data: journals = [] } = useAccountJournals(orgId, { enabled: organizationId > 0 })
  const { data: accountTypes = [] } = useAccountAccountTypes(orgId, { enabled: organizationId > 0 })
  const { data: accountGroups = [] } = useAccountGroups(orgId, { enabled: organizationId > 0 })
  const { data: consolidationAccounts = [] } = useConsolidationAccounts(orgId, {
    enabled: organizationId > 0,
  })
  const { data: consolidationJournals = [] } = useConsolidationJournals(orgId, {
    enabled: organizationId > 0,
  })
  const { data: eliminationEntries = [] } = useConsolidationEliminationEntries(orgId, {
    enabled: organizationId > 0,
  })
  const { data: fiscalYearsRaw = [] } = useAccountFiscalYears(orgId, {
    enabled: organizationId > 0,
    initialData: initialFiscalYears,
    staleTime: 0,
  })
  const { data: accountPeriodsRaw = [] } = useAccountPeriods(orgId, {
    enabled: organizationId > 0,
    initialData: initialAccountPeriods,
  })
  const { data: financialReportsRaw = [] } = useFinancialReports(orgId)

  const createFiscalYear = useCreateFiscalYear(organizationId, operatingCompanyId)
  const updateFiscalYear = useUpdateFiscalYear(organizationId, operatingCompanyId)
  const deleteFiscalYear = useDeleteFiscalYear(organizationId, operatingCompanyId)
  const openFiscalYear = useOpenFiscalYear(organizationId, operatingCompanyId)
  const closeFiscalYear = useCloseFiscalYear(organizationId, operatingCompanyId)
  const setupFiscalCalendar = useSetupFiscalCalendar(organizationId, operatingCompanyId)

  const createAccountPeriod = useCreateAccountPeriod(organizationId, operatingCompanyId)
  const updateAccountPeriod = useUpdateAccountPeriod(organizationId, operatingCompanyId)
  const deleteAccountPeriod = useDeleteAccountPeriod(organizationId, operatingCompanyId)
  const openAccountPeriod = useOpenAccountPeriod(organizationId, operatingCompanyId)
  const closeAccountPeriod = useCloseAccountPeriod(organizationId, operatingCompanyId)

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
    const companyKey = operatingCompanyId > 0n ? String(operatingCompanyId) : null
    const rows = (fiscalYearsRaw as Record<string, unknown>[]).filter((fy) => {
      if (companyKey == null) return true
      const fyCompany = String(fy.companyId ?? fy.company_id ?? "")
      return fyCompany === "" || fyCompany === companyKey
    })
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
  }, [fiscalYearsRaw, operatingCompanyId, t])

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

  const creditNoteFormConfig = useMemo(() => createCreditNoteForm(t), [t])

  const defaultCurrencyId = useMemo(() => {
    for (const a of accounts) {
      const id = optionalBigIntU64((a as { currencyId?: unknown }).currencyId)
      if (id !== undefined) return id
    }
    return 1n
  }, [accounts])

  const paymentTermSelectOptions = useMemo(() => {
    const rows = paymentTerms as Record<string, unknown>[]
    if (rows.length === 0) {
      return [{ value: "", label: t("common.noData"), disabled: true }]
    }
    return rows.map((pt) => ({
      value: String(pt.id ?? ""),
      label: String(pt.name ?? pt.id ?? ""),
    }))
  }, [paymentTerms, t])

  const accountPaymentFormConfig = useMemo(() => {
    const merged = mergeSelectOptionsByFieldName(
      newAccountPaymentForm(t),
      "journalId",
      journalFieldOptionsForModularForm,
    )
    return mergeFieldDefaultValues(merged, { currencyId: String(defaultCurrencyId) })
  }, [t, journalFieldOptionsForModularForm, defaultCurrencyId])

  const paymentTermLineFormConfig = useMemo(
    () =>
      mergeSelectOptionsByFieldName(newPaymentTermLineForm(t), "paymentTermId", paymentTermSelectOptions),
    [t, paymentTermSelectOptions],
  )

  const accountJournalCreateFormConfig = useMemo(() => newAccountJournalForm(t), [t])

  const draftMoveSelectOptions = useMemo(() => {
    const drafts = (allMoves as Record<string, unknown>[]).filter(
      (m) => moveStateStr(m) === "Draft",
    )
    if (drafts.length === 0) {
      return [{ value: "", label: t("accounting.forms.addAccountMoveLine.fields.noDraftMoves"), disabled: true }]
    }
    return drafts.map((m) => ({
      value: String(m.id ?? ""),
      label: String(m.name ?? m.ref ?? m.id ?? ""),
    }))
  }, [allMoves, t])

  const accountSelectOptionsForMoveLine = useMemo(() => {
    const rows = accounts as Record<string, unknown>[]
    if (rows.length === 0) {
      return [{ value: "", label: t("common.noData"), disabled: true }]
    }
    return rows.map((a) => ({
      value: String(a.id ?? ""),
      label: `${String(a.code ?? "")} — ${String(a.name ?? a.id ?? "")}`,
    }))
  }, [accounts, t])

  const addMoveLineFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(addAccountMoveLineForm(t), {
        moveId: draftMoveSelectOptions,
        accountId: accountSelectOptionsForMoveLine,
      }),
    [t, draftMoveSelectOptions, accountSelectOptionsForMoveLine],
  )

  const journalEditFormConfig = useMemo(() => {
    const base = editAccountJournalForm(t)
    if (!journalEdit) return base
    return mergeFieldDefaultValues(base, {
      name: String(journalEdit.name ?? ""),
      code: String(journalEdit.code ?? ""),
      active: Boolean(journalEdit.active),
    })
  }, [journalEdit, t])

  const paymentTermLineEditFormConfig = useMemo(() => {
    const base = editPaymentTermLineForm(t)
    if (!paymentTermLineEdit) return base
    const valueRaw = paymentTermLineEdit.value
    const valueTag =
      valueRaw != null && typeof valueRaw === "object" && "tag" in valueRaw
        ? String((valueRaw as { tag: string }).tag)
        : String(valueRaw ?? "Balance")
    return mergeFieldDefaultValues(base, {
      value: valueTag,
      valueAmount: Number(paymentTermLineEdit.valueAmount ?? 0),
      days: Number(paymentTermLineEdit.days ?? 0),
      months: Number(paymentTermLineEdit.months ?? 0),
      sequence: Number(paymentTermLineEdit.sequence ?? 0),
      daysAfterEndOfMonth: Boolean(paymentTermLineEdit.daysAfterEndOfMonth),
    })
  }, [paymentTermLineEdit, t])

  const currencyRateFormConfig = useMemo(() => newCurrencyRateForm(t), [t])

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
  const createAccount = useCreateAccountAccount(organizationId)
  const createAccountType = useCreateAccountAccountType(organizationId)
  const updateAccountType = useUpdateAccountAccountType(organizationId)
  const createAccountGroup = useCreateAccountGroup(organizationId)
  const updateAccountGroup = useUpdateAccountGroup(organizationId)
  const createMove = useCreateAccountMove(organizationId)
  const createTax = useCreateAccountTax(organizationId)
  const createBudget = useCreateCrossoveredBudget(organizationId)
  const updateBudget = useUpdateCrossoveredBudget(organizationId)
  const createBudgetLine = useCreateBudgetLine(organizationId)
  const updateBudgetLine = useUpdateBudgetLine(organizationId)
  const confirmBudget = useConfirmBudget(organizationId)
  const validateBudget = useValidateBudget(organizationId)
  const doneBudget = useDoneBudget(organizationId)
  const cancelBudget = useCancelBudget(organizationId)
  const deleteBudgetLine = useDeleteBudgetLine(organizationId)
  const updateBudgetLineActuals = useUpdateBudgetLineActuals(organizationId)
  const createBudgetPost = useCreateBudgetPost(organizationId)
  const updateBudgetPost = useUpdateBudgetPost(organizationId)
  const postMove = usePostAccountMove(organizationId)
  const postInvoice = usePostInvoice(organizationId)
  const createCreditNote = useCreateCreditNoteFromInvoice(organizationId)
  const mailTemplatesQuery = useMailTemplates(organizationId, organizationId > 0)
  const queueMailFromTemplate = useQueueMailFromTemplate(
    organizationId,
    Number(operatingCompanyId),
  )
  const dispatchQueuedMail = useDispatchQueuedMail()
  const [invoiceDocBusy, setInvoiceDocBusy] = useState<"download" | "send" | null>(null)
  const cancelMove = useCancelAccountMove(organizationId)
  const addAccountMoveLine = useAddAccountMoveLine(organizationId)
  const deleteAccountMoveLine = useDeleteAccountMoveLine(organizationId)
  const createAccountJournal = useCreateAccountJournal(organizationId)
  const updateAccountJournal = useUpdateAccountJournal(organizationId)
  const computeInvoiceTotals = useComputeInvoiceTotals(organizationId, operatingCompanyId)
  const refreshTaxDeadlineStatuses = useRefreshTaxDeadlineStatuses(organizationId)
  const scheduleTaxDeadlineUpdates = useScheduleTaxDeadlineUpdates(organizationId)
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

  const deleteAccountAsset = useDeleteAccountAsset(organizationId, operatingCompanyId)
  const confirmAccountAsset = useConfirmAccountAsset(organizationId, operatingCompanyId)
  const closeAccountAsset = useCloseAccountAsset(organizationId, operatingCompanyId)
  const createDepreciationLine = useCreateDepreciationLine(organizationId, operatingCompanyId)
  const computeDepreciationBoard = useComputeDepreciationBoard(organizationId, operatingCompanyId)

  const createIntercompanyRule = useCreateIntercompanyRule(organizationId)
  const updateIntercompanyRule = useUpdateIntercompanyRule(organizationId, operatingCompanyId)
  const deleteIntercompanyRule = useDeleteIntercompanyRule(organizationId, operatingCompanyId)
  const setIntercompanyRuleActive = useSetIntercompanyRuleActive(organizationId, operatingCompanyId)
  const createIntercompanyTransaction = useCreateIntercompanyTransaction(organizationId)
  const approveIntercompanyTransaction = useApproveIntercompanyTransaction(organizationId, operatingCompanyId)
  const processIntercompanyTransaction = useProcessIntercompanyTransaction(organizationId, operatingCompanyId)
  const completeIntercompanyTransaction = useCompleteIntercompanyTransaction(organizationId, operatingCompanyId)
  const errorIntercompanyTransaction = useErrorIntercompanyTransaction(organizationId, operatingCompanyId)
  const cancelIntercompanyTransaction = useCancelIntercompanyTransaction(organizationId, operatingCompanyId)
  const retryIntercompanyTransaction = useRetryIntercompanyTransaction(organizationId, operatingCompanyId)

  const updateAccountMoveLine = useUpdateAccountMoveLine(organizationId, operatingCompanyId)
  const reconcilePaymentWithInvoice = useReconcilePaymentWithInvoice(organizationId, operatingCompanyId)
  const csvImports = useAccountingCsvImportMutations(organizationId, operatingCompanyId)

  const createAccountPayment = useCreateAccountPayment(organizationId)
  const postAccountPayment = usePostAccountPayment(organizationId)
  const cancelAccountPayment = useCancelAccountPayment(organizationId)
  const registerPaymentOnInvoice = useRegisterPaymentOnInvoice(organizationId)
  const createPaymentTerm = useCreatePaymentTerm(organizationId)
  const updatePaymentTerm = useUpdatePaymentTerm(organizationId)
  const deletePaymentTerm = useDeletePaymentTerm(organizationId)
  const createPaymentTermLine = useCreatePaymentTermLine(organizationId)
  const updatePaymentTermLine = useUpdatePaymentTermLine(organizationId)
  const deletePaymentTermLine = useDeletePaymentTermLine(organizationId)
  const createCurrencyRate = useCreateCurrencyRate(organizationId, operatingCompanyId)
  const setAccountAssetActive = useSetAccountAssetActive(organizationId, operatingCompanyId)

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
    const rawTags = analyticLineEdit.tagIds
    const tagIdsStr =
      Array.isArray(rawTags) && rawTags.length > 0
        ? rawTags.map((x) => String(x)).join(", ")
        : ""
    return mergeFieldDefaultValues(base, {
      lineId: String(analyticLineEdit.id ?? ""),
      name: String(analyticLineEdit.name ?? ""),
      amount: Number(analyticLineEdit.amount ?? 0),
      tagIds: tagIdsStr,
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
  }, [bankLineMatchFocus?.id, bankLineMatchFocus?.amount])

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
      const params = toUpdateAnalyticAccountParams(
        {
          name: formData.name,
          code: formData.code,
          isRequiredInMoveLines: formData.isRequiredInMoveLines,
        },
        operatingCompanyId,
      )
      await updateAnalyticAccount.mutateAsync({
        accountId: id,
        params: analyticParamsToJson(params, "UpdateAnalyticAccountParams"),
      })
      if (nextActive !== prevActive) {
        await setAnalyticAccountActive.mutateAsync({ accountId: id, active: nextActive })
      }
      setAnalyticAccountEdit(null)
    },
    [analyticAccountEdit, operatingCompanyId, updateAnalyticAccount, setAnalyticAccountActive],
  )

  const onSubmitAnalyticLineEdit = useCallback(
    async (formData: Record<string, unknown>) => {
      const lineIdRaw = formData.lineId
      if (lineIdRaw === "" || lineIdRaw == null) return
      const id = BigInt(String(lineIdRaw))
      const params = toUpdateAnalyticLineParams({
        ...formData,
        unitAmount: formData.unitAmount ?? formData.amount,
      })
      await updateAnalyticLine.mutateAsync({
        lineId: id,
        params: analyticParamsToJson(params, "UpdateAnalyticLineParams"),
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
      const params = toUpdateAnalyticDistributionModelParams(
        {
          name: formData.name,
          analyticDistribution: formData.analyticDistribution,
          isActive: formData.isActive,
        },
        operatingCompanyId,
      )
      await updateAnalyticDistributionModel.mutateAsync({
        modelId: id,
        params: analyticParamsToJson(params, "UpdateAnalyticDistributionModelParams"),
      })
      setAnalyticDistEdit(null)
    },
    [operatingCompanyId, updateAnalyticDistributionModel],
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

  const fiscalYearsEntityConfig = useMemo((): EntityViewConfig => {
    const base = fiscalYearsTableConfig(t)
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: "fy-setup-wizard",
            label: t("accounting.entities.fiscalYears.actions.setupCalendar"),
            onClick: () => {
              setFiscalSetupError(null)
              setFiscalSetupOpen(true)
            },
          },
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

  const fiscalSetupFormConfig = useMemo((): FormConfig => {
    const year = new Date().getFullYear()
    return {
      id: "fiscal-setup-wizard",
      title: t("accounting.fiscalSetup.title"),
      description: t("accounting.fiscalSetup.description"),
      submitLabel: t("accounting.fiscalSetup.submit"),
      sections: [
        {
          id: "setup",
          fields: [
            {
              id: "fiscalYearName",
              name: "fiscalYearName",
              label: t("accounting.fiscalSetup.fields.name"),
              type: "text",
              required: true,
              defaultValue: String(year),
            },
            {
              id: "dateFrom",
              name: "dateFrom",
              label: t("accounting.fiscalSetup.fields.dateFrom"),
              type: "date",
              required: true,
              defaultValue: `${year}-01-01`,
            },
            {
              id: "dateTo",
              name: "dateTo",
              label: t("accounting.fiscalSetup.fields.dateTo"),
              type: "date",
              required: true,
              defaultValue: `${year}-12-31`,
            },
            {
              id: "openFirstPeriod",
              name: "openFirstPeriod",
              label: t("accounting.fiscalSetup.fields.openFirstPeriod"),
              type: "checkbox",
              defaultValue: true,
            },
          ],
        },
      ],
    }
  }, [t])

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
            id: "asset-activate",
            label: t("accounting.entities.fixedAssets.actions.activateSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                const row = r as Record<string, unknown>
                if (row.active === false) {
                  void setAccountAssetActive.mutateAsync({
                    assetId: BigInt(String(row.id)),
                    active: true,
                  })
                }
              }
            },
          },
          {
            id: "asset-deactivate",
            label: t("accounting.entities.fixedAssets.actions.deactivateSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                const row = r as Record<string, unknown>
                if (row.active === true) {
                  void setAccountAssetActive.mutateAsync({
                    assetId: BigInt(String(row.id)),
                    active: false,
                  })
                }
              }
            },
          },
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
  }, [
    t,
    setAccountAssetActive,
    confirmAccountAsset,
    closeAccountAsset,
    deleteAccountAsset,
    computeDepreciationBoard,
  ])

  const accountPaymentsEntityConfig = useMemo((): EntityViewConfig => {
    const base = accountPaymentsTableConfig(t)
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: "pay-post",
            label: t("accounting.entities.payments.actions.postSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                if (paymentStateTag(r as Record<string, unknown>) === "NotPaid") {
                  void postAccountPayment.mutateAsync(BigInt(String((r as Record<string, unknown>).id)))
                }
              }
            },
          },
          {
            id: "pay-cancel",
            label: t("accounting.entities.payments.actions.cancelSelected"),
            requiresSelection: true,
            variant: "destructive",
            onClick: (rows) => {
              for (const r of rows) {
                const st = paymentStateTag(r as Record<string, unknown>)
                if (st === "NotPaid" || st === "Paid") {
                  void cancelAccountPayment.mutateAsync(BigInt(String((r as Record<string, unknown>).id)))
                }
              }
            },
          },
          {
            id: "pay-link",
            label: t("accounting.entities.payments.actions.linkInvoices"),
            requiresSelection: true,
            onClick: (rows) => {
              if (rows.length !== 1) return
              const r = rows[0] as Record<string, unknown>
              if (r.id == null) return
              if (paymentStateTag(r) !== "Paid") return
              setRegisterPaymentError(null)
              setRegisterPaymentForId(BigInt(String(r.id)))
            },
          },
          {
            id: "pay-reconcile-moves",
            label: t("accounting.entities.payments.actions.reconcileMoves"),
            onClick: () => {
              setReconcilePaymentError(null)
              setReconcilePaymentOpen(true)
            },
          },
        ],
      },
    }
  }, [t, postAccountPayment, cancelAccountPayment])

  const paymentTermsEntityConfig = useMemo((): EntityViewConfig => {
    const base = paymentTermsTableConfig(t)
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: "pt-activate",
            label: t("accounting.entities.paymentTerms.actions.activateSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                if (!paymentTermIsActive(r as Record<string, unknown>)) {
                  void updatePaymentTerm.mutateAsync({
                    termId: BigInt(String((r as Record<string, unknown>).id)),
                    name: null,
                    note: null,
                    isActive: true,
                  })
                }
              }
            },
          },
          {
            id: "pt-deactivate",
            label: t("accounting.entities.paymentTerms.actions.deactivateSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              for (const r of rows) {
                if (paymentTermIsActive(r as Record<string, unknown>)) {
                  void updatePaymentTerm.mutateAsync({
                    termId: BigInt(String((r as Record<string, unknown>).id)),
                    name: null,
                    note: null,
                    isActive: false,
                  })
                }
              }
            },
          },
          {
            id: "pt-delete",
            label: t("accounting.entities.paymentTerms.actions.deleteSelected"),
            requiresSelection: true,
            variant: "destructive",
            onClick: (rows) => {
              for (const r of rows) {
                void deletePaymentTerm.mutateAsync(BigInt(String((r as Record<string, unknown>).id)))
              }
            },
          },
        ],
      },
    }
  }, [t, updatePaymentTerm, deletePaymentTerm])

  const paymentTermLinesEntityConfig = useMemo((): EntityViewConfig => {
    const base = paymentTermLinesTableConfig(t)
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: "ptl-edit",
            label: t("accounting.entities.paymentTerms.actions.editLinesSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              const row = rows[0]
              if (row) setPaymentTermLineEdit(row)
            },
          },
          {
            id: "ptl-delete",
            label: t("accounting.entities.paymentTerms.actions.deleteLinesSelected"),
            requiresSelection: true,
            variant: "destructive",
            onClick: (rows) => {
              for (const r of rows) {
                void deletePaymentTermLine.mutateAsync(BigInt(String((r as Record<string, unknown>).id)))
              }
            },
          },
        ],
      },
    }
  }, [t, deletePaymentTermLine])

  const accountJournalsEntityConfig = useMemo((): EntityViewConfig => {
    const base = accountJournalsTableConfig(t)
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: "journal-edit",
            label: t("accounting.entities.journals.actions.editSelected"),
            requiresSelection: true,
            onClick: (rows) => {
              const row = rows[0]
              if (row) setJournalEdit(row)
            },
          },
        ],
      },
    }
  }, [t])

  const accountMoveLinesEntityConfig = useMemo((): EntityViewConfig => {
    const base = accountMoveLinesTableConfig(t)
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: "move-line-delete",
            label: t("accounting.entities.moveLines.actions.deleteSelected"),
            requiresSelection: true,
            variant: "destructive",
            onClick: (rows) => {
              for (const r of rows) {
                void deleteAccountMoveLine.mutateAsync([
                  organizationId,
                  BigInt(String((r as Record<string, unknown>).id)),
                  stdbParamsToJson({ companyId: operatingCompanyId }),
                ])
              }
            },
          },
        ],
      },
    }
  }, [t, deleteAccountMoveLine, organizationId, operatingCompanyId])

  // Helper to get intercompany rule active state
  const intercompanyRuleIsActive = useCallback((row: Record<string, unknown>): boolean => {
    return row.isActive === true
  }, []);

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
  }, [t, setIntercompanyRuleActive, deleteIntercompanyRule, intercompanyRuleIsActive])

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
      if (!row.id) return
      const id = row.id as string | number | bigint
      const mt = moveTypeTag(row)
      if (isInvoiceLikeMoveType(mt)) {
        const resolved = resolveDefaultCogsInventoryAccountIds(
          accounts as readonly Record<string, unknown>[],
        )
        const needsCogsAccounts = mt === "OutInvoice" || mt === "OutRefund"
        if (needsCogsAccounts && resolved == null) {
          toast({
            variant: "destructive",
            title: t("accounting.invoices.invoiceActions.postDraft"),
            description: t("accounting.invoices.postMissingCogsAccounts"),
          })
          return
        }
        const cogsId = resolved?.cogsAccountId ?? 0
        const invId = resolved?.inventoryAccountId ?? 0
        postInvoice.mutate([organizationId, id, cogsId, invId])
      } else {
        postMove.mutate([organizationId, id])
      }
    },
    [postMove, postInvoice, organizationId, accounts, toast, t],
  )

  const handleInvoiceDownloadPdf = useCallback(async () => {
    if (!selectedInvoice?.id) return
    try {
      setInvoiceDocBusy("download")
      await downloadDocumentPdf("account-move", Number(selectedInvoice.id))
    } catch (e) {
      toast({
        variant: "destructive",
        title: t("accounting.invoices.invoiceActions.download"),
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setInvoiceDocBusy(null)
    }
  }, [selectedInvoice, toast, t])

  const handleInvoiceSendEmail = useCallback(async () => {
    if (!selectedInvoice?.id) return
    const recipient = window.prompt("Recipient email address")
    if (!recipient?.trim()) return
    const template = (mailTemplatesQuery.data ?? []).find(
      (row) =>
        (row.model ?? "") === "account_move" &&
        (row.isActive ?? row.is_active) !== false,
    )
    if (!template?.id) {
      toast({
        variant: "destructive",
        title: t("accounting.invoices.invoiceActions.send"),
        description: "No active mail template for account_move. Create one in settings first.",
      })
      return
    }
    try {
      setInvoiceDocBusy("send")
      await queueMailFromTemplate.mutateAsync({
        templateId: Number(template.id),
        model: "account_move",
        resId: Number(selectedInvoice.id),
        recipientEmail: recipient.trim(),
      })
      const dispatchResult = await dispatchQueuedMail.mutateAsync()
      toast({
        title: t("accounting.invoices.invoiceActions.send"),
        description: `Queued and dispatched ${dispatchResult.sent ?? 0} email(s).`,
      })
    } catch (e) {
      toast({
        variant: "destructive",
        title: t("accounting.invoices.invoiceActions.send"),
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setInvoiceDocBusy(null)
    }
  }, [
    selectedInvoice,
    mailTemplatesQuery.data,
    queueMailFromTemplate,
    dispatchQueuedMail,
    toast,
    t,
  ])

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
            currency_rate: () =>
              setQuickActionForm({ form: currencyRateFormConfig, action: "createCurrencyRate" }),
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
        if (w.id === "acc-tax-deadlines") {
          const nowMs = Date.now()
          const rows = (taxDeadlines as Record<string, unknown>[])
            .filter((d) => d.deletedAt == null && d.deleted_at == null)
            .filter((d) => {
              const st = taxDeadlineStatusStr(d)
              return st !== "Completed" && st !== "Waived"
            })
            .sort((a, b) => {
              const ta = stdbTimestampToMs(a.dueDate ?? a.due_date) ?? Number.POSITIVE_INFINITY
              const tb = stdbTimestampToMs(b.dueDate ?? b.due_date) ?? Number.POSITIVE_INFINITY
              return ta - tb
            })
            .slice(0, 5)
          const deadlines = rows.map((d) => {
            const dueMs = stdbTimestampToMs(d.dueDate ?? d.due_date) ?? nowMs
            const daysUntil = Math.round((dueMs - nowMs) / 86_400_000)
            return {
              title: String(d.title ?? ""),
              dueDate: new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
                new Date(dueMs),
              ),
              status: taxDeadlineStatusStr(d),
              daysUntil,
            }
          })
          return { ...w, data: { deadlines } }
        }
        return w
      }),
    }))
  }, [
    accounts,
    invoices,
    bills,
    budgets,
    taxDeadlines,
    moduleConfigBase,
    t,
    journalEntryFormConfig,
    currencyRateFormConfig,
  ])

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
          const p = toCreateAccountGroupParams(fd, operatingCompanyId)
          if (p.name.trim()) {
            await createAccountGroup.mutateAsync(p as unknown as Record<string, unknown>)
          }
        }}
        onUpdateAccountGroup={async (groupId, fd) => {
          await updateAccountGroup.mutateAsync({
            groupId,
            params: toUpdateAccountGroupParams(fd, operatingCompanyId) as unknown as Record<string, unknown>,
          })
        }}
      />
    ),
    [
      accountTypes,
      accountGroups,
      operatingCompanyId,
      createAccountType,
      updateAccountType,
      createAccountGroup,
      updateAccountGroup,
    ],
  )

  // ── Form submit handler (entity tabs: taxes, budgets) ───────────────────────
  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (action === "createAccount") {
      const p = toCreateAccountAccountParams(formData, {
        accountTypes: accountTypes as Record<string, unknown>[],
      })
      if (p) await createAccount.mutateAsync([organizationId, createAccountAccountParamsToStdbHttpJson(p)])
    } else if (action === "createMove") {
      const p = toCreateJournalEntryMoveParams(formData)
      if (p) await createMove.mutateAsync([organizationId, accountingParamsToJson(p, "CreateAccountMoveParams")])
    } else if (action === "createTax") {
      await createTax.mutateAsync([
        organizationId,
        operatingCompanyId,
        createAccountTaxParamsToStdbHttpJson(toCreateAccountTaxParams(formData)),
      ])
    } else if (action === "createBudget") {
      await createBudget.mutateAsync(accountingParamsToJson(toCreateCrossoveredBudgetParams(formData), "CreateCrossoveredBudgetParams"))
    } else if (action === "createAnalyticAccount") {
      const fd = { ...formData }
      if (fd.currencyId === "" || fd.currencyId == null) {
        fd.currencyId = defaultCurrencyId.toString()
      }
      const p = toCreateAnalyticAccountParams(fd, defaultCurrencyId, operatingCompanyId)
      if (p) await createAnalyticAccount.mutateAsync(analyticParamsToJson(p, "CreateAnalyticAccountParams"))
    } else if (action === "createAnalyticLine") {
      const p = toCreateAnalyticLineParams(formData, defaultCurrencyId)
      if (p) await createAnalyticLine.mutateAsync(analyticParamsToJson(p, "CreateAnalyticLineParams"))
    } else if (action === "createAnalyticDistributionModel") {
      const p = toCreateAnalyticDistributionModelParams(formData, operatingCompanyId)
      if (p) await createAnalyticDistributionModel.mutateAsync(analyticParamsToJson(p, "CreateAnalyticDistributionModelParams"))
    } else if (action === "createReconciliationWidget") {
      const p = toCreateAccountReconciliationWidgetParams(formData)
      if (p) await createReconciliationWidget.mutateAsync(reconciliationWidgetParamsToJson(p))
    } else if (action === "createFiscalYear") {
      if (operatingCompanyId <= 0n) {
        throw new Error("No operating company is available for this organization")
      }
      const p = toCreateFiscalYearParams(formData)
      if (p) await createFiscalYear.mutateAsync(accountingParamsToJson(p, "CreateFiscalYearParams"))
    } else if (action === "createAccountPeriod") {
      const p = toCreateAccountPeriodParams(formData)
      if (p) await createAccountPeriod.mutateAsync(accountingParamsToJson(p, "CreateAccountPeriodParams"))
    } else if (action === "createAccountPayment") {
      const p = toCreatePaymentParamsFromManualForm(formData, operatingCompanyId)
      if (p) await createAccountPayment.mutateAsync(p)
    } else if (action === "createPaymentTerm") {
      const p = toCreatePaymentTermParamsFromForm(formData)
      if (p) await createPaymentTerm.mutateAsync(stdbParamsToJson(p, "CreatePaymentTermParams"))
    } else if (action === "createPaymentTermLine") {
      const p = toCreatePaymentTermLineParamsFromForm(formData)
      if (p) await createPaymentTermLine.mutateAsync(stdbParamsToJson(p, "CreatePaymentTermLineParams"))
    } else if (action === "createAccountJournal") {
      const params = toCreateAccountJournalParamsFromForm(formData, operatingCompanyId)
      await createAccountJournal.mutateAsync([
        organizationId,
        accountingParamsToJson(params, "CreateAccountJournalParams"),
      ])
    } else if (action === "addAccountMoveLine") {
      const parsed = toAddAccountMoveLineParamsFromForm(formData)
      if (parsed) {
        await addAccountMoveLine.mutateAsync([
          organizationId,
          parsed.moveId,
          accountingParamsToJson(parsed.params, "AddAccountMoveLineParams"),
        ])
      }
    } else if (action === "createCurrencyRate") {
      const p = toCreateCurrencyRateParamsFromForm(formData)
      if (p) await createCurrencyRate.mutateAsync(p)
    }
  }

  useEffect(() => {
    if (csvKind) setCsvError(null)
  }, [csvKind])

  const addCsvToolbar = useCallback(
    (ec: EntityViewConfig, actions: Array<{ id: string; label: string; onClick: () => void }>): EntityViewConfig => {
      if (ec.view.mode !== "table") return ec
      return {
        ...ec,
        view: {
          ...ec.view,
          rowSelectionToggleOnClick: false,
          actions,
        },
      }
    },
    [],
  )

  const csvFormConfig = useMemo(() => {
    if (!csvKind) return null
    const titleKey: Record<AccountingCsvImportKind, string> = {
      account: "accounting.csvImport.accountsTitle",
      accountMove: "accounting.csvImport.movesTitle",
      accountMoveLine: "accounting.csvImport.moveLinesTitle",
      tax: "accounting.csvImport.taxTitle",
      budget: "accounting.csvImport.budgetTitle",
      budgetLine: "accounting.csvImport.budgetLineTitle",
      analytic: "accounting.csvImport.analyticTitle",
    }
    return csvImportForm(t, t(titleKey[csvKind]))
  }, [csvKind, t])

  // ── Config: inject rich custom content for invoices/bills/accounts/ledger ───
  const config = useMemo(
    () => {
      // Omit `tabs` from spread so static analysis (and runtime) only see the mapped tabs below.
      const { tabs: _ignoreBaseTabs, ...moduleWithoutTabs } = moduleConfigBase
      return {
        ...moduleWithoutTabs,
        tabs: (() => {
          const mapped = moduleConfigBase.tabs.map((tab) => {
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
              const { createForm: _cf, createAction: _ca, createLabel: _cl, ...tabRest } = tab
              return {
                ...tabRest,
                type: "custom" as const,
                customContent: (
                  <InvoiceListView
                    invoices={invoices as unknown as AccountMove[]}
                    onSelectInvoice={(invoice) => setSelectedInvoice(invoice as unknown as AccountMove)}
                    onCreateInvoice={() => setShowCreateInvoice(true)}
                    onRecalculateTotals={(inv) =>
                      void computeInvoiceTotals.mutateAsync(inv.id as string | number | bigint)
                    }
                  />
                ),
              }
            }
            if (tab.id === "bills") {
              const { createForm: _cf, createAction: _ca, createLabel: _cl, ...tabRest } = tab
              return {
                ...tabRest,
                type: "custom" as const,
                customContent: (
                  <BillsListView
                    bills={bills as unknown as AccountMove[]}
                    onCreateBill={() => setShowCreateBill(true)}
                    onSelectBill={(bill) => setSelectedInvoice(bill as unknown as AccountMove)}
                    onRecalculateTotals={(bill) =>
                      void computeInvoiceTotals.mutateAsync(bill.id as string | number | bigint)
                    }
                  />
                ),
              }
            }
            if (tab.id === "accounts") {
              const { createForm: _cf, createAction: _ca, createLabel: _cl, ...tabRest } = tab
              return {
                ...tabRest,
                type: "custom" as const,
                customContent: (
                  <ChartOfAccountsView
                    accounts={accounts as unknown as Parameters<typeof ChartOfAccountsView>[0]["accounts"]}
                    chartStructureContent={chartStructurePanel}
                    onImportAccountsCsv={() => setCsvKind("account")}
                    onAccountClick={(account) => setGlDrilldownAccount(account)}
                    onCreate={async (data) => {
                      const p = toCreateAccountAccountParams(data as Record<string, unknown>, {
                        accountTypes: accountTypes as Record<string, unknown>[],
                      })
                      if (p) await createAccount.mutateAsync([organizationId, createAccountAccountParamsToStdbHttpJson(p)])
                    }}
                  />
                ),
              }
            }
            if (tab.id === "journal-entries") {
              const { createForm: _cf, createAction: _ca, createLabel: _cl, ...tabRest } = tab
              return {
                ...tabRest,
                type: "custom" as const,
                customContent: (
                  <GeneralLedgerView
                    moves={allMoves as unknown as AccountMove[]}
                    onImportMovesCsv={() => setCsvKind("accountMove")}
                    onImportMoveLinesCsv={() => setCsvKind("accountMoveLine")}
                    onCreate={() => setQuickActionForm({ form: journalEntryFormConfig, action: "createMove" })}
                    onPostMove={(move) => postDraft(move)}
                    onCancelMove={(move) =>
                      cancelMove.mutate([organizationId, move.id as string | number | bigint])
                    }
                    onComputeInvoiceTotals={(move) =>
                      void computeInvoiceTotals.mutateAsync(move.id as string | number | bigint)
                    }
                    postMovePending={postMove.isPending || postInvoice.isPending}
                    cancelMovePending={cancelMove.isPending}
                    computeInvoiceTotalsPending={computeInvoiceTotals.isPending}
                  />
                ),
              }
            }
            if (tab.id === "budgets") {
              return {
                ...tab,
                type: "custom" as const,
                customContent: (
                  <div className="space-y-3">
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" onClick={() => setCsvKind("budget")}>
                        {t("accounting.csvImport.toolbarBudgets")}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setCsvKind("budgetLine")}>
                        {t("accounting.csvImport.toolbarBudgetLines")}
                      </Button>
                    </div>
                    <BudgetsWorkspace
                      budgets={budgets as unknown as Record<string, unknown>[]}
                      budgetLines={budgetLines as unknown as Record<string, unknown>[]}
                      budgetPosts={budgetPosts as unknown as Record<string, unknown>[]}
                      onCreateBudget={(params) =>
                        createBudget.mutateAsync(accountingParamsToJson(toCreateCrossoveredBudgetParams(params), "CreateCrossoveredBudgetParams"))
                      }
                      onUpdateBudget={(budgetId, params) =>
                        updateBudget.mutateAsync([
                          organizationId,
                          budgetId,
                          stdbParamsToJson(toUpdateBudgetParams(params)),
                        ])
                      }
                      onCreateBudgetLine={(budgetId, params) =>
                        createBudgetLine.mutateAsync([
                          organizationId,
                          budgetId,
                          stdbParamsToJson(toCreateBudgetLineParams(params)),
                        ])
                      }
                      onUpdateBudgetLine={(lineId, params) =>
                        updateBudgetLine.mutateAsync([
                          organizationId,
                          lineId,
                          stdbParamsToJson(toUpdateBudgetLineParams(params)),
                        ])
                      }
                      onConfirmBudget={(budgetId) => confirmBudget.mutateAsync(budgetId)}
                      onValidateBudget={(budgetId) => validateBudget.mutateAsync(budgetId)}
                      onDoneBudget={(budgetId) => doneBudget.mutateAsync(budgetId)}
                      onCancelBudget={(budgetId) => cancelBudget.mutateAsync(budgetId)}
                      onDeleteBudgetLine={(lineId) => deleteBudgetLine.mutateAsync(lineId)}
                      onUpdateLineActuals={(lineId, params) =>
                        updateBudgetLineActuals.mutateAsync({ lineId, params })
                      }
                      onCreateBudgetPost={(params) =>
                        createBudgetPost.mutateAsync(stdbParamsToJson(toCreateBudgetPostParams(params)))
                      }
                      onUpdateBudgetPost={(postId, params) =>
                        updateBudgetPost.mutateAsync({
                          postId,
                          params: stdbParamsToJson(toUpdateBudgetPostParams(params)),
                        })
                      }
                      workflowPending={
                        confirmBudget.isPending ||
                        validateBudget.isPending ||
                        doneBudget.isPending ||
                        cancelBudget.isPending
                      }
                      linePending={
                        createBudgetLine.isPending ||
                        updateBudgetLine.isPending ||
                        deleteBudgetLine.isPending ||
                        updateBudgetLineActuals.isPending
                      }
                      postPending={createBudgetPost.isPending || updateBudgetPost.isPending}
                    />
                  </div>
                ),
              }
            }
            if (tab.id === "taxes" && tab.entityConfig) {
              return {
                ...tab,
                entityConfig: addCsvToolbar(tab.entityConfig, [
                  {
                    id: "csv-tax",
                    label: t("accounting.csvImport.toolbarTaxRates"),
                    onClick: () => setCsvKind("tax"),
                  },
                  {
                    id: "tax-refresh-deadline-statuses",
                    label: t("accounting.taxes.refreshDeadlineStatuses"),
                    onClick: () => void refreshTaxDeadlineStatuses.mutateAsync(),
                  },
                  {
                    id: "tax-schedule-deadline-updates",
                    label: t("accounting.taxes.scheduleDeadlineUpdates"),
                    onClick: () => void scheduleTaxDeadlineUpdates.mutateAsync(),
                  },
                ]),
              }
            }
            if (tab.id === "analytic" && tab.entityConfig) {
              return {
                ...tab,
                entityConfig: addCsvToolbar(tab.entityConfig, [
                  {
                    id: "csv-analytic",
                    label: t("accounting.csvImport.toolbarAnalytic"),
                    onClick: () => setCsvKind("analytic"),
                  },
                ]),
              }
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
            if (tab.id === "payments") {
              return {
                ...tab,
                createForm: accountPaymentFormConfig,
                entityConfig: accountPaymentsEntityConfig,
              }
            }
            if (tab.id === "payment-terms") {
              return { ...tab, entityConfig: paymentTermsEntityConfig }
            }
            if (tab.id === "payment-term-lines") {
              return {
                ...tab,
                createForm: paymentTermLineFormConfig,
                entityConfig: paymentTermLinesEntityConfig,
              }
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
          }).concat([
            {
              id: "account-journals",
              label: t("accounting.tabs.journals"),
              type: "entity" as const,
              entityConfig: accountJournalsEntityConfig,
              createForm: accountJournalCreateFormConfig,
              createLabel: t("accounting.actions.newJournal"),
              createAction: "createAccountJournal",
            },
            {
              id: "move-lines",
              label: t("accounting.tabs.moveLines"),
              type: "entity" as const,
              entityConfig: accountMoveLinesEntityConfig,
              createForm: addMoveLineFormConfig,
              createLabel: t("accounting.actions.addMoveLine"),
              createAction: "addAccountMoveLine",
            },
          ])
          const periodCloseTab = {
            id: "period-close",
            label: t("accounting.periodClose.tab"),
            type: "custom" as const,
            customContent: (
              <PeriodCloseChecklist
                companyId={operatingCompanyId}
                fiscalYears={fiscalYearsRaw as Record<string, unknown>[]}
                accountPeriods={accountPeriodsRaw as Record<string, unknown>[]}
                moves={allMoves as Record<string, unknown>[]}
                bankStatementLines={bankStatementLines as Record<string, unknown>[]}
                financialReports={financialReportsRaw as Record<string, unknown>[]}
                onNavigateToTab={setAccountingActiveTab}
              />
            ),
          }
          const dashIdx = mapped.findIndex((row) => row.id === "dashboard")
          if (dashIdx < 0) return [...mapped, periodCloseTab]
          return [
            ...mapped.slice(0, dashIdx + 1),
            periodCloseTab,
            ...mapped.slice(dashIdx + 1),
          ]
        })(),
      } as ModuleConfig
    },
    [
      liveSections,
      chartStructurePanel,
      invoices,
      bills,
      accountTypes,
      accounts,
      allMoves,
      bankStatements,
      bankStatementsEntityConfig,
      createAccount.mutate,
      organizationId,
      budgets,
      budgetLines,
      budgetPosts,
      createBudget.mutateAsync,
      updateBudget.mutateAsync,
      createBudgetLine.mutateAsync,
      updateBudgetLine.mutateAsync,
      confirmBudget.mutateAsync,
      validateBudget.mutateAsync,
      doneBudget.mutateAsync,
      cancelBudget.mutateAsync,
      deleteBudgetLine.mutateAsync,
      updateBudgetLineActuals.mutateAsync,
      createBudgetPost.mutateAsync,
      updateBudgetPost.mutateAsync,
      createBudgetLine.isPending,
      updateBudgetLine.isPending,
      confirmBudget.isPending,
      validateBudget.isPending,
      doneBudget.isPending,
      cancelBudget.isPending,
      deleteBudgetLine.isPending,
      updateBudgetLineActuals.isPending,
      createBudgetPost.isPending,
      updateBudgetPost.isPending,
      t,
      moduleConfigBase,
      journalEntryFormConfig,
      fiscalYearsEntityConfig,
      accountPeriodsEntityConfig,
      accountPeriodCreateFormConfig,
      fixedAssetsEntityConfig,
      accountPaymentFormConfig,
      accountPaymentsEntityConfig,
      paymentTermsEntityConfig,
      paymentTermLineFormConfig,
      paymentTermLinesEntityConfig,
      intercompanyRulesEntityConfig,
      intercompanyTransactionsEntityConfig,
      postMove,
      postInvoice,
      cancelMove,
      computeInvoiceTotals.mutateAsync,
      refreshTaxDeadlineStatuses.mutateAsync,
      scheduleTaxDeadlineUpdates.mutateAsync,
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
      addCsvToolbar,
      computeInvoiceTotals.isPending,
      operatingCompanyId,
      fiscalYearsRaw,
      accountPeriodsRaw,
      bankStatementLines,
      financialReportsRaw,
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
      payments: accountPayments as unknown as Record<string, unknown>[],
      "payment-terms": paymentTerms as unknown as Record<string, unknown>[],
      "payment-term-lines": paymentTermLines as unknown as Record<string, unknown>[],
      "account-journals": journals as unknown as Record<string, unknown>[],
      "move-lines": accountMoveLines as unknown as Record<string, unknown>[],
    }),
    [
      taxes,
      budgets,
      analytic,
      analyticLines,
      analyticDistribution,
      reconciliationWidgets,
      fixedAssets,
      accountPayments,
      paymentTerms,
      paymentTermLines,
      journals,
      accountMoveLines,
      fiscalYearsDisplay,
      accountPeriodsDisplay,
      intercompanyRules,
      intercompanyTransactions,
    ],
  )

  const handleEntityRowClick = useCallback((tabId: string, row: Record<string, unknown>) => {
    const target = chatterTargetFromRow("accounting", tabId, row)
    if (target) {
      setChatterTarget(target)
      return
    }
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
    } else if (tabId === "payment-term-lines") {
      setPaymentTermLineEdit(row)
    } else if (tabId === "account-journals") {
      setJournalEdit(row)
    }
  }, [])

  return (
    <>
      <ModuleView
        config={config}
        data={data}
        onFormSubmit={handleFormSubmit}
        onRowClick={handleEntityRowClick}
        activeTab={accountingActiveTab}
        onActiveTabChange={setAccountingActiveTab}
      />

      <AccountGlDrilldownPanel
        account={glDrilldownAccount}
        moveLines={accountMoveLines as Record<string, unknown>[]}
        moves={allMoves as unknown as AccountMove[]}
        open={glDrilldownAccount != null}
        onOpenChange={(open) => {
          if (!open) setGlDrilldownAccount(null)
        }}
      />

      {chatterTarget ? (
        <RecordChatterDialog
          key={`${chatterTarget.resModel}-${chatterTarget.resId.toString()}`}
          open
          onOpenChange={(open) => {
            if (!open) setChatterTarget(null)
          }}
          organizationId={organizationId}
          resModel={chatterTarget.resModel}
          resId={chatterTarget.resId}
          recordTitle={chatterTarget.recordTitle}
        />
      ) : null}

      {fiscalSetupOpen ? (
        <FormModal
          open={fiscalSetupOpen}
          onOpenChange={(open) => {
            setFiscalSetupOpen(open)
            if (!open) setFiscalSetupError(null)
          }}
          config={fiscalSetupFormConfig}
          closeOnSubmit={false}
          submitError={fiscalSetupError}
          onSubmit={async (fd) => {
            setFiscalSetupError(null)
            try {
              await setupFiscalCalendar.mutateAsync({
                fiscalYearName: String(fd.fiscalYearName ?? "").trim(),
                dateFrom: dateInputToStdbTimestamp(fd.dateFrom),
                dateTo: dateInputToStdbTimestamp(fd.dateTo, new Date(`${new Date().getFullYear()}-12-31`)),
                openFirstPeriod: fd.openFirstPeriod !== false && fd.openFirstPeriod !== "false",
              })
              setFiscalSetupOpen(false)
            } catch (e) {
              setFiscalSetupError(e instanceof Error ? e.message : t("common.error.generic"))
            }
          }}
        />
      ) : null}

      {registerPaymentForId != null ? (
        <FormModal
          key={`reg-pay-${registerPaymentForId.toString()}`}
          open
          onOpenChange={(o) => {
            if (!o) {
              setRegisterPaymentForId(null)
              setRegisterPaymentError(null)
            }
          }}
          config={registerPaymentInvoicesForm(t)}
          closeOnSubmit={false}
          submitError={registerPaymentError}
          onSubmit={async (fd) => {
            setRegisterPaymentError(null)
            const ids = parseCommaSeparatedBigInts(fd.invoiceIds)
            if (ids.length === 0) {
              setRegisterPaymentError(t("common.validation.required"))
              return
            }
            try {
              await registerPaymentOnInvoice.mutateAsync({
                paymentId: registerPaymentForId,
                invoiceIds: ids,
                isBill: Boolean(fd.isBill),
              })
              setRegisterPaymentForId(null)
            } catch (e) {
              setRegisterPaymentError(e instanceof Error ? e.message : String(e))
            }
          }}
          isPending={registerPaymentOnInvoice.isPending}
        />
      ) : null}

      {reconcilePaymentOpen ? (
        <FormModal
          key="reconcile-payment-invoice"
          open
          onOpenChange={(o) => {
            if (!o) {
              setReconcilePaymentOpen(false)
              setReconcilePaymentError(null)
            }
          }}
          config={reconcilePaymentInvoiceForm(t)}
          closeOnSubmit={false}
          submitError={reconcilePaymentError}
          onSubmit={async (fd) => {
            setReconcilePaymentError(null)
            const paymentMoveId = optionalBigIntU64(fd.paymentMoveId)
            const invoiceMoveId = optionalBigIntU64(fd.invoiceMoveId)
            if (!paymentMoveId || !invoiceMoveId) {
              setReconcilePaymentError(t("common.validation.required"))
              return
            }
            try {
              await reconcilePaymentWithInvoice.mutateAsync({
                paymentMoveId,
                invoiceMoveId,
              })
              setReconcilePaymentOpen(false)
            } catch (e) {
              setReconcilePaymentError(e instanceof Error ? e.message : String(e))
            }
          }}
          isPending={reconcilePaymentWithInvoice.isPending}
        />
      ) : null}

      {csvKind && csvFormConfig ? (
        <FormModal
          key={csvKind}
          open
          onOpenChange={(o) => !o && setCsvKind(null)}
          config={csvFormConfig}
          closeOnSubmit={false}
          submitError={csvError}
          onSubmit={async (data) => {
            setCsvError(null)
            const files = data.csvFile as FileList | undefined
            const file = files?.[0]
            if (!file) {
              setCsvError(t("common.validation.required"))
              return
            }
            try {
              const text = await file.text()
              if (csvKind === "account") await csvImports.importAccount.mutateAsync(text)
              else if (csvKind === "accountMove") await csvImports.importAccountMove.mutateAsync(text)
              else if (csvKind === "accountMoveLine") await csvImports.importAccountMoveLine.mutateAsync(text)
              else if (csvKind === "tax") await csvImports.importTaxRate.mutateAsync(text)
              else if (csvKind === "budget") await csvImports.importBudget.mutateAsync(text)
              else if (csvKind === "budgetLine") await csvImports.importBudgetLine.mutateAsync(text)
              else await csvImports.importAnalyticAccount.mutateAsync(text)
              setCsvKind(null)
            } catch (e) {
              setCsvError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      ) : null}

      {/* Invoice detail */}
      <InvoiceDetailModal
        invoice={selectedInvoice}
        open={!!selectedInvoice}
        onClose={() => setSelectedInvoice(null)}
        onPostDraft={selectedInvoice ? () => postDraft(selectedInvoice) : undefined}
        onCreateCreditNote={
          selectedInvoice &&
            moveTypeTag(selectedInvoice as Record<string, unknown>) === "OutInvoice" &&
            moveStateStr(selectedInvoice as Record<string, unknown>) === "Posted"
            ? () => {
              setCreditNoteSource(selectedInvoice)
              setSelectedInvoice(null)
            }
            : undefined
        }
        onDownloadPdf={selectedInvoice ? () => void handleInvoiceDownloadPdf() : undefined}
        onSendEmail={selectedInvoice ? () => void handleInvoiceSendEmail() : undefined}
        onRecalculateTotals={
          selectedInvoice
            ? () =>
              void computeInvoiceTotals.mutateAsync(
                selectedInvoice.id as string | number | bigint,
              )
            : undefined
        }
        postDraftPending={postMove.isPending || postInvoice.isPending}
        downloadPdfPending={invoiceDocBusy === "download"}
        sendEmailPending={invoiceDocBusy === "send"}
        recalculateTotalsPending={computeInvoiceTotals.isPending}
      />

      {creditNoteSource ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) setCreditNoteSource(null)
          }}
          config={mergeFieldDefaultValues(creditNoteFormConfig, {
            invoiceId: String(creditNoteSource.id),
          })}
          isPending={createCreditNote.isPending}
          onSubmit={async (data) => {
            const reasonRaw = String(data.reason ?? "").trim()
            await createCreditNote.mutateAsync([
              organizationId,
              Number(operatingCompanyId),
              Number(creditNoteSource.id),
              accountingParamsToJson(
                {
                  lineIds: [],
                  reason: reasonRaw.length > 0 ? reasonRaw : null,
                },
                "CreateCreditNoteParams",
              ),
            ])
            toast({
              title: t("accounting.forms.createCreditNote.title"),
              description: t("accounting.forms.createCreditNote.description"),
            })
            setCreditNoteSource(null)
          }}
        />
      ) : null}

      {/* Create invoice */}
      <CreateInvoiceModal
        open={showCreateInvoice}
        onClose={() => setShowCreateInvoice(false)}
        journalOptions={journalRowsAsSelectOptions}
        onSave={(params) => {
          if (journals.length === 0) {
            toast({
              variant: "destructive",
              title: t("accounting.forms.newInvoice.createTitle"),
              description: t("accounting.forms.newInvoice.noJournalsHint"),
            })
            return
          }
          const jid = journalIdFromInvoiceModalSave(params, journals as Record<string, unknown>[])
          if (jid == null) {
            toast({
              variant: "destructive",
              title: t("accounting.forms.newInvoice.createTitle"),
              description: t("accounting.forms.newInvoice.fields.journalPlaceholder"),
            })
            return
          }
          const p = toCreateAccountMoveFromInvoiceModal(
            params as Record<string, unknown>,
            "OutInvoice",
            jid,
            "Customer Invoice",
          )
          createMove.mutate([organizationId, accountingParamsToJson(p, "CreateAccountMoveParams")])
        }}
      />

      {/* Create bill (same form, different move type) */}
      <CreateInvoiceModal
        open={showCreateBill}
        onClose={() => setShowCreateBill(false)}
        journalOptions={journalRowsAsSelectOptions}
        onSave={(params) => {
          if (journals.length === 0) {
            toast({
              variant: "destructive",
              title: t("accounting.forms.newBill.createTitle"),
              description: t("accounting.forms.newBill.noJournalsHint"),
            })
            return
          }
          const jid = journalIdFromInvoiceModalSave(params, journals as Record<string, unknown>[])
          if (jid == null) {
            toast({
              variant: "destructive",
              title: t("accounting.forms.newBill.createTitle"),
              description: t("accounting.forms.newBill.fields.journalPlaceholder"),
            })
            return
          }
          const p = toCreateAccountMoveFromInvoiceModal(
            params as Record<string, unknown>,
            "InInvoice",
            jid,
            "Vendor Bill",
          )
          createMove.mutate([organizationId, accountingParamsToJson(p, "CreateAccountMoveParams")])
        }}
      />

      {/* Dashboard quick-action form modal */}
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? journalEntryFormConfig}
        onSubmit={async (formData) => {
          if (!quickActionForm) return
          try {
            await handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          } catch (e) {
            toast({
              variant: "destructive",
              title: t("common.error"),
              description: e instanceof Error ? e.message : String(e),
            })
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
        key={journalEdit ? `journal-${String(journalEdit.id)}` : "journal-closed"}
        open={!!journalEdit}
        onOpenChange={(open) => {
          if (!open) setJournalEdit(null)
        }}
        config={journalEditFormConfig}
        onSubmit={async (formData) => {
          if (!journalEdit?.id) return
          const params: Partial<UpdateAccountJournalParams> = {}
          const name = optionalText(formData.name)
          const code = optionalText(formData.code)
          if (name) params.name = name
          if (code) params.code = code
          if (formData.active !== undefined) params.active = Boolean(formData.active)
          if (Object.keys(params).length === 0) return
          await updateAccountJournal.mutateAsync([
            organizationId,
            BigInt(String(journalEdit.id)),
            stdbParamsToJson(params as UpdateAccountJournalParams),
          ])
          setJournalEdit(null)
        }}
      />

      <FormModal
        key={paymentTermLineEdit ? `ptl-${String(paymentTermLineEdit.id)}` : "ptl-closed"}
        open={!!paymentTermLineEdit}
        onOpenChange={(open) => {
          if (!open) setPaymentTermLineEdit(null)
        }}
        config={paymentTermLineEditFormConfig}
        onSubmit={async (formData) => {
          if (!paymentTermLineEdit?.id) return
          await updatePaymentTermLine.mutateAsync({
            lineId: BigInt(String(paymentTermLineEdit.id)),
            value: paymentTermValueTag(formData.value),
            valueAmount: Number(formData.valueAmount ?? 0),
            days: Math.trunc(Number(formData.days ?? 0)),
            months: Math.trunc(Number(formData.months ?? 0)),
            daysAfterEndOfMonth:
              formData.daysAfterEndOfMonth === undefined
                ? null
                : Boolean(formData.daysAfterEndOfMonth),
            sequence: Math.trunc(Number(formData.sequence ?? 0)),
          })
          setPaymentTermLineEdit(null)
        }}
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

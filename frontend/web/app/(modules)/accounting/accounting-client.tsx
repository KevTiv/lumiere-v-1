Warning: truncated output (original token count: 66295)
Total output lines: 6152

"use client"
import { mapDashboardWidgets, withDashboardSections } from "@lumiere/ui/lib/dashboard-sections"
import { useModuleTab } from "@/hooks/use-module-tab"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { useConfirmDialog } from "@lumiere/ui/hooks/use-confirm-dialog"
import {
  ModuleView,
  FormModal,
  CsvImportModal,
  CSV_IMPORT_CONTRACTS,
  RuntimeFormModal,
  EntityView,
  ListPivotSwitch,
  useRBAC,
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
  analyticLinesTableConfig,
  editAnalyticAccountForm,
  editAnalyticLineForm,
  editAnalyticDistributionModelForm,
  MissingOrganization,
  mergeSelectOptionsByFieldName,
  mergeSelectOptionsForFields,
  mergeFieldDefaultValues,
  bankStatementsTableConfig,
  fixedAssetsTableConfig,
  depreciationLinesTableConfig,
  accountPaymentsTableConfig,
  accountPaymentDetailConfig,
  bankStatementDetailConfig,
  accountMoveDetailConfig,
  paymentStateBadges,
  bankStatementStateBadges,
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
  editAccountMoveLineForm,
  newDepreciationLineForm,
  newIntercompanyRuleForm,
  editIntercompanyRuleForm,
  newIntercompanyTransactionForm,
  markIntercompanyTransactionErrorForm,
  newCurrencyRateForm,
  registerPaymentInvoicesForm,
  reconcilePaymentInvoiceForm,
  newAnalyticAccountForm,
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
  EntityRecordSheet,
  type TimeRangeValue,
  isTimestampInRange,
  percentChange,
  previousPeriodMs,
  timeRangeToMs,
} from "@lumiere/ui"
import { Input } from "@lumiere/ui/components/input"
import { Label } from "@lumiere/ui/components/label"
import type { BadgeVariant, EntityAction, EntityRecordSheetConfig, FormField, EntityRow, EntityTableConfig, EntityViewConfig, FormConfig, ModuleConfig } from "@lumiere/ui"
import {
  accountingParamsToJson,
  analyticParamsToJson,
  toCreateAccountAccountParams,
  toCreateAccountMoveFromInvoiceModal,
  toCreateAccountMoveParams,
  toCreateAccountJournalParams,
  toCreateCrossoveredBudgetLineParams,
  toCreateCreditNoteParams,
  toCreateAccountTaxParams,
  toUpdateAccountTaxParams,
  updateAccountTaxParamsForWire,
  toCreateCrossoveredBudgetParams,
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
  toUpdateIntercompanyRuleParams,
  intercompanyRuleUpdateParamsToJson,
  toCreateIntercompanyTransactionParams,
  intercompanyTransactionParamsToJson,
  toCreateDepreciationLineParams,
  depreciationLineParamsToJson,
  toUpdateAccountMoveLineParams,
  updateAccountMoveLineParamsToJson,
  toCreatePaymentParamsFromManualForm,
  toCreatePaymentTermParamsFromForm,
  toCreatePaymentTermLineParamsFromForm,
  toCreateCurrencyRateParamsFromForm,
  toRunFxRevaluationParamsFromForm,
  toRunFxRevaluationBatchParamsFromForm,
  toPostRealizedFxParamsFromForm,
  toUpsertPartnerCreditControlParamsFromForm,
  toCreateBadDebtWriteOffParamsFromForm,
  toCreateAmortizationScheduleParamsFromForm,
} from "@/lib/accounting-create-params"
import type { ClearablePatch } from "@/lib/accounting-create-params"
import { optionalBigIntU64 } from "@lumiere/erp-shared/form-coercion"
import { toAddAccountMoveLineParamsFromForm } from "./account-move-line-forms"
import { accountMoveLineCanBeDeleted } from "./account-move-line-gates"
import { stdbParamsToJson } from "@/lib/stdb-params-json"
import {
  buildAccountLabelMap,
  buildAnalyticAccountLabelMap,
  buildCompanyLabelMap,
  buildCurrencyLabelMap,
  buildJournalLabelMap,
  buildPartnerLabelMap,
  buildSourceDocumentLabelMap,
} from "@lumiere/stdb/read-models"
import type {
  UpdateAccountJournalParams,
  UpdateCrossoveredBudgetLineParams,
  UpdateCrossoveredBudgetParams,
} from "@lumiere/stdb/types"
import { accountingModuleConfig } from "@/lib/module-dashboard-configs"
import { invoiceRecordHref } from "./invoice-record"
import { accountMovePivotSetup } from "@lumiere/ui/lib/accounting-pivot-configs"
import { PaymentOperationsPanel } from "./payment-operations-panel"
import { useAccountingModuleSubscription } from "@/lib/module-subscription-hooks"
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
  useCreateAccountAsset,
  useUpdateAccountAsset,
  useConfirmAccountAsset,
  useCloseAccountAsset,
  useCreateDepreciationLine,
  useComputeDepreciationBoard,
  useDisposeAccountAsset,
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
  useRefreshTaxDeadlineStatuses,
  useScheduleTaxDeadlineUpdates,
  useTaxDeadlines,
  useAccountTaxGroups,
  useCreateAccountTaxGroup,
  useUpdateAccountTaxGroup,
  useTaxJurisdictions,
  useCreateTaxJurisdiction,
  useUpdateTaxJurisdiction,
  useTaxSchedules,
  useCreateTaxSchedule,
  useUpdateTaxSchedule,
  useCompleteTaxDeadline,
  useWaiveTaxDeadline,
  useDeleteTaxDeadline,
  useCreateTaxDeadline,
  useUpdateTaxDeadline,
  useUpdateAccountTax,
  useDeprecateAccountAccount,
  useUpdateAccountAccount,
  useCreateAccountBankStatement,
  useUpdateAccountBankStatement,
  useAccountingCsvImportMutations,
  useAccountPayments,
  useAccountPaymentTerms,
  useAccountPaymentTermLines,
  useCreateAccountPayment,
  useCancelAccountPayment,
  useCreatePaymentTerm,
  useUpdatePaymentTerm,
  useDeletePaymentTerm,
  useCreatePaymentTermLine,
  useUpdatePaymentTermLine,
  useDeletePaymentTermLine,
  useCreateCurrencyRate,
  useSetAccountAssetActive,
  useFxRevaluationRuns,
  useRunFxRevaluation,
  useRunFxRevaluationBatch,
  usePostRealizedFxGainLoss,
  usePartnerCreditControls,
  useUpsertPartnerCreditControl,
  useCreateBadDebtWriteOff,
  useAmortizationSchedules,
  useAmortizationLines,
  useCreateAmortizationSchedule,
  useRecognizeAmortizationLine,
} from "@lumiere/query-hooks/hooks/accounting"
import { useFinancialReports } from "@lumiere/query-hooks/hooks/reports"
import {
  accountJournalRowsToSelectOptions,
  paymentJournalRowsToSelectOptions,
  accountMoveRowsToSelectOptions,
  saleOrderRowsToSelectOptions,
  contactRowsToAccountingPartnerSelectOptions,
  companyRowsToSelectOptions,
  consolidationJournalRowsToSelectOptions,
  consolidationAccountRowsToSelectOptions,
  currencyOptionsFromRows,
} from "@/lib/form-lookup"
import { useCurrencies } from "@lumiere/query-hooks/hooks/settings"
import { useToast } from "@/hooks/use-toast"
import { showWorkflowToast } from "@lumiere/ui/lib/workflow-toast"
import { useWorkflowSurface } from "@/hooks/use-workflow-surface"
import { useInvoiceToPaymentWorkflow } from "@lumiere/query-hooks/hooks/accounting/invoice-workflow"
import { isPaymentRegistrable, variantTag } from "@lumiere/erp-workflows"
import {
  canCompleteTaxDeadline,
  canDeleteTaxDeadline,
  canEditTaxDeadline,
  canWaiveTaxDeadline,
  deadlineDateInput,
  toTaxDeadlineCreateBody,
  toTaxDeadlineUpdateBody,
} from "./tax-deadline-actions"
import {
  canEditTaxGroup,
  taxGroupAccountOptions,
  taxGroupEditDefaults,
  toTaxGroupCreateParams,
  toTaxGroupUpdateParams,
} from "./tax-group-actions"
import {
  taxJurisdictionEditDefaults,
  toTaxJurisdictionCreateParams,
  toTaxJurisdictionUpdateParams,
} from "./tax-jurisdiction-actions"
import {
  canEditTaxSchedule,
  scheduleJurisdictionOptions,
  scheduleTaxOptions,
  taxScheduleEditDefaults,
  toTaxScheduleCreateParams,
  toTaxScheduleUpdateParams,
} from "./tax-schedule-actions"
import { taxPickerField } from "./tax-picker-field"
import { cellId, cellText, withNone } from "./tax-setup-wire"
import {
  ASSET_TYPES,
  DEPRECIATION_METHODS,
  assetAccountOptions,
  assetCompanyId,
  assetEditDefaults,
  assetJournalOptions,
  canEditAsset,
  toAssetCreateParams,
  toAssetUpdateParams,
  type AssetFailure,
} from "./asset-actions"
import { accountIsDeprecated, deprecateAccountParams } from "./account-deprecation"
import { ACCOUNT_INTERNAL_TYPES, accountEditDefaults, toAccountUpdateParams } from "./account-edit"
import {
  bankJournals,
  canEditBankStatement,
  statementDateInput,
  toBankStatementCreateInput,
  toBankStatementUpdateParams,
} from "./bank-statement-actions"
import { formText, useFormDialog, workflowActionsToEntityActions } from "@lumiere/ui"
import type {
  AccountAnalyticAccount,
  AccountFiscalYear,
  AccountMove,
  AccountPeriod,
  CrossoveredBudget,
} from "@lumiere/query-hooks/hooks/accounting"
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
  FxRevaluationPanel,
  PartnerCreditControlPanel,
  AmortizationPanel,
  type AccountAccount,
} from "@lumiere/ui"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import {
  BankStatementImportLinesSection,
  ConsolidationCompanyRatesSection,
  TaxDeadlineRemindersSection,
  taxDeadlinesTableConfig,
  taxGroupsTableConfig,
  taxJurisdictionsTableConfig,
  taxSchedulesTableConfig,
} from "./read-sections"
import { fetchQueryList } from "@lumiere/query-hooks/http"
import {
  customFieldEntriesFromMetadata,
  findNewestRowByField,
  persistCustomFieldsToEav,
} from "@/lib/persist-record-custom-fields"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useCompanies } from "@lumiere/query-hooks/hooks/organization-company"
import { useSaleOrders } from "@lumiere/query-hooks/hooks/sales"
import { useContacts } from "@lumiere/query-hooks/hooks/crm"
import {
  downloadDocumentPdf,
  useDispatchQueuedMail,
  useMailTemplates,
  useQueueMailFromTemplate,
} from "@lumiere/query-hooks/hooks/templates"
import { useCreateDocument } from "@lumiere/query-hooks/hooks/documents"
import { archiveRenderedPdfAsDocument } from "@/lib/archive-document-pdf"
import { stbTimestampFromDate } from "@/lib/stb-timestamp"
import {
  enumTag,
  isInvoiceLikeMoveType,
  resolveDefaultCogsInventoryAccountIds,
} from "@/lib/accounting-post-draft"
import { Button } from "@lumiere/ui/components/button"
import { cn } from "@lumiere/ui/lib/utils"
import { TablePager, usePagedRows } from "@lumiere/ui/components/table-pager"

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

/**
 * Move/payment timestamp → milliseconds since epoch.
 * Handles raw microsecond numbers (> 1e15), millisecond numbers, and
 * `{ microsSinceUnixEpoch }` objects.
 */
function flexibleTimestampMs(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === "object" && "microsSinceUnixEpoch" in (value as Record<string, unknown>)) {
    const micros = Number((value as { microsSinceUnixEpoch: unknown }).microsSinceUnixEpoch)
    return Number.isFinite(micros) && micros !== 0 ? micros / 1000 : null
  }
  const n = typeof value === "bigint" ? Number(value) : Number(value)
  if (!Number.isFinite(n) || n === 0) return null
  return n > 1e15 ? n / 1000 : n
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

function toUpdateBudgetParams(
  formData: Record<string, unknown>,
): ClearablePatch<UpdateCrossoveredBudgetParams> {
  return {
    companyId: undefined,
    name: optionalText(formData.name),
    description: formData.description == null ? undefined : optionalText(formData.description) ?? null,
    dateFrom: formData.dateFrom ? dateInputToStdbTimestamp(formData.dateFrom) : undefined,
    dateTo: formData.dateTo ? dateInputToStdbTimestamp(formData.dateTo) : undefined,
  }
}

function toUpdateBudgetLineParams(
  formData: Record<string, unknown>,
): ClearablePatch<UpdateCrossoveredBudgetLineParams> {
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
  journals: readonly { id?: unknown }[],
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
  initialBudgets?: CrossoveredBudget[]
  initialAnalytic?: AccountAnalyticAccount[]
  initialFiscalYears?: AccountFiscalYear[]
  initialAccountPeriods?: AccountPeriod[]
  organizationId?: number
}

type AccountingClientLoadedProps = Omit<AccountingClientProps, "organizationId"> & {
  organizationId: number
}

type AccountingClientReadyProps = AccountingClientLoadedProps & {
  operatingCompanyId: bigint
}

export function AccountingClient(props: AccountingClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <AccountingClientLoaded {...props} organizationId={props.organizationId} />
}

function AccountingClientLoaded(props: AccountingClientLoadedProps) {
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(props.organizationId)
  if (operatingCompanyId == null) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground" role="status">
        Select an active company to open the accounting workspace.
      </div>
    )
  }
  return <AccountingClientReady {...props} operatingCompanyId={operatingCompanyId} />
}

function AccountingClientReady({
  initialBudgets,
  initialAnalytic,
  initialFiscalYears,
  initialAccountPeriods,
  organizationId,
  operatingCompanyId,
}: AccountingClientReadyProps) {
  useAccountingModuleSubscription()
  const { t } = useTranslation()
  const { confirm: confirmDialog, dialog: confirmDialogNode } = useConfirmDialog()
  const { toast } = useToast()
  const { askForm, formDialog } = useFormDialog()
  const { currentUser, checkPermission } = useRBAC()
  const runtimeRoleId = currentUser?.roles[0]
  const moduleConfigBase = useMemo(() => accountingModuleConfig(t), [t])
  const accountingTabIds = useMemo(
    () => moduleConfigBase.tabs.map((tab) => tab.id),
    [moduleConfigBase],
  )
  const { activeTab: accountingActiveTab, setActiveTab: setAccountingActiveTab } = useModuleTab(
    moduleConfigBase.defaultTab ?? "dashboard",
    accountingTabIds,
  )
  /** BigInt organization id for `useStdbQuery` cache keys (not SpacetimeDB `company_id` reducers). */
  const { orgId } = orgBigInts(organizationId)
  async function persistAccountMoveCustomFieldsAfterCreate(metadata: unknown, displayName: string) {
    if (customFieldEntriesFromMetadata(metadata).length === 0) return
    let row: Record<string, unknown> | undefined
    for (let attempt = 0; attempt < 5; attempt++) {
      const rows = await fetchQueryList(
        "/api/query/account-moves",
        "Failed to fetch account moves",
      )
      row = findNewestRowByField(rows, "invoicePartnerDisplayName", displayName)
      if (row?.id) break
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)))
    }
    if (!row?.id) {
      toast({
        variant: "destructive",
        title: t("common.error.title"),
        description: "Invoice saved, but custom fields could not be linked yet. Retry from the record.",
      })
      return
    }
    await persistCustomFieldsToEav({
      organizationId,
      companyId: operatingCompanyId,
      model: "account_move",
      recordId: BigInt(String(row.id)),
      metadata,
    })
  }

  // Quick-action form modal (dashboard tab)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  // Invoice detail modal
  const [selectedInvoice, setSelectedInvoice] = useState<AccountMove | null>(null)
  // Invoice/bill record sheet (row click on invoices/bills tabs)
  const [invoiceSheetRecord, setInvoiceSheetRecord] = useState<Record<string, unknown> | null>(null)
  // Dashboard time range (trend deltas compare against the previous period)
  const [dashboardTimeRange, setDashboardTimeRange] = useState<TimeRangeValue>("30d")
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
  const [registerPaymentForId, setRegisterPaymentForId] = useState<bigint | null>(null)
  const [registerPaymentError, setRegisterPaymentError] = useState<string | null>(null)
  const [reconcilePaymentOpen, setReconcilePaymentOpen] = useState(false)
  const [reconcilePaymentError, setReconcilePaymentError] = useState<string | null>(null)
  const [journalEdit, setJournalEdit] = useState<Record<string, unknown> | null>(null)
  const [paymentTermLineEdit, setPaymentTermLineEdit] = useState<Record<string, unknown> | null>(null)
  const [selectedFixedAsset, setSelectedFixedAsset] = useState<Record<string, unknown> | null>(null)
  const [depreciationLineCreateOpen, setDepreciationLineCreateOpen] = useState(false)
  const [intercompanyRuleEdit, setIntercompanyRuleEdit] = useState<Record<string, unknown> | null>(null)
  const [intercompanyTxCreateOpen, setIntercompanyTxCreateOpen] = useState(false)
  const [intercompanyTxCreateModel, setIntercompanyTxCreateModel] = useState("account.move")
  const [intercompanyTxError, setIntercompanyTxError] = useState<Record<string, unknown> | null>(null)
  const [moveLineEdit, setMoveLineEdit] = useState<Record<string, unknown> | null>(null)
  const [chatterTarget, setChatterTarget] = useState<ChatterTarget | null>(null)
  const [glDrilldownAccount, setGlDrilldownAccount] = useState<AccountAccount | null>(null)
  // ── Data hooks ──────────────────────────────────────────────────────────────
  const { data: accounts = [] } = useAccountAccounts(orgId, {
    enabled: organizationId > 0,
  })
  const { data: allMoves = [], isLoading: movesLoading } = useAccountMoves(orgId, {
    enabled: organizationId > 0,
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
  const { data: taxGroups = [] } = useAccountTaxGroups(orgId, { enabled: organizationId > 0 })
  const { data: taxJurisdictions = [] } = useTaxJurisdictions(orgId, { enabled: organizationId > 0 })
  const { data: taxSchedules = [] } = useTaxSchedules(orgId, { enabled: organizationId > 0 })
  const { data: analytic = [] } = useAccountAnalyticAccounts(orgId, { enabled: organizationId > 0 })
  const { data: analyticLines = [] } = useAccountAnalyticLines(orgId, { enabled: organizationId > 0 })
  const { data: analyticDistribution = [] } = useAccountAnalyticDistributionModels(orgId, {
    enabled: organizationId > 0,
  })
  const { data: bankStatements = [], isLoading: bankStatementsLoading } = useAccountBankStatements(orgId, { enabled: organizationId > 0 })
  const { data: bankStatementLines = [] } = useAccountBankStatementLines(orgId, { enabled: organizationId > 0 })
  const { data: bankMatchCandidates = [] } = useBankMatchCandidates(orgId, { enabled: organizationId > 0 })
  const { data: reconciliationWidgets = [] } = useAccountReconciliationWidgets(orgId, {
    enabled: organizationId > 0,
  })
  const { data: fixedAssets = [] } = useAccountFixedAssets(orgId, { enabled: organizationId > 0 })
  const { data: accountPayments = [], isLoading: paymentsLoading } = useAccountPayments(orgId, { enabled: organizationId > 0 })
  const { data: paymentTerms = [] } = useAccountPaymentTerms(orgId, { enabled: organizationId > 0 })
  const { data: paymentTermLines = [] } = useAccountPaymentTermLines(orgId, { enabled: organizationId > 0 })
  const { data: depreciationLines = [] } = useDepreciationLines(orgId, { enabled: organizationId > 0 })
  const { data: companies = [] } = useCompanies(organizationId, organizationId > 0)
  const { data: currencies = [] } = useCurrencies()
  const { data: intercompanyRules = [] } = useIntercompanyRules(orgId, { enabled: organizationId > 0 })
  const { data: intercompanyTransactions = [] } = useIntercompanyTransactions(orgId, {
    enabled: organizationId > 0,
  })
  const { data: saleOrders = [] } = useSaleOrders(orgId)
  const { data: contacts = [] } = useContacts(orgId)
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
  const { data: fxRevaluationRuns = [] } = useFxRevaluationRuns(orgId, {
    enabled: organizationId > 0,
  })
  const { data: partnerCreditControls = [] } = usePartnerCreditControls(orgId, {
    enabled: organizationId > 0,
  })
  const { data: amortizationSchedules = [] } = useAmortizationSchedules(orgId, {
    enabled: organizationId > 0,
  })
  const { data: amortizationLines = [] } = useAmortizationLines(orgId, {
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
          fiscalYearNameById.get(String(row.fiscalYearId ?? "")) ??
          `Missing fiscal year #${String(row.fiscalYearId ?? "")}`,
      })),
    [accountPeriodsRaw, fiscalYearNameById],
  )

  const paymentTermLinesDisplay = useMemo(() => {
    const terms = new Map<string, { name: string; isActive: boolean }>()
    for (const term of paymentTerms as Record<string, unknown>[]) {
      terms.set(String(term.id ?? ""), {
        name: String(term.name ?? `Payment term #${String(term.id ?? "")}`),
        isActive: paymentTermIsActive(term),
      })
    }
    return (paymentTermLines as Record<string, unknown>[]).map((line) => {
      const paymentTermId = String(line.paymentTermId ?? line.payment_term_id ?? "")
      const term = terms.get(paymentTermId)
      return {
        ...line,
        paymentTermLabel: term
          ? `${term.name}${term.isActive ? "" : " (inactive)"}`
          : `Missing payment term #${paymentTermId}`,
      }
    })
  }, [paymentTermLines, paymentTerms])

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

  const resolveConsolidationPeriodId = useCallback(
    (periodName: string): bigint | undefined => {
      const name = periodName.trim()
      if (!name) return undefined
      for (const row of accountPeriodsRaw as Record<string, unknown>[]) {
        if (String(row.name ?? "").trim() === name && row.id != null) {
          return BigInt(String(row.id))
        }
      }
      return undefined
    },
    [accountPeriodsRaw],
  )

  const journalRowsAsSelectOptions = useMemo(
    () => accountJournalRowsToSelectOptions(journals),
    [journals],
  )

  const journalFieldOptionsForModularForm = useMemo(() => {
    if (journalRowsAsSelectOptions.length > 0) return journalRowsAsSelectOptions
    return [{ value: "", label: t("common.lookup.noJournals"), disabled: true }]
  }, [journalRowsAsSelectOptions, t])

  const paymentJournalFieldOptions = useMemo(() => {
    const options = paymentJournalRowsToSelectOptions(journals)
    if (options.length > 0) return options
    return [{ value: "", label: t("common.lookup.noJournals"), disabled: true }]
  }, [journals, t])

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

  const currencySelectOptions = useMemo(() => currencyOptionsFromRows(currencies), [currencies])

  const defaultCurrencyId = useMemo(() => {
    const company = (companies as Record<string, unknown>[]).find(
      (row) => String(row.id ?? "") === String(operatingCompanyId),
    )
    return (
      optionalBigIntU64(company?.currencyId ?? company?.currency_id) ??
      optionalBigIntU64(currencySelectOptions[0]?.value) ??
      0n
    )
  }, [companies, currencySelectOptions, operatingCompanyId])

  const companySelectOptions = useMemo(
    () => companyRowsToSelectOptions(companies as Record<string, unknown>[]),
    [companies],
  )

  const partnerSelectOptions = useMemo(() => {
    const fromApi = contactRowsToAccountingPartnerSelectOptions(contacts)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noPartners"), disabled: true }]
  }, [contacts, t])

  const invoiceMoveSelectOptions = useMemo(() => {
    const invoiceMoves = (allMoves as Record<string, unknown>[]).filter((row) =>
      isInvoiceLikeMoveType(enumTag(row.moveType ?? row.move_type)),
    )
    const opts = accountMoveRowsToSelectOptions(invoiceMoves)
    return opts.length > 0 ? opts : [{ value: "", label: "—", disabled: true }]
  }, [allMoves])

  const paymentSelectOptions = useMemo(() => {
    const rows = accountPayments as Record<string, unknown>[]
    if (rows.length === 0) return [{ value: "", label: "—", disabled: true }]
    return rows.map((row) => {
      const id = String(row.id ?? "")
      const ref = String(row.ref ?? row.name ?? "").trim()
      const amount = row.amount != null ? String(row.amount) : ""
      const label = ref
        ? `${ref}${amount ? ` (${amount})` : ""}`
        : `Payment #${id}${amount ? ` (${amount})` : ""}`
      return { value: id, label }
    })
  }, [accountPayments])

  const accountPaymentFormConfig = useMemo(() => {
    const merged = mergeSelectOptionsForFields(newAccountPaymentForm(t), {
      partnerId: partnerSelectOptions,
      currencyId: currencySelectOptions,
      journalId: paymentJournalFieldOptions,
    })
    return mergeFieldDefaultValues(merged, { currencyId: String(defaultCurrencyId) })
  }, [t, partnerSelectOptions, currencySelectOptions, paymentJournalFieldOptions, defaultCurrencyId])

  // Relation-aware labels: build Maps once from subscribed rows (ACC-RI-016).
  // Invoice partner display keeps `invoicePartnerDisplayName` snapshots on moves;
  // picker FKs (partner/journal/account/currency/company/origin) use these live maps.
  const partnerLabelMap = useMemo(
    () => buildPartnerLabelMap(contacts as Record<string, unknown>[]),
    [contacts],
  )
  const journalLabelMap = useMemo(
    () => buildJournalLabelMap(journals),
    [journals],
  )
  const accountLabelMap = useMemo(
    () => buildAccountLabelMap(accounts as Record<string, unknown>[]),
    [accounts],
  )
  const analyticAccountLabelMap = useMemo(
    () => buildAnalyticAccountLabelMap(analytic as Record<string, unknown>[]),
    [analytic],
  )
  const companyLabelMap = useMemo(
    () => buildCompanyLabelMap(companies as Record<string, unknown>[]),
    [companies],
  )
  const currencyLabelMap = useMemo(() => {
    const rows = currencySelectOptions
      .filter((o) => o.value)
      .map((o) => ({ id: o.value, name: o.label }))
    return buildCurrencyLabelMap(rows)
  }, [currencySelectOptions])
  const sourceDocumentLabelMap = useMemo(
    () =>
      buildSourceDocumentLabelMap([
        ...(allMoves as Record<string, unknown>[]),
        ...(saleOrders as Record<string, unknown>[]),
      ]),
    [allMoves, saleOrders],
  )

  const openCreateAccountPayment = useCallback(
    () =>
      setQuickActionForm({
        form: accountPaymentFormConfig,
        action: "createAccountPayment",
      }),
    [accountPaymentFormConfig],
  )

  const paymentRecordSheet = useMemo((): EntityRecordSheetConfig => {
    const status = paymentStateBadges(t)
    return {
      titleKey: "name",
      statusKey: "state",
      statusBadgeVariants: status.badgeVariants,
      statusBadgeLabels: status.badgeLabels,
      detailConfig: accountPaymentDetailConfig(t, {
        partnerLabelMap,
        journalLabelMap,
        currencyLabelMap,
      }),
      auditTableName: "account_payment",
      discussion: {},
    }
  }, [t, partnerLabelMap, journalLabelMap, currencyLabelMap])

  const bankStatementRecordSheet = useMemo((): EntityRecordSheetConfig => {
    const status = bankStatementStateBadges(t)
    return {
      titleKey: "name",
      statusKey: "state",
      statusBadgeVariants: status.badgeVariants,
      statusBadgeLabels: status.badgeLabels,
      detailConfig: bankStatementDetailConfig(t),
      auditTableName: "account_bank_statement",
      discussion: {},
      customTabs: [
        {
          id: "lines",
          label: t("accounting.bankStatementDetail.linesHeading"),
          content: (record) => {
            const statementId = String(record.id ?? "")
            const lines = (bankStatementLines as Record<string, unknown>[]).filter(
              (line) => String(line.statementId ?? line.statement_id) === statementId,
            )
            return (
              <EntityView
                config={{
                  id: "bank-statement-lines-inline",
                  title: "",
                  view: {
                    mode: "table",
                    rowKey: "id",
                    columns: [
                      {
                        key: "date",
                        label: t("accounting.journalEntries.date"),
                        type: "relative-date",
                      },
                      {
                        key: "amount",
                        label: t("accounting.bankStatementDetail.candidateAmount"),
                        type: "currency",
                        align: "right",
                      },
                      {
                        key: "partnerId",
                        label: t("accounting.journalEntries.partner"),
                      },
                      {
                        key: "isReconciled",
                        label: t("accounting.bankStatementDetail.columnReconciled"),
                        type: "boolean",
                        align: "center",
                      },
                    ],
                    emptyMessage: t("accounting.bankStatementDetail.emptyLines"),
                  },
                }}
                data={lines}
                useCard={false}
              />
            )
          },
        },
        {
          id: "import-lines",
          label: t("accounting.bankStatementImportLines.tab", { defaultValue: "Imported lines" }),
          content: (record) => (
            <BankStatementImportLinesSection
              organizationId={orgId}
              companyId={operatingCompanyId}
              statementId={String(record.id ?? "")}
            />
          ),
        },
        {
          id: "reconcile",
          label: t("accounting.actions.reconcile"),
          content: (record) => (
            <Button type="button" variant="outline" onClick={() => setBankStatementDetail(record)}>
              {t("accounting.bankStatementDetail.manualReconcileHeading")}
            </Button>
          ),
        },
      ],
    }
  }, [t, bankStatementLines, orgId, operatingCompanyId])

  const consolidationRateLabels = useMemo(() => {
    const toMap = (opts: Array<{ value: string; label: string }>) =>
      new Map(opts.filter((o) => o.value !== "").map((o) => [o.value, o.label] as const))
    return {
      company: toMap(companySelectOptions),
      currency: toMap(currencySelectOptions),
      period: new Map(
        (accountPeriodsRaw as Record<string, unknown>[]).map(
          (p) => [String(p.id ?? ""), String(p.name ?? "")] as const,
        ),
      ),
    }
  }, [companySelectOptions, currencySelectOptions, accountPeriodsRaw])

  const taxDeadlineRows = useMemo(
    () =>
      (taxDeadlines as Record<string, unknown>[])
        .filter((d) => d.deletedAt == null && d.deleted_at == null)
        .map((d) => ({
          ...d,
          dueDate: d.dueDate ?? d.due_date,
          statusLabel: taxDeadlineStatusStr(d),
        })),
    [taxDeadlines],
  )

  const taxDeadlineRecordSheet = useMemo(
    (): EntityRecordSheetConfig => ({
      titleKey: "title",
      statusKey: "statusLabel",
      detailConfig: {
        mode: "detail",
        sections: [
          {
            id: "header",
            fields: [
              { key: "title", label: t("accounting.taxDeadlines.columns.title", { defaultValue: "Deadline" }) },
              { key: "dueDate", label: t("accounting.taxDeadlines.columns.dueDate", { defaultValue: "Due date" }), type: "date" },
              { key: "statusLabel", label: t("accounting.taxDeadlines.columns.status", { defaultValue: "Status" }) },
              { key: "description", label: t("accounting.taxDeadlines.columns.description", { defaultValue: "Description" }) },
            ],
          },
        ],
      },
      customTabs: [
        {
          id: "reminders",
          label: t("accounting.taxDeadlines.reminders.tab", { defaultValue: "Reminders" }),
          content: (record) => (
            <TaxDeadlineRemindersSection organizationId={orgId} deadlineId={String(record.id ?? "")} />
          ),
        },
      ],
    }),
    [t, orgId],
  )

  const accountMoveRecordSheet = useMemo((): EntityRecordSheetConfig => {
    const moveStatus = {
      badgeVariants: {
        Draft: "secondary",
        Posted: "default",
        Cancelled: "destructive",
      } as Record<string, BadgeVariant>,
      badgeLabels: {
        Draft: "Draft",
        Posted: "Posted",
        Cancelled: "Cancelled",
      },
    }
    const linesConfig = accountMoveLinesTableConfig(t, {
      accountLabelMap,
      sourceDocumentLabelMap,
    })
    return {
      titleKey: "name",
      statusKey: "state",
      statusBadgeVariants: moveStatus.badgeVariants,
      statusBadgeLabels: moveStatus.badgeLabels,
      detailConfig: accountMoveDetailConfig(t),
      auditTableName: "account_move",
      discussion: {},
      openHref: invoiceRecordHref,
      customTabs: [
        {
          id: "lines",
          label: t("accounting.tabs.moveLines"),
          content: (record) => {
            const moveId = String(record.id ?? "")
            const lines = accountMoveLines.filter(
              (line) => String(line.moveId ?? "") === moveId,
            )
            return (
              <EntityView
                config={{
                  ...linesConfig,
                  title: "",
                  description: undefined,
                }}
                data={lines}
                useCard={false}
              />
            )
          },
        },
      ],
    }
  }, [t, accountMoveLines, accountLabelMap, sourceDocumentLabelMap])

  /**
   * Record sheet for invoices and bills: move overview + lines + audit trail,
   * plus an Actions tab that opens the legacy InvoiceDetailModal for
   * workflow actions (post draft, register payment, credit note, PDF, email).
   */
  const invoiceBillRecordSheet = useMemo(
    (): EntityRecordSheetConfig => ({
      ...accountMoveRecordSheet,
      customTabs: [
        ...(accountMoveRecordSheet.customTabs ?? []),
        {
          id: "actions",
          label: t("accounting.invoices.recordSheet.actionsTab"),
          content: (record) => (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setInvoiceSheetRecord(null)
                // ACC-RI-018 rationale: safe because this generic sheet is installed only on AccountMove tabs.
                setSelectedInvoice(record as unknown as AccountMove)
              }}
            >
              {t("accounting.invoices.recordSheet.openActions")}
            </Button>
          ),
        },
      ],
    }),
    [accountMoveRecordSheet, t],
  )

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

  const accountMoveSelectOptions = useMemo(() => {
    const fromApi = accountMoveRowsToSelectOptions(allMoves as Record<string, unknown>[])
    if (fromApi.length > 0) return fromApi
    return [
      {
        value: "",
        label: t("accounting.forms.newIntercompanyTransaction.fields.noOriginDocuments"),
        disabled: true,
      },
    ]
  }, [allMoves, t])

  const optionalMoveSelectOptions = useMemo(
    () => [{ value: "", label: "—" }, ...draftMoveSelectOptions.filter((o) => o.value !== "")],
    [draftMoveSelectOptions],
  )

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

  const optionalPartnerSelectOptions = useMemo(
    () => [{ value: "", label: "—" }, ...partnerSelectOptions.filter((o) => o.value !== "")],
    [partnerSelectOptions],
  )

  const consolidationJournalSelectOptions = useMemo(() => {
    const fromApi = consolidationJournalRowsToSelectOptions(
      consolidationJournals as Record<string, unknown>[],
    )
    if (fromApi.length > 0) return fromApi
    return [
      {
        value: "",
        label: t("accounting.consolidation.journals.empty"),
        disabled: true,
      },
    ]
  }, [consolidationJournals, t])

  const consolidationAccountSelectOptions = useMemo(() => {
    const fromApi = consolidationAccountRowsToSelectOptions(
      consolidationAccounts as Record<string, unknown>[],
    )
    if (fromApi.length > 0) return fromApi
    return [
      {
        value: "",
        label: t("accounting.consolidation.accounts.empty"),
        disabled: true,
      },
    ]
  }, [consolidationAccounts, t])

  const postedPaymentMoveSelectOptions = useMemo(() => {
    const posted = (allMoves as Record<string, unknown>[]).filter(
      (m) => moveStateStr(m) === "Posted" && moveTypeTag(m) === "Entry",
    )
    const fromApi = accountMoveRowsToSelectOptions(posted)
    if (fromApi.length > 0) return fromApi
    return [
      {
        value: "",
        label: t("accounting.forms.reconcilePaymentInvoice.fields.noPaymentMoves"),
        disabled: true,
      },
    ]
  }, [allMoves, t])

  const openInvoiceMoveSelectOptions = useMemo(() => {
    const open = (allMoves as Record<string, unknown>[]).filter((m) => {
      const mt = moveTypeTag(m)
      if (mt !== "OutInvoice" && mt !== "InInvoice") return false
      if (moveStateStr(m) !== "Posted") return false
      return Number(m.amountResidual ?? 0) > 0.001
    })
    const fromApi = accountMoveRowsToSelectOptions(open)
    if (fromApi.length > 0) return fromApi
    return [
      {
        value: "",
        label: t("accounting.forms.reconcilePaymentInvoice.fields.noInvoiceMoves"),
        disabled: true,
      },
    ]
  }, [allMoves, t])

  const reconcilePaymentInvoiceFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(reconcilePaymentInvoiceForm(t), {
        paymentMoveId: postedPaymentMoveSelectOptions,
        invoiceMoveId: openInvoiceMoveSelectOptions,
      }),
    [t, postedPaymentMoveSelectOptions, openInvoiceMoveSelectOptions],
  )

  const registerPaymentInvoicesFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(registerPaymentInvoicesForm(t), {
        invoiceIds: openInvoiceMoveSelectOptions,
      }),
    [t, openInvoiceMoveSelectOptions],
  )

  const newAnalyticAccountFormConfig = useMemo(
    () =>
      mergeFieldDefaultValues(
        mergeSelectOptionsForFields(newAnalyticAccountForm(t), {
          currencyId: currencySelectOptions,
        }),
        { currencyId: String(defaultCurrencyId) },
      ),
    [t, currencySelectOptions, defaultCurrencyId],
  )

  const fixedAssetSelectOptions = useMemo(
    () =>
      (fixedAssets as Record<string, unknown>[]).map((a) => ({
        value: String(a.id ?? ""),
        label: `${String(a.name ?? a.id ?? "")}${a.originalValue != null ? ` (${Number(a.originalValue).toLocaleString()})` : ""}`,
      })),
    [fixedAssets],
  )

  const depreciationLineCreateFormConfig = useMemo(() => {
    const base = mergeSelectOptionsForFields(newDepreciationLineForm(t), {
      assetId:
        fixedAssetSelectOptions.length > 0
          ? fixedAssetSelectOptions
          : [{ value: "", label: t("accounting.entities.fixedAssets.emptyMessage"), disabled: true }],
      moveId: optionalMoveSelectOptions,
    })
    if (!selectedFixedAsset?.id) return base
    return mergeFieldDefaultValues(base, { assetId: String(selectedFixedAsset.id) })
  }, [t, fixedAssetSelectOptions, optionalMoveSelectOptions, selectedFixedAsset])

  const intercompanyRuleCreateFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newIntercompanyRuleForm(t), {
        sourceCompanyId: companySelectOptions,
        destinationCompanyId: companySelectOptions,
        journalId: [{ value: "", label: "—" }, ...journalRowsAsSelectOptions],
        accountId: [{ value: "", label: "—" }, ...accountSelectOptionsForMoveLine],
      }),
    [t, companySelectOptions, journalRowsAsSelectOptions, accountSelectOptionsForMoveLine],
  )

  const intercompanyOriginDocumentOptions = useMemo(() => {
    if (intercompanyTxCreateModel === "sale.order") {
      const fromApi = saleOrderRowsToSelectOptions(saleOrders as Record<string, unknown>[])
      if (fromApi.length > 0) return fromApi
      return [{ value: "", label: t("common.lookup.noSaleOrders"), disabled: true }]
    }
    return accountMoveSelectOptions
  }, [intercompanyTxCreateModel, saleOrders, accountMoveSelectOptions, t])

  const intercompanyTransactionCreateFormConfig = useMemo(() => {
    const base = mergeSelectOptionsForFields(newIntercompanyTransactionForm(t), {
      originDocumentId: intercompanyOriginDocumentOptions,
      destinationCompanyId: companySelectOptions,
      currencyId: currencySelectOptions,
    })
    return mergeFieldDefaultValues(base, {
      currencyId: defaultCurrencyId.toString(),
      originDocumentModel: intercompanyTxCreateModel,
    })
  }, [
    t,
    intercompanyOriginDocumentOptions,
    companySelectOptions,
    currencySelectOptions,
    defaultCurrencyId,
    intercompanyTxCreateModel,
  ])

  const intercompanyRuleEditFormConfig = useMemo(() => {
    const base = mergeSelectOptionsForFields(editIntercompanyRuleForm(t), {
      journalId: [{ value: "", label: "—" }, ...journalRowsAsSelectOptions],
      accountId: [{ value: "", label: "—" }, ...accountSelectOptionsForMoveLine],
    })
    if (!intercompanyRuleEdit) return base
    return mergeFieldDefaultValues(base, {
      name: String(intercompanyRuleEdit.name ?? ""),
      sequence: Number(intercompanyRuleEdit.sequence ?? 0),
      journalId:
        intercompanyRuleEdit.journalId != null ? String(intercompanyRuleEdit.journalId) : "",
      accountId:
        intercompanyRuleEdit.accountId != null ? String(intercompanyRuleEdit.accountId) : "",
      autoValidation: Boolean(intercompanyRuleEdit.autoValidation),
      autoGenerateInvoice: Boolean(intercompanyRuleEdit.autoGenerateInvoice),
      autoGenerateBill: Boolean(intercompanyRuleEdit.autoGenerateBill),
      isActive: Boolean(intercompanyRuleEdit.isActive),
      notes: intercompanyRuleEdit.notes != null ? String(intercompanyRuleEdit.notes) : "",
    })
  }, [intercompanyRuleEdit, t, journalRowsAsSelectOptions, accountSelectOptionsForMoveLine])

  const depreciationLinesEntityConfig = useMemo(() => depreciationLinesTableConfig(t), [t])

  const intercompanyTxErrorFormConfig = useMemo(() => markIntercompanyTransactionErrorForm(t), [t])

  const moveLineEditFormConfig = useMemo(() => {
    const base = editAccountMoveLineForm(t)
    if (!moveLineEdit) return base
    return mergeFieldDefaultValues(base, {
      name: String(moveLineEdit.name ?? ""),
      debit: Number(moveLineEdit.debit ?? 0),
      credit: Number(moveLineEdit.credit ?? 0),
    })
  }, [moveLineEdit, t])

  const depreciationLinesForSelectedAsset = useMemo(() => {
    if (!selectedFixedAsset?.id) return []
    const aid = String(selectedFixedAsset.id)
    return (depreciationLines as Record<string, unknown>[]).filter(
      (line) => String(line.assetId) === aid,
    )
  }, [selectedFixedAsset, depreciationLines])

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

  const currencyRateFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newCurrencyRateForm(t), {
        fromCurrencyId: currencySelectOptions,
        toCurrencyId: currencySelectOptions,
      }),
    [t, currencySelectOptions],
  )

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
  const updateTax = useUpdateAccountTax(organizationId)
  const deprecateAccount = useDeprecateAccountAccount(organizationId)
  const updateAccount = useUpdateAccountAccount(organizationId)
  const createBankStatement = useCreateAccountBankStatement(organizationId)
  const updateBankStatement = useUpdateAccountBankStatement(organizationId)
  const completeTaxDeadline = useCompleteTaxDeadline(organizationId)
  const waiveTaxDeadline = useWaiveTaxDeadline(organizationId)
  const deleteTaxDeadline = useDeleteTaxDeadline(organizationId)
  const createTaxDeadline = useCreateTaxDeadline(organizationId)
  const updateTaxDeadline = useUpdateTaxDeadline(organizationId)
  const createTaxGroup = useCreateAccountTaxGroup(organizationId, operatingCompanyId)
  const updateTaxGroup = useUpdateAccountTaxGroup(organizationId, operatingCompanyId)
  const createTaxJurisdiction = useCreateTaxJurisdiction(organizationId)
  const updateTaxJurisdiction = useUpdateTaxJurisdiction(organizationId)
  const createTaxSchedule = useCreateTaxSchedule(organizationId, operatingCompanyId)
  const updateTaxSchedule = useUpdateTaxSchedule(organizationId, operatingCompanyId)
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
  const createCreditNote = useCreateCreditNoteFromInvoice(organizationId)
  const mailTemplatesQuery = useMailTemplates(organizationId, organizationId > 0)
  const queueMailFromTemplate = useQueueMailFromTemplate(
    organizationId,
    Number(operatingCompanyId),
  )
  const dispatchQueuedMail = useDispatchQueuedMail()
  const createDocument = useCreateDocument(orgId, operatingCompanyId)
  const [invoiceDocBusy, setInvoiceDocBusy] = useState<"download" | "send" | "archive" | null>(null)
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
  const postBankStatement = usePostAccountBankStatement(organizationId, operatingCompanyId)
  const deleteBankStatement = useDeleteAccountBankStatement(organizationId, operatingCompanyId)
  const createBankStatementLine = useCreateAccountBankStatementLine(organizationId, operatingCompanyId)
  const updateBankStatementLine = useUpdateAccountBankStatementLine(organizationId, operatingCompanyId)
  const deleteBankStatementLine = useDeleteAccountBankStatementLine(organizationId, operatingCompanyId)
  const matchBankLine = useMatchBankLine(organizationId)
  const applyReconciliationRules = useApplyReconciliationRules(organizationId)
  const reconcileBankLine = useReconcileAccountBankStatementLine(organizationId, operatingCompanyId)
  const unreconcileBankLine = useUnreconciledAccountBankStatementLine(organizationId, operatingCompanyId)
  const createReconciliationWidget = useCreateAccountReconciliationWidget(organizationId, operatingCompanyId)
  const updateReconciliationWidget = useUpdateAccountReconciliationWidget(organizationId, operatingCompanyId)
  const deleteReconciliationWidget = useDeleteAccountReconciliationWidget(organizationId, operatingCompanyId)
  const createConsolidationAccount = useCreateConsolidationAccount(organizationId)
  const updateConsolidationAccount = useUpdateConsolidationAccount(organizationId)
  const createConsolidationJournal = useCreateConsolidationJournal(organizationId)
  const createEliminationEntry = useCreateEliminationEntry(organizationId)
  const processConsolidation = useProcessConsolidation(organizationId)
  const validateConsolidation = useValidateConsolidation(organizationId)
  const cancelConsolidation = useCancelConsolidation(organizationId)
  const matchEliminationEntries = useMatchEliminationEntries(organizationId)
  const unmatchEliminationEntry = useUnmatchEliminationEntry(organizationId)

  const createAccountAsset = useCreateAccountAsset(organizationId)
  const updateAccountAsset = useUpdateAccountAsset(organizationId)
  const deleteAccountAsset = useDeleteAccountAsset(organizationId, operatingCompanyId)
  const confirmAccountAsset = useConfirmAccountAsset(organizationId, operatingCompanyId)
  const closeAccountAsset = useCloseAccountAsset(organizationId, operatingCompanyId)
  const createDepreciationLine = useCreateDepreciationLine(organizationId, operatingCompanyId)
  const computeDepreciationBoard = useComputeDepreciationBoard(organizationId, operatingCompanyId)
  const disposeAccountAsset = useDisposeAccountAsset(organizationId, operatingCompanyId)

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
  const csvImports = useAccountingCs…31295 tokens truncated…ValidateBudget={(budgetId) => validateBudget.mutateAsync(budgetId)}
                      onDoneBudget={(budgetId) => doneBudget.mutateAsync(budgetId)}
                      onCancelBudget={(budgetId) => cancelBudget.mutateAsync(budgetId)}
                      onDeleteBudgetLine={(lineId) => deleteBudgetLine.mutateAsync(lineId)}
                      onUpdateLineActuals={(lineId, params) =>
                        updateBudgetLineActuals.mutateAsync({ lineId, params })
                      }
                      onCreateBudgetPost={(params) =>
                        createBudgetPost.mutateAsync(
                          stdbParamsToJson(
                            toCreateBudgetPostParams(params, operatingCompanyId),
                          ),
                        )
                      }
                      onUpdateBudgetPost={(postId, params) =>
                        updateBudgetPost.mutateAsync({
                          postId,
                          params: stdbParamsToJson(
                            toUpdateBudgetPostParams(params, operatingCompanyId),
                          ),
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
                    permission: { resource: CSV_IMPORT_CONTRACTS.taxRate.resource, action: "create" },
                    onClick: () => setCsvKind("tax"),
                  },
                  {
                    id: "tax-refresh-deadline-statuses",
                    label: t("accounting.taxes.refreshDeadlineStatuses"),
                    onClick: () => refreshTaxDeadlineStatuses.mutateAsync(),
                  },
                  {
                    id: "tax-schedule-deadline-updates",
                    label: t("accounting.taxes.scheduleDeadlineUpdates"),
                    onClick: () => scheduleTaxDeadlineUpdates.mutateAsync(),
                  },
                  editTaxAction,
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
                    permission: { resource: CSV_IMPORT_CONTRACTS.analyticAccount.resource, action: "create" },
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
              return {
                ...tab,
                type: "custom" as const,
                customContent: (
                  <div className="space-y-4">
                    <EntityView
                      config={fixedAssetsEntityConfig}
                      data={fixedAssets}
                      onRowClick={(row) => setSelectedFixedAsset(row)}
                    />
                    {selectedFixedAsset ? (
                      <div className="rounded-lg border p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm text-muted-foreground">
                            {t("accounting.entities.depreciationSchedule.title")}
                            {" — "}
                            <span className="font-medium text-foreground">
                              {String(selectedFixedAsset.name ?? selectedFixedAsset.id ?? "")}
                            </span>
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setDepreciationLineCreateOpen(true)}
                          >
                            {t("accounting.entities.fixedAssets.actions.addDepreciationLine")}
                          </Button>
                        </div>
                        <EntityView
                          useCard={false}
                          config={{
                            ...depreciationLinesEntityConfig,
                            title: "",
                            description: undefined,
                          }}
                          data={depreciationLinesForSelectedAsset}
                        />
                      </div>
                    ) : null}
                  </div>
                ),
              }
            }
            if (tab.id === "payments") {
              return {
                ...tab,
                createForm: accountPaymentFormConfig,
                entityConfig: accountPaymentsEntityConfig,
                recordSheet: paymentRecordSheet,
              }
            }
            if (tab.id === "payment-operations") {
              return {
                ...tab,
                customContent: (
                  <PaymentOperationsPanel
                    organizationId={organizationId}
                    companyId={operatingCompanyId}
                    defaultCurrencyId={defaultCurrencyId}
                    currencyOptions={currencySelectOptions}
                    journalOptions={journalFieldOptionsForModularForm}
                    glAccountOptions={glAccountFieldOptions}
                    partnerOptions={partnerSelectOptions}
                    moveLines={accountMoveLines}
                  />
                ),
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
              return {
                ...tab,
                entityConfig: intercompanyRulesEntityConfig,
                createForm: intercompanyRuleCreateFormConfig,
                createLabel: t("accounting.forms.newIntercompanyRule.title"),
                createAction: "createIntercompanyRule",
              }
            }
            if (tab.id === "intercompany-transactions") {
              return {
                ...tab,
                type: "custom" as const,
                customContent: (
                  <div className="space-y-3">
                    <div className="flex justify-end">
                      <Button
                        size="lg"
                        onClick={() => {
                          setIntercompanyTxCreateModel("account.move")
                          setIntercompanyTxCreateOpen(true)
                        }}
                      >
                        {t("accounting.forms.newIntercompanyTransaction.title")}
                      </Button>
                    </div>
                    <EntityView
                      config={intercompanyTransactionsEntityConfig}
                      data={intercompanyTransactions}
                    />
                  </div>
                ),
              }
            }
            if (tab.id === "tax-schedules") {
              return { ...tab, entityConfig: taxSchedulesEntityConfig }
            }
            if (tab.id === "tax-jurisdictions") {
              return { ...tab, entityConfig: taxJurisdictionsEntityConfig }
            }
            if (tab.id === "tax-groups") {
              return { ...tab, entityConfig: taxGroupsEntityConfig }
            }
            if (tab.id === "tax-deadlines") {
              return {
                ...tab,
                entityConfig: taxDeadlinesEntityConfig,
                recordSheet: taxDeadlineRecordSheet,
              }
            }
            if (tab.id === "bank-statements") {
              return {
                ...tab,
                entityConfig: bankStatementsActionsConfig,
                recordSheet: bankStatementRecordSheetWithEdit,
              }
            }
            if (tab.id === "reconciliation-widgets") {
              return {
                ...tab,
                createForm: reconciliationWidgetCreateFormConfig,
              }
            }
            if (tab.id === "fx-revaluation") {
              return {
                ...tab,
                type: "custom" as const,
                customContent: (
                  <FxRevaluationPanel
                    runs={fxRevaluationRuns}
                    currencySelectOptions={currencySelectOptions}
                    journalSelectOptions={journalFieldOptionsForModularForm}
                    accountSelectOptions={glAccountFieldOptions}
                    paymentSelectOptions={paymentSelectOptions}
                    moveSelectOptions={invoiceMoveSelectOptions}
                    runPending={runFxRevaluation.isPending}
                    batchPending={runFxRevaluationBatch.isPending}
                    realizedPending={postRealizedFxGainLoss.isPending}
                    onRunFxRevaluation={async (formData) => {
                      const params = toRunFxRevaluationParamsFromForm(formData)
                      if (!params) throw new Error(t("accounting.fxRevaluation.invalidForm"))
                      await runFxRevaluation.mutateAsync(params)
                      toast({ title: t("accounting.fxRevaluation.runSuccess") })
                    }}
                    onRunFxRevaluationBatch={async (formData) => {
                      const params = toRunFxRevaluationBatchParamsFromForm(formData)
                      if (!params) throw new Error(t("accounting.fxRevaluation.invalidBatchForm"))
                      await runFxRevaluationBatch.mutateAsync(params)
                      toast({ title: t("accounting.fxRevaluation.batchSuccess") })
                    }}
                    onPostRealizedFx={async (formData) => {
                      const params = toPostRealizedFxParamsFromForm(formData)
                      if (!params) throw new Error(t("accounting.fxRevaluation.invalidRealizedForm"))
                      await postRealizedFxGainLoss.mutateAsync(params)
                      toast({ title: t("accounting.fxRevaluation.realizedSuccess") })
                    }}
                    onCreateCurrencyRate={async (formData) => {
                      const params = toCreateCurrencyRateParamsFromForm(formData)
                      if (!params) throw new Error(t("accounting.fxRevaluation.invalidForm"))
                      await createCurrencyRate.mutateAsync(params)
                      toast({ title: t("accounting.fxRevaluation.rateSuccess") })
                    }}
                  />
                ),
              }
            }
            if (tab.id === "credit-control") {
              return {
                ...tab,
                type: "custom" as const,
                customContent: (
                  <PartnerCreditControlPanel
                    controls={partnerCreditControls}
                    partnerSelectOptions={partnerSelectOptions}
                    journalSelectOptions={journalFieldOptionsForModularForm}
                    accountSelectOptions={glAccountFieldOptions}
                    moveSelectOptions={invoiceMoveSelectOptions}
                    upsertPending={upsertPartnerCreditControl.isPending}
                    writeOffPending={createBadDebtWriteOff.isPending}
                    onUpsertCreditControl={async (formData) => {
                      const params = toUpsertPartnerCreditControlParamsFromForm(formData)
                      if (!params) throw new Error(t("accounting.creditControl.invalidForm"))
                      await upsertPartnerCreditControl.mutateAsync(params)
                      toast({ title: t("accounting.creditControl.upsertSuccess") })
                    }}
                    onCreateBadDebtWriteOff={async (formData) => {
                      const params = toCreateBadDebtWriteOffParamsFromForm(formData)
                      if (!params) throw new Error(t("accounting.creditControl.invalidWriteOffForm"))
                      await createBadDebtWriteOff.mutateAsync(params)
                      toast({ title: t("accounting.creditControl.writeOffSuccess") })
                    }}
                  />
                ),
              }
            }
            if (tab.id === "amortization") {
              return {
                ...tab,
                type: "custom" as const,
                customContent: (
                  <AmortizationPanel
                    schedules={amortizationSchedules}
                    lines={amortizationLines}
                    journalSelectOptions={journalFieldOptionsForModularForm}
                    accountSelectOptions={glAccountFieldOptions}
                    currencySelectOptions={currencySelectOptions}
                    createPending={createAmortizationSchedule.isPending}
                    recognizePending={recognizeAmortizationLine.isPending}
                    onCreateSchedule={async (formData) => {
                      const params = toCreateAmortizationScheduleParamsFromForm(formData)
                      if (!params) throw new Error(t("accounting.amortization.invalidForm"))
                      await createAmortizationSchedule.mutateAsync(params)
                      toast({ title: t("accounting.amortization.createSuccess") })
                    }}
                    onRecognizeLine={async ({ lineId, params }) => {
                      await recognizeAmortizationLine.mutateAsync({ lineId, params })
                      toast({ title: t("accounting.amortization.recognizeSuccess") })
                    }}
                  />
                ),
              }
            }
            if (tab.id === "consolidation") {
              return {
                ...tab,
                type: "custom" as const,
                customContent: (
                  <ConsolidationWorkspace
                    consolidationAccounts={consolidationAccounts}
                    consolidationJournals={consolidationJournals}
                    eliminationEntries={eliminationEntries}
                    consolidationCompanyIds={
                      operatingCompanyId > 0n ? [operatingCompanyId] : []
                    }
                    resolveConsolidationPeriodId={resolveConsolidationPeriodId}
                    companySelectOptions={companySelectOptions}
                    currencySelectOptions={currencySelectOptions}
                    consolidationJournalSelectOptions={consolidationJournalSelectOptions}
                    consolidationAccountSelectOptions={consolidationAccountSelectOptions}
                    companyRatesSection={
                      <ConsolidationCompanyRatesSection
                        organizationId={orgId}
                        labels={consolidationRateLabels}
                      />
                    }
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
      bankStatementsActionsConfig,
      bankStatementRecordSheetWithEdit,
      editAccount,
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
      fixedAssets,
      depreciationLinesForSelectedAsset,
      selectedFixedAsset,
      depreciationLinesEntityConfig,
      intercompanyRuleCreateFormConfig,
      intercompanyTransactions,
      accountPaymentFormConfig,
      accountPaymentsEntityConfig,
      paymentRecordSheet,
      bankStatementRecordSheet,
      accountMoveRecordSheet,
      paymentTermsEntityConfig,
      paymentTermLineFormConfig,
      paymentTermLinesEntityConfig,
      intercompanyRulesEntityConfig,
      intercompanyTransactionsEntityConfig,
      postMove,
      invoiceToPayment.postInvoice,
      cancelMove,
      computeInvoiceTotals.mutateAsync,
      refreshTaxDeadlineStatuses.mutateAsync,
      scheduleTaxDeadlineUpdates.mutateAsync,
      editTaxAction,
      taxDeadlinesEntityConfig,
      taxGroupsEntityConfig,
      taxJurisdictionsEntityConfig,
      taxSchedulesEntityConfig,
      toggleAccountDeprecated,
      checkPermission,
      canImportCsv,
      postDraft,
      analyticLineFormConfig,
      newAnalyticAccountFormConfig,
      analyticDistFormConfig,
      analyticAccountLabelMap,
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
      resolveConsolidationPeriodId,
      fiscalYearsRaw,
      accountPeriodsRaw,
      bankStatementLines,
      financialReportsRaw,
      fxRevaluationRuns,
      partnerCreditControls,
      amortizationSchedules,
      amortizationLines,
      runFxRevaluation.isPending,
      runFxRevaluation.mutateAsync,
      runFxRevaluationBatch.isPending,
      runFxRevaluationBatch.mutateAsync,
      postRealizedFxGainLoss.isPending,
      postRealizedFxGainLoss.mutateAsync,
      upsertPartnerCreditControl.isPending,
      upsertPartnerCreditControl.mutateAsync,
      createBadDebtWriteOff.isPending,
      createBadDebtWriteOff.mutateAsync,
      createAmortizationSchedule.isPending,
      createAmortizationSchedule.mutateAsync,
      recognizeAmortizationLine.isPending,
      recognizeAmortizationLine.mutateAsync,
      createCurrencyRate.mutateAsync,
      journalFieldOptionsForModularForm,
      glAccountFieldOptions,
      partnerSelectOptions,
      invoiceMoveSelectOptions,
      paymentSelectOptions,
      currencySelectOptions,
      toast,
    ],
  )

  // Entity tab data (taxes, budgets, analytic, etc. — non-rich tabs)
  const data = useMemo(
    () => ({
      taxes,
      budgets,
      analytic,
      "analytic-lines": analyticLines,
      "analytic-distribution": analyticDistribution,
      "reconciliation-widgets": reconciliationWidgets,
      "fixed-assets": fixedAssets,
      "fiscal-years": fiscalYearsDisplay,
      "account-periods": accountPeriodsDisplay,
      "intercompany-rules": intercompanyRules,
      "intercompany-transactions": intercompanyTransactions,
      payments: accountPayments,
      "bank-statements": bankStatements,
      "tax-deadlines": taxDeadlineRows,
      "tax-groups": taxGroupRows,
      "tax-jurisdictions": taxJurisdictionRows,
      "tax-schedules": taxScheduleRows,
      "payment-terms": paymentTerms,
      "payment-term-lines": paymentTermLinesDisplay,
      "account-journals": journals,
      "move-lines": accountMoveLines,
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
      bankStatements,
      taxDeadlineRows,
      taxGroupRows,
      taxJurisdictionRows,
      taxScheduleRows,
      paymentTerms,
      paymentTermLinesDisplay,
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
    } else if (tabId === "intercompany-rules") {
      setIntercompanyRuleEdit(row)
    } else if (tabId === "move-lines") {
      setMoveLineEdit(row)
    }
  }, [])

  const dataLoading = useMemo(
    () => ({
      payments: paymentsLoading,
      "bank-statements": bankStatementsLoading,
      "journal-entries": movesLoading,
    }),
    [paymentsLoading, bankStatementsLoading, movesLoading],
  )

  return (
    <>
      {formDialog}
      <ModuleView
        config={config}
        data={data}
        dataLoading={dataLoading}
        onFormSubmit={handleFormSubmit}
        onRowClick={handleEntityRowClick}
        activeTab={accountingActiveTab}
        onActiveTabChange={setAccountingActiveTab}
        dashboardTimeRange={dashboardTimeRange}
        onDashboardTimeRangeChange={setDashboardTimeRange}
        runtimeForms={{
          organizationId,
          roleId: runtimeRoleId,
        }}
      />

      {/* Invoice / bill record sheet (row click on invoices/bills tabs) */}
      <EntityRecordSheet
        open={invoiceSheetRecord != null}
        onOpenChange={(open) => {
          if (!open) setInvoiceSheetRecord(null)
        }}
        config={invoiceBillRecordSheet}
        record={invoiceSheetRecord}
      />

      <AccountGlDrilldownPanel
        account={glDrilldownAccount}
        moveLines={accountMoveLines}
        moves={allMoves}
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
          config={registerPaymentInvoicesFormConfig}
          closeOnSubmit={false}
          submitError={registerPaymentError}
          onSubmit={async (fd) => {
            setRegisterPaymentError(null)
            const raw = fd.invoiceIds
            const ids =
              raw != null && String(raw).trim() !== ""
                ? [BigInt(String(raw))]
                : []
            if (ids.length === 0) {
              setRegisterPaymentError(t("common.validation.required"))
              return
            }
            try {
              await invoiceToPayment.registerPayment({
                paymentId: registerPaymentForId,
                invoiceIds: ids,
                isBill: Boolean(fd.isBill),
              })
              setRegisterPaymentForId(null)
            } catch (e) {
              setRegisterPaymentError(e instanceof Error ? e.message : String(e))
            }
          }}
          isPending={invoiceToPayment.isPending}
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
          config={reconcilePaymentInvoiceFormConfig}
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
              await invoiceToPayment.reconcilePayment({
                paymentMoveId,
                invoiceMoveId,
              })
              setReconcilePaymentOpen(false)
            } catch (e) {
              setReconcilePaymentError(e instanceof Error ? e.message : String(e))
            }
          }}
          isPending={invoiceToPayment.isPending}
        />
      ) : null}

      {csvKind && csvFormConfig ? (
        <CsvImportModal
          organizationId={orgId}
          tableName={{ account: "account_account", accountMove: "account_move", accountMoveLine: "account_move_line", tax: "account_tax", budget: "crossovered_budget", budgetLine: "crossovered_budget_lines", analytic: "account_analytic_account" }[csvKind]}
          key={csvKind}
          onClose={() => setCsvKind(null)}
          config={csvFormConfig}
          columns={CSV_IMPORT_CONTRACTS[csvKind === "tax" ? "taxRate" : csvKind === "analytic" ? "analyticAccount" : csvKind]}
          templateFileName={`accounting-${csvKind}-import-template.csv`}
          onImport={async (text) => {
            if (csvKind === "account") await csvImports.importAccount.mutateAsync(text)
            else if (csvKind === "accountMove") await csvImports.importAccountMove.mutateAsync(text)
            else if (csvKind === "accountMoveLine") await csvImports.importAccountMoveLine.mutateAsync(text)
            else if (csvKind === "tax") await csvImports.importTaxRate.mutateAsync(text)
            else if (csvKind === "budget") await csvImports.importBudget.mutateAsync(text)
            else if (csvKind === "budgetLine") await csvImports.importBudgetLine.mutateAsync(text)
            else await csvImports.importAnalyticAccount.mutateAsync(text)
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
        onArchivePdf={selectedInvoice ? () => void handleInvoiceArchivePdf() : undefined}
        onSendEmail={selectedInvoice ? () => void handleInvoiceSendEmail() : undefined}
        onRecalculateTotals={
          selectedInvoice
            ? () =>
              void runMutation(() =>
                computeInvoiceTotals.mutateAsync(selectedInvoice.id as string | number | bigint),
              )
            : undefined
        }
        postDraftPending={postMove.isPending || invoiceToPayment.isPending}
        downloadPdfPending={invoiceDocBusy === "download"}
        archivePdfPending={invoiceDocBusy === "archive"}
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
            await createCreditNote.mutateAsync({
              companyId: operatingCompanyId,
              invoiceId: BigInt(String(creditNoteSource.id)),
              params: toCreateCreditNoteParams(data),
            })
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
        organizationId={organizationId}
        journalOptions={journalRowsAsSelectOptions}
        onSave={async (params) => {
          if (journals.length === 0) {
            toast({
              variant: "destructive",
              title: t("accounting.forms.newInvoice.createTitle"),
              description: t("accounting.forms.newInvoice.noJournalsHint"),
            })
            return
          }
          const jid = journalIdFromInvoiceModalSave(params, journals)
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
            operatingCompanyId,
          )
          await createMove.mutateAsync(p)
          if (p.metadata && p.invoicePartnerDisplayName) {
            await persistAccountMoveCustomFieldsAfterCreate(
              p.metadata,
              p.invoicePartnerDisplayName,
            )
          }
        }}
      />

      {/* Create bill (same form, different move type) */}
      <CreateInvoiceModal
        open={showCreateBill}
        onClose={() => setShowCreateBill(false)}
        organizationId={organizationId}
        journalOptions={journalRowsAsSelectOptions}
        onSave={async (params) => {
          if (journals.length === 0) {
            toast({
              variant: "destructive",
              title: t("accounting.forms.newBill.createTitle"),
              description: t("accounting.forms.newBill.noJournalsHint"),
            })
            return
          }
          const jid = journalIdFromInvoiceModalSave(params, journals)
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
            operatingCompanyId,
          )
          await createMove.mutateAsync(p)
          if (p.metadata && p.invoicePartnerDisplayName) {
            await persistAccountMoveCustomFieldsAfterCreate(
              p.metadata,
              p.invoicePartnerDisplayName,
            )
          }
        }}
      />

      {/* Dashboard quick-action form modal */}
      <RuntimeFormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        staticConfig={quickActionForm?.form ?? journalEntryFormConfig}
        moduleId="accounting"
        organizationId={organizationId}
        roleId={runtimeRoleId}
        preferStdbVisibility
        onSubmit={async (formData) => {
          if (!quickActionForm) return
          try {
            await handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          } catch (e) {
            toast({
              variant: "destructive",
              title: t("common.error.title"),
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
          await updateAccountJournal.mutateAsync({
            journalId: BigInt(String(journalEdit.id)),
            params: params as UpdateAccountJournalParams,
          })
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
        key={depreciationLineCreateOpen ? `dep-line-${String(selectedFixedAsset?.id ?? "new")}` : "dep-line-closed"}
        open={depreciationLineCreateOpen}
        onOpenChange={(open) => {
          if (!open) setDepreciationLineCreateOpen(false)
        }}
        config={depreciationLineCreateFormConfig}
        onSubmit={async (formData) => {
          await handleFormSubmit("fixed-assets", "createDepreciationLine", formData)
          setDepreciationLineCreateOpen(false)
        }}
      />

      <FormModal
        key={intercompanyRuleEdit ? `ic-rule-${String(intercompanyRuleEdit.id)}` : "ic-rule-closed"}
        open={!!intercompanyRuleEdit}
        onOpenChange={(open) => {
          if (!open) setIntercompanyRuleEdit(null)
        }}
        config={intercompanyRuleEditFormConfig}
        onSubmit={async (formData) => {
          if (!intercompanyRuleEdit?.id) return
          await updateIntercompanyRule.mutateAsync({
            ruleId: BigInt(String(intercompanyRuleEdit.id)),
            params: intercompanyRuleUpdateParamsToJson(toUpdateIntercompanyRuleParams(formData)),
          })
          setIntercompanyRuleEdit(null)
        }}
      />

      <FormModal
        key={intercompanyTxError ? `ic-tx-err-${String(intercompanyTxError.id)}` : "ic-tx-err-closed"}
        open={!!intercompanyTxError}
        onOpenChange={(open) => {
          if (!open) setIntercompanyTxError(null)
        }}
        config={intercompanyTxErrorFormConfig}
        onSubmit={async (formData) => {
          if (!intercompanyTxError?.id) return
          const errorMessage = String(formData.errorMessage ?? "").trim()
          if (!errorMessage) return
          await errorIntercompanyTransaction.mutateAsync({
            transactionId: BigInt(String(intercompanyTxError.id)),
            errorMessage,
          })
          setIntercompanyTxError(null)
        }}
      />

      <FormModal
        key={
          intercompanyTxCreateOpen
            ? `ic-tx-create-${intercompanyTxCreateModel}`
            : "ic-tx-create-closed"
        }
        open={intercompanyTxCreateOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIntercompanyTxCreateOpen(false)
            setIntercompanyTxCreateModel("account.move")
          }
        }}
        config={intercompanyTransactionCreateFormConfig}
        onValuesChange={(values) => {
          const model = String(values.originDocumentModel ?? "account.move")
          if (model !== intercompanyTxCreateModel) setIntercompanyTxCreateModel(model)
        }}
        onSubmit={async (formData) => {
          await handleFormSubmit("intercompany-transactions", "createIntercompanyTransaction", formData)
          setIntercompanyTxCreateOpen(false)
          setIntercompanyTxCreateModel("account.move")
        }}
      />

      <FormModal
        key={moveLineEdit ? `move-line-${String(moveLineEdit.id)}` : "move-line-closed"}
        open={!!moveLineEdit}
        onOpenChange={(open) => {
          if (!open) setMoveLineEdit(null)
        }}
        config={moveLineEditFormConfig}
        onSubmit={async (formData) => {
          if (!moveLineEdit?.id) return
          await updateAccountMoveLine.mutateAsync({
            lineId: BigInt(String(moveLineEdit.id)),
            params: updateAccountMoveLineParamsToJson(toUpdateAccountMoveLineParams(formData)),
          })
          setMoveLineEdit(null)
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
              if (!(await confirmDialog({ description: `${t("common.delete")}?` }))) return
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
              if (!(await confirmDialog({ description: `${t("common.delete")}?` }))) return
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
                  onClick={async () => {
                    if (!bankStatementDetail.id) return
                    if (!(await confirmDialog({ description: t("accounting.bankStatementDetail.deleteStatementConfirm") }))) return
                    void runMutation(() => deleteBankStatement.mutateAsync(BigInt(String(bankStatementDetail.id)))).then(
                      (ok) => {
                        if (ok) setBankStatementDetail(null)
                      },
                    )
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
                        {statementLinesPager.pageRows.map((line) => {
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
                                      onClick={async () => {
                                        if (!line.id) return
                                        if (!(await confirmDialog({ description: t("accounting.bankStatementDetail.unreconcileConfirm") })))
                                          return
                                        const lid = BigInt(String(line.id))
                                        const amt = Number(line.amount ?? 0)
                                        void runMutation(() =>
                                          unreconcileBankLine.mutateAsync({
                                            lineId: lid,
                                            params: bankReconcileParamsToJson([], amt),
                                          }),
                                        )
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
                                    onClick={async () => {
                                      if (!line.id) return
                                      if (!(await confirmDialog({ description: t("accounting.bankStatementDetail.deleteLineConfirm") })))
                                        return
                                      void runMutation(() => deleteBankStatementLine.mutateAsync(BigInt(String(line.id))))
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
                    <TablePager {...statementLinesPager} />
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
                          void runMutation(() =>
                            matchBankLine.mutateAsync({
                              lineId: BigInt(String(bankLineMatchFocus.id)),
                              ruleId: parseOptionalRuleId(reconciliationRuleIdInput),
                            }),
                          )
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
                          void runMutation(() =>
                            applyReconciliationRules.mutateAsync({
                              lineId: BigInt(String(bankLineMatchFocus.id)),
                              ruleId: parseOptionalRuleId(reconciliationRuleIdInput),
                            }),
                          )
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
                                        void runMutation(() =>
                                          reconcileBankLine.mutateAsync({
                                            lineId: BigInt(String(bankLineMatchFocus.id)),
                                            params: bankReconcileParamsToJson(
                                              [BigInt(String(c.entityId))],
                                              0,
                                            ),
                                          }),
                                        )
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
                          void runMutation(() =>
                            reconcileBankLine.mutateAsync({
                              lineId: BigInt(String(bankLineMatchFocus.id)),
                              params: bankReconcileParamsToJson(
                                ids,
                                Number.isFinite(res) ? res : 0,
                              ),
                            }),
                          )
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
      {confirmDialogNode}
    </>
  )
}

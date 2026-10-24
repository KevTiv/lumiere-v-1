"use client"
import { resolveRuntimeFormRoleId } from "@lumiere/ui/lib/runtime-form-role"
import { AssetDepreciationSchedule } from "@lumiere/ui/accounting-components/asset-depreciation-schedule"
import { useModuleTab } from "@/hooks/use-module-tab"
import { FinanceReviewWorkspace } from "@lumiere/ui/composed/finance-review-workspace"
import { BillSourcePreview } from "../../../components/finance-source-preview"
import { mapDashboardWidgets } from "@lumiere/ui/lib/dashboard-sections"
import { agingShareRows, agingTotals, collectionRate, singleCurrencyId, revenueVsExpensesByMonth, topCustomers, weeklyCashMovements } from "./accounting-dashboard-charts"
import { currencyCodeMap } from "@lumiere/ui/lib/kpi-tiles"
import { formatChartValue, type ChartValueFormat } from "@lumiere/ui/lib/chart-format"
import { AccountantOverview } from "./accountant-overview"
import { BillDocumentIntake } from "./bill-document-intake"
import { currencyCatalogContainsId } from "@/lib/accounting-setup-reference"
import { useInvoicePersonalization } from "@lumiere/query-hooks/hooks/invoice-personalization"
import { invoiceSellerFromCompany, invoiceSellerCompanyFromQueryRow, isInvoiceSellerIdentityReady } from "@lumiere/erp-shared/invoice-personalization"
import { formatInvoiceMoney, resolveDraftInvoiceDocument } from "../../../../packages/ui/src/accounting-components/invoice-document"
import { ReconciliationWorkbench, type ReconciliationOutcome, type ReconciliationStatusResult } from "../../../../packages/ui/src/accounting-components/reconciliation-workbench"
import type { ReconciliationRequest, ReconciliationSource } from "../../../../packages/ui/src/accounting-components/reconciliation-workbench-model"
import { bankLineFromQueryRow, bankSettlementRecoveryPermissions, canDispatchReviewedBankLink } from "./bank-link-review"
import { resolveBankStatementSettlementEffect, useRecoverBankStatementSettlement } from "@lumiere/query-hooks/hooks/accounting/bank-statements"
import { resolveBankSettlementLifecycleEffect } from "@lumiere/query-hooks/hooks/accounting/bank-settlement-effect"
import { bankSettlementAttempt, bankSettlementRecoveryAllowed, bankSettlementRecoveryCorrelates, hasBankSettlementAttempt, type BankSettlementRecoveryAction, type BankSettlementRecoveryRequest } from "@lumiere/erp-shared/bank-settlement-lifecycle"
import { CollectionsWorkspace } from "../../../../packages/ui/src/accounting-components/collections-workspace"
import { AccountingAuthoringPreview, hasAccountingAuthoringPreview } from "./accounting-authoring-preview"
import type { FormValues } from "@lumiere/ui/lib/form-types"
import { ReconciliationMoveLineProvider } from "@lumiere/ui/forms/reconciliation-move-line-picker"
import { reconciliationAccountChoices, reconciliationPartnerChoices, reconciliationSelectionIssue, type ReconciliationSelectionIssue } from "@lumiere/ui/lib/reconciliation-widget-choices"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useClearModuleUrlFilter, useModuleUrlFilters } from "@lumiere/ui/lib/module-url-filters"
import { useErpSession } from "@lumiere/erp-session"
import { canUseModuleData, mergeModuleStates, moduleCollection } from "@lumiere/ui/lib/module-data-state"
import { useTranslation } from "@lumiere/i18n"
import { useConfirmDialog } from "@lumiere/ui/hooks/use-confirm-dialog"
import {
  ModuleView,
  DashboardWidgetRenderer,
  FormModal,
  CsvImportModal,
  CSV_IMPORT_CONTRACTS,
  RuntimeFormModal,
  EntityView,
  EntityDetail,
  ListPivotSwitch,
  useRBAC,
  newJournalEntryForm,
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
  AccountingSetupReadinessPanel,
  evaluateAccountingSetupReadiness,
  type AccountingReadinessAction,
  type AccountingReadinessItem,
  type AccountingSetupReadinessInput,
} from "@lumiere/ui"
import type { BadgeVariant, EntityAction, EntityRecordSheetConfig, FormField, EntityRow, EntityTableConfig, EntityViewConfig, FormConfig, ModuleConfig } from "@lumiere/ui"
import {
  accountingParamsToJson,
  analyticParamsToJson,
  toCreateAccountAccountParams,
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
import {
  ACCOUNT_MOVE_BUNDLE_COLUMNS,
  ACCOUNT_MOVE_IMPORT_BUNDLE,
  accountMoveBundleMappings,
  accountMoveBundleToken,
  accountIsEligibleManualInvoiceTaxPosting,
  accountMatchesManualInvoiceLineType,
  accountMoveReference,
  buildAccountMoveLineCsv,
  buildBundleParentCsv,
  buildMoveIdMapFromAccountMoves,
  markAccountMoveBundleParentCsv,
  markAccountMoveBundleLineCsv,
  parseCsvText,
  splitAccountMoveImportCsv,
  type ColumnMappingMap,
  type SplitAccountMoveImportResult,
} from "@lumiere/erp-shared"
import {
  HISTORICAL_PAYMENT_REPLAY_IMPORT_COLUMNS,
  OUTSTANDING_DOCUMENT_IMPORT_COLUMNS,
  outstandingDocumentSplitArgs,
  prepareOutstandingDocumentImport,
  type OutstandingDocumentImportMode,
} from "@lumiere/erp-shared/outstanding-document-import"
import { createCsvImportRequest, type CsvImportReceipt } from "@lumiere/query-hooks/hooks/csv-import-request"
import { useTrackedCsvImport } from "@lumiere/query-hooks/hooks/tracked-csv-import"
import { useCleanupAbandonedAccountMoveImport } from "@lumiere/query-hooks/hooks/import-jobs"
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
import { historicalPaymentReplayIsCallable } from "./historical-payment-replay-capability"
import {
  buildHistoricalPaymentReplayBatches,
  resolveHistoricalImportResume,
  validateHistoricalPaymentReplayCapability,
  validateHistoricalPaymentReplaySources,
  type HistoricalImportResume,
} from "./historical-payment-import"
import { accountMovePivotSetup } from "@lumiere/ui/lib/accounting-pivot-configs"
import { PaymentOperationsPanel } from "./payment-operations-panel"
import { useModuleSubscription } from "@lumiere/stdb/live"
import { accountingReadPlan, accountingPlannedCollection, ACCOUNTING_ACTION_WORKSPACES, ACCOUNTING_IMPORT_WORKSPACES } from "./accounting-read-plan"
import { chatterTargetFromRow, type ChatterTarget } from "@/lib/record-chatter"
import { readImportFile } from "@/lib/import-spreadsheet-file"
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
  useCreateManualAccountInvoice,
  readManualAccountInvoiceEffect,
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
  useApplyHistoricalPaymentAllocations,
  useAccountPayments,
  usePaymentTransactions,
  usePaymentReversals,
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
import { withAssetAuthoringVisibility } from "./asset-authoring-fields"
import { accountIsDeprecated, deprecateAccountParams } from "./account-deprecation"
import { ACCOUNT_INTERNAL_TYPES, accountEditDefaults, toAccountUpdateParams } from "./account-edit"
import {
  bankJournals,
  canEditBankStatement,
  statementDateInput,
  toBankStatementCreateInput,
  toBankStatementUpdateParams,
} from "./bank-statement-actions"
import { useFormDialog, workflowActionsToEntityActions } from "@lumiere/ui"
import type {
  AccountAnalyticAccount,
  AccountFiscalYear,
  AccountMove,
  AccountPeriod,
  CrossoveredBudget,
  CreateManualAccountInvoiceParams,
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
import { apiFetch, fetchQueryList } from "@lumiere/query-hooks/http"
import { persistCustomFieldsToEav } from "@/lib/persist-record-custom-fields"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useCompanies } from "@lumiere/query-hooks/hooks/organization-company"
import { useSaleOrders } from "@lumiere/query-hooks/hooks/sales"
import { useContacts } from "@lumiere/query-hooks/hooks/crm"
import { useProducts } from "@lumiere/query-hooks/hooks/inventory"
import { downloadDocumentPdf } from "@lumiere/query-hooks/hooks/templates"
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
import { runtimeFormRoleId } from "@lumiere/ui/lib/runtime-form-role"

function copyAsRecord<T extends object>(row: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row))
}

function copyAsRecords<T extends object>(rows: readonly T[]): Record<string, unknown>[] {
  return rows.map(copyAsRecord)
}

type ManualInvoiceAccountLookup = {
  readonly id?: unknown
  readonly code?: unknown
  readonly name?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly deprecated?: unknown
  readonly isOffBalance?: unknown
  readonly internalType?: unknown
  readonly internalGroup?: unknown
  readonly allowedJournalIds?: unknown
}

type ManualInvoicePartnerLookup = {
  readonly id?: unknown
  readonly name?: unknown
  readonly displayName?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly deletedAt?: unknown
  readonly deleted_at?: unknown
  readonly isCustomer?: unknown
  readonly customerRank?: unknown
  readonly isVendor?: unknown
  readonly supplierRank?: unknown
}

type ManualInvoiceJournalLookup = {
  readonly id?: unknown
  readonly name?: unknown
  readonly code?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly active?: unknown
  readonly type?: unknown
  readonly type_?: unknown
  readonly currencyId?: unknown
  readonly currency_id?: unknown
}

type ManualInvoiceTaxGroupLookup = {
  readonly id?: unknown
  readonly taxPayableAccountId?: unknown
  readonly tax_payable_account_id?: unknown
  readonly taxReceivableAccountId?: unknown
  readonly tax_receivable_account_id?: unknown
}

type ManualInvoiceTaxLookup = {
  readonly id?: unknown
  readonly name?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly active?: unknown
  readonly typeTaxUse?: unknown
  readonly type_tax_use?: unknown
  readonly priceInclude?: unknown
  readonly hasNegativeFactor?: unknown
  readonly amount?: unknown
  readonly amountType?: unknown
  readonly amount_type?: unknown
  readonly taxGroupId?: unknown
  readonly tax_group_id?: unknown
}

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

function moveLineIdsFromRow(line: Record<string, unknown>): bigint[] {
  const raw = line.moveIds
  if (!Array.isArray(raw)) return []
  return raw.map((id) => BigInt(String(id)))
}

type AccountingCsvImportKind =
  | "account"
  | "accountMove"
  | "outstandingDocuments"
  | "historicalDocumentsForPaymentReplay"
  | "accountMoveLine"
  | "tax"
  | "budget"
  | "budgetLine"
  | "analytic"

const HISTORICAL_PAYMENT_REPLAY_CALLABLE = historicalPaymentReplayIsCallable()

function assertBundleImportSucceeded(
  stage: string,
  receipt: CsvImportReceipt,
): void {
  if (receipt.status === "success" && receipt.errorRows === 0) return
  const firstError = receipt.errors[0]?.errorMessage
  throw new Error(
    `${stage} import job #${receipt.jobId} finished ${receipt.status} with ${receipt.errorRows} rejected row${receipt.errorRows === 1 ? "" : "s"}.${firstError ? ` ${firstError}` : " Review the import job before retrying."}`,
  )
}

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
  companyAvailable: boolean
}

export function AccountingClient(props: AccountingClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <AccountingClientLoaded {...props} organizationId={props.organizationId} />
}

function AccountingClientLoaded(props: AccountingClientLoadedProps) {
  const { companyIds, setActiveCompanyId } = useErpSession()
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(props.organizationId)
  const retainedCompany = useRef(operatingCompanyId)
  if (operatingCompanyId != null) retainedCompany.current = operatingCompanyId
  useEffect(() => {
    const rawCompanyId = new URLSearchParams(window.location.search).get("companyId")
    if (!rawCompanyId) return
    const companyId = Number(rawCompanyId)
    if (
      !Number.isSafeInteger(companyId) ||
      companyId <= 0 ||
      !companyIds?.includes(companyId)
    ) return
    setActiveCompanyId?.(companyId)
    window.history.replaceState(window.history.state, "", "/accounting")
  }, [companyIds, setActiveCompanyId])
  if (retainedCompany.current == null) {
    return (
      <div className="space-y-4 rounded-lg border border-dashed p-6 text-sm text-muted-foreground" role="status">
        <p>Select an active company to open the accounting workspace.</p>
        <a
          href="/settings?section=finance-setup"
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
        >
          Complete Finance setup
        </a>
      </div>
    )
  }
  return <AccountingClientReady {...props} operatingCompanyId={retainedCompany.current} companyAvailable={operatingCompanyId != null} />
}

function AccountingClientReady({
  initialBudgets,
  initialAnalytic,
  initialFiscalYears,
  initialAccountPeriods,
  organizationId,
  operatingCompanyId,
  companyAvailable,
}: AccountingClientReadyProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const invoiceFilters = useModuleUrlFilters()
  const clearModuleFilter = useClearModuleUrlFilter()
  const clearInvoiceFilter = useCallback((key: string) => {
    if (key !== "*") return clearModuleFilter(key)
    const params = new URLSearchParams(searchParams.toString())
    params.delete("filter")
    const query = params.toString()
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false })
  }, [clearModuleFilter, pathname, router, searchParams])
  const { t } = useTranslation()
  const { confirm: confirmDialog, dialog: confirmDialogNode } = useConfirmDialog()
  const { toast } = useToast()
  const { askForm: showForm, cancelForm, formDialog } = useFormDialog()
  const [promptWorkspace, setPromptWorkspace] = useState<string | null>(null)
  const [moduleFormWorkspace, setModuleFormWorkspace] = useState<string | null>(null)
  const { currentUser, checkPermission } = useRBAC()
  const runtimeRoleId = resolveRuntimeFormRoleId(currentUser?.roles)
  const moduleConfigBase = useMemo(() => accountingModuleConfig(t), [t])
  const accountingTabIds = useMemo(
    () => [
      ...moduleConfigBase.tabs.map((tab) => tab.id),
      "account-journals",
      "move-lines",
      "period-close",
    ],
    [moduleConfigBase],
  )
  const { activeTab: accountingActiveTab, setActiveTab: setAccountingActiveTab } = useModuleTab(
    moduleConfigBase.defaultTab ?? "dashboard",
    accountingTabIds,
    { history: "push" },
  )
  const askForm = useCallback(async (request: Parameters<typeof showForm>[0]) => {
    setPromptWorkspace(accountingActiveTab)
    try { return await showForm(request) }
    finally { setPromptWorkspace(null) }
  }, [showForm, accountingActiveTab])
  /** BigInt organization id for `useStdbQuery` cache keys (not SpacetimeDB `company_id` reducers). */
  const { orgId } = orgBigInts(organizationId)
  async function persistAccountMoveCustomFieldsExact(metadata: unknown, recordId: string, companyId: bigint) {
    await persistCustomFieldsToEav({
      organizationId,
      companyId,
      model: "account_move",
      recordId: BigInt(recordId),
      metadata,
    })
  }

  // Quick-action form modal (dashboard tab)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  // Invoice detail modal
  const [selectedInvoice, setSelectedInvoice] = useState<AccountMove | null>(null)
  // Invoice/bill record sheet (row click on invoices/bills tabs)
  const [invoiceSheetRecord, setInvoiceSheetRecord] = useState<Record<string, unknown> | null>(null)
  // Create invoice / bill modals
  const [showCreateInvoice, setShowCreateInvoice] = useState(false)
  const [showCreateBill, setShowCreateBill] = useState(false)
  const [readinessAction, setReadinessAction] = useState<AccountingReadinessAction | undefined>()
  const [pendingAccountingAction, setPendingAccountingAction] = useState<{
    action: AccountingReadinessAction
    onReady: () => void
  } | null>(null)
  useEffect(() => { setReadinessAction(undefined) }, [accountingActiveTab])
  const [creditNoteSource, setCreditNoteSource] = useState<AccountMove | null>(null)
  // Analytic row editors (click row on Analytic tabs)
  const [analyticAccountEdit, setAnalyticAccountEdit] = useState<Record<string, unknown> | null>(null)
  const [analyticLineEdit, setAnalyticLineEdit] = useState<Record<string, unknown> | null>(null)
  const [analyticDistEdit, setAnalyticDistEdit] = useState<Record<string, unknown> | null>(null)
  const [bankStatementDetail, setBankStatementDetail] = useState<Record<string, unknown> | null>(null)
  const [bankLineCreateOpen, setBankLineCreateOpen] = useState(false)
  const [bankLineEdit, setBankLineEdit] = useState<Record<string, unknown> | null>(null)
  const [bankLineMatchFocus, setBankLineMatchFocus] = useState<Record<string, unknown> | null>(null)
  const [bankLinkLocked, setBankLinkLocked] = useState(false)
  const [paymentOperationsLocked, setPaymentOperationsLocked] = useState(false)
  const bankLinkLockRef = useRef(false)
  const handleBankLinkLock = useCallback((locked: boolean) => {
    bankLinkLockRef.current = locked
    setBankLinkLocked(locked)
  }, [])
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
  // Keep the controller and open write/recovery sessions mounted across navigation.
  // Their workspace dependencies remain live until the original dialog is dismissed.
  const readPlan = accountingReadPlan(accountingActiveTab, [
    promptWorkspace,
    moduleFormWorkspace,
    paymentOperationsLocked && "payment-operations",
    quickActionForm && ACCOUNTING_ACTION_WORKSPACES[quickActionForm.action],
    csvKind && ACCOUNTING_IMPORT_WORKSPACES[csvKind],
    (selectedInvoice || invoiceSheetRecord || creditNoteSource) && "invoices",
    (analyticAccountEdit && "analytic"), (analyticLineEdit && "analytic-lines"),
    (analyticDistEdit && "analytic-distribution"),
    (bankStatementDetail || bankLineMatchFocus || bankLinkLocked || bankLineEdit || bankLineCreateOpen) && "bank-statements",
    reconciliationWidgetEdit && "reconciliation-widgets",
    (registerPaymentForId || reconcilePaymentOpen) && "payments",
    paymentTermLineEdit && "payment-term-lines",
    (selectedFixedAsset || depreciationLineCreateOpen) && "fixed-assets",
    intercompanyRuleEdit && "intercompany-rules",
    (intercompanyTxCreateOpen || intercompanyTxError) && "intercompany-transactions",
    (moveLineEdit || glDrilldownAccount) && "move-lines",
  ].filter((workspace): workspace is string => typeof workspace === "string"))
  useModuleSubscription([...readPlan])
  const readEnabled = (resource: string) => companyAvailable && organizationId > 0 && readPlan.has(resource)
  const plannedCollection = <Row,>(resource: string, query: Parameters<typeof moduleCollection<Row>>[0]) =>
    accountingPlannedCollection(readEnabled(resource), moduleCollection(query))
  // ── Data hooks ──────────────────────────────────────────────────────────────
  const accountsQuery = useAccountAccounts(orgId, { enabled: organizationId > 0 })
  const accountsRead = moduleCollection(accountsQuery)
  const accounts = accountsRead.rows
  const allMovesRead = moduleCollection(useAccountMoves(orgId, {
    enabled: organizationId > 0,
  }))
  const allMoves = allMovesRead.rows
  const movesLoading = allMovesRead.state.status === "loading"
  const accountMoveLinesRead = plannedCollection("account-move-lines", useAccountMoveLines(orgId, { enabled: readEnabled("account-move-lines") }))
  const accountMoveLines = accountMoveLinesRead.rows
  const taxesRead = moduleCollection(useAccountTaxes(orgId, { enabled: organizationId > 0 }))
  const taxes = taxesRead.rows
  const budgetsRead = plannedCollection("budgets", useCrossoveredBudgets(orgId, {
    enabled: readEnabled("budgets"),
    initialData: initialBudgets,
  }))
  const budgets = budgetsRead.rows
  const budgetLinesRead = plannedCollection("budget-lines", useBudgetLines(orgId, { enabled: readEnabled("budget-lines") }))
  const budgetLines = budgetLinesRead.rows
  const budgetPostsRead = plannedCollection("budget-posts", useBudgetPosts(orgId, { enabled: readEnabled("budget-posts") }))
  const budgetPosts = budgetPostsRead.rows
  const taxDeadlinesRead = plannedCollection("tax-deadlines", useTaxDeadlines(orgId, { enabled: readEnabled("tax-deadlines") }))
  const taxDeadlines = taxDeadlinesRead.rows
  const taxGroupsRead = moduleCollection(useAccountTaxGroups(orgId, { enabled: organizationId > 0 }))
  const taxGroups = taxGroupsRead.rows
  const taxJurisdictionsRead = plannedCollection("tax-jurisdictions", useTaxJurisdictions(orgId, { enabled: readEnabled("tax-jurisdictions") }))
  const taxJurisdictions = taxJurisdictionsRead.rows
  const taxSchedulesRead = plannedCollection("tax-schedules", useTaxSchedules(orgId, { enabled: readEnabled("tax-schedules") }))
  const taxSchedules = taxSchedulesRead.rows
  const analyticRead = plannedCollection("analytic-accounts", useAccountAnalyticAccounts(orgId, { enabled: readEnabled("analytic-accounts") }))
  const analytic = analyticRead.rows
  const analyticLinesRead = plannedCollection("analytic-lines", useAccountAnalyticLines(orgId, { enabled: readEnabled("analytic-lines") }))
  const analyticLines = analyticLinesRead.rows
  const analyticDistributionRead = plannedCollection("analytic-distribution-models", useAccountAnalyticDistributionModels(orgId, {
    enabled: readEnabled("analytic-distribution-models"),
  }))
  const analyticDistribution = analyticDistributionRead.rows
  const bankStatementsRead = plannedCollection("bank-statements", useAccountBankStatements(orgId, { enabled: readEnabled("bank-statements") }))
  const bankStatements = bankStatementsRead.rows
  const bankStatementsLoading = bankStatementsRead.state.status === "loading"
  const bankStatementLinesRead = plannedCollection("bank-statement-lines", useAccountBankStatementLines(orgId, { enabled: readEnabled("bank-statement-lines") }))
  const bankStatementLines = bankStatementLinesRead.rows
  const bankMatchCandidatesRead = plannedCollection("bank-match-candidates", useBankMatchCandidates(orgId, { enabled: readEnabled("bank-match-candidates") }))
  const bankMatchCandidates = bankMatchCandidatesRead.rows
  const reconciliationWidgetsRead = plannedCollection("account-reconciliation-widgets", useAccountReconciliationWidgets(orgId, {
    enabled: readEnabled("account-reconciliation-widgets"),
  }))
  const reconciliationWidgets = reconciliationWidgetsRead.rows
  const fixedAssetsRead = plannedCollection("fixed-assets", useAccountFixedAssets(orgId, { enabled: readEnabled("fixed-assets") }))
  const fixedAssets = fixedAssetsRead.rows
  const accountPaymentsRead = plannedCollection("account-payments", useAccountPayments(orgId, { enabled: readEnabled("account-payments") }))
  const accountPayments = accountPaymentsRead.rows
  const paymentsLoading = accountPaymentsRead.state.status === "loading"
  const paymentTransactionsRead = plannedCollection("payment-transactions", usePaymentTransactions(orgId, { enabled: readEnabled("payment-transactions") }))
  const paymentReversalsRead = plannedCollection("payment-reversals", usePaymentReversals(orgId, { enabled: readEnabled("payment-reversals") }))
  const paymentTermsRead = moduleCollection(useAccountPaymentTerms(orgId, { enabled: organizationId > 0 }))
  const paymentTerms = paymentTermsRead.rows
  const paymentTermLinesRead = plannedCollection("account-payment-term-lines", useAccountPaymentTermLines(orgId, { enabled: readEnabled("account-payment-term-lines") }))
  const paymentTermLines = paymentTermLinesRead.rows
  const depreciationLinesQuery = useDepreciationLines(orgId, { enabled: readEnabled("depreciation-lines") })
  const depreciationLinesRead = plannedCollection("depreciation-lines", depreciationLinesQuery)
  const depreciationLines = depreciationLinesRead.rows
  const companiesRead = moduleCollection(useCompanies(organizationId, organizationId > 0))
  const companies = companiesRead.rows
  const invoicePersonalization = useInvoicePersonalization({ organizationId, companyId: operatingCompanyId, enabled: organizationId > 0 && operatingCompanyId > 0n })
  const invoiceCompany = companies.find((company) => String(company.id) === String(operatingCompanyId))
  const invoiceSellerCompany = invoiceSellerCompanyFromQueryRow(invoiceCompany)
  const invoiceIdentityReady = isInvoiceSellerIdentityReady(invoiceSellerCompany, operatingCompanyId, organizationId)
  const invoiceIdentityState = companiesRead.state.status === "ready" && !invoiceIdentityReady
    ? { status: "error" as const, message: "The selected company identity is unavailable. Refresh before creating or posting an invoice." }
    : companiesRead.state
  const invoiceSeller = invoicePersonalization.profile && invoiceIdentityReady
    ? invoiceSellerFromCompany(invoiceSellerCompany, invoicePersonalization.profile)
    : undefined
  const currenciesQuery = useCurrencies()
  const currenciesRead = moduleCollection(currenciesQuery)
  const currencies = currenciesRead.rows
  const currentBankStatements = bankStatements.filter((row) => String(row.id) === String(bankStatementDetail?.id)
    && row.organizationId === orgId && row.companyId === operatingCompanyId)
  const currentBankStatement = currentBankStatements.length === 1 ? currentBankStatements[0]! : null
  const intercompanyRulesRead = plannedCollection("intercompany-rules", useIntercompanyRules(orgId, { enabled: readEnabled("intercompany-rules") }))
  const intercompanyRules = intercompanyRulesRead.rows
  const intercompanyTransactionsRead = plannedCollection("intercompany-transactions", useIntercompanyTransactions(orgId, {
    enabled: readEnabled("intercompany-transactions"),
  }))
  const intercompanyTransactions = intercompanyTransactionsRead.rows
  const saleOrdersRead = moduleCollection(useSaleOrders(orgId))
  const saleOrders = saleOrdersRead.rows
  const contactsRead = moduleCollection(useContacts(orgId))
  const contacts = contactsRead.rows
  const productsRead = moduleCollection(useProducts(orgId))
  const products = productsRead.rows
  const journalsQuery = useAccountJournals(orgId, { enabled: organizationId > 0 })
  const journalsRead = moduleCollection(journalsQuery)
  const journals = journalsRead.rows
  const accountTypesRead = moduleCollection(useAccountAccountTypes(orgId, { enabled: organizationId > 0 }))
  const accountTypes = accountTypesRead.rows
  const accountGroupsRead = plannedCollection("account-groups", useAccountGroups(orgId, { enabled: readEnabled("account-groups") }))
  const accountGroups = accountGroupsRead.rows
  const consolidationAccountsRead = plannedCollection("consolidation-accounts", useConsolidationAccounts(orgId, {
    enabled: readEnabled("consolidation-accounts"),
  }))
  const consolidationAccounts = consolidationAccountsRead.rows
  const consolidationJournalsRead = plannedCollection("consolidation-journals", useConsolidationJournals(orgId, {
    enabled: readEnabled("consolidation-journals"),
  }))
  const consolidationJournals = consolidationJournalsRead.rows
  const eliminationEntriesRead = plannedCollection("consolidation-elimination-entries", useConsolidationEliminationEntries(orgId, {
    enabled: readEnabled("consolidation-elimination-entries"),
  }))
  const eliminationEntries = eliminationEntriesRead.rows
  const fxRevaluationRunsRead = plannedCollection("fx-revaluation-runs", useFxRevaluationRuns(orgId, {
    enabled: readEnabled("fx-revaluation-runs"),
  }))
  const fxRevaluationRuns = fxRevaluationRunsRead.rows
  const partnerCreditControlsRead = plannedCollection("partner-credit-controls", usePartnerCreditControls(orgId, {
    enabled: readEnabled("partner-credit-controls"),
  }))
  const partnerCreditControls = partnerCreditControlsRead.rows
  const amortizationSchedulesRead = plannedCollection("amortization-schedules", useAmortizationSchedules(orgId, {
    enabled: readEnabled("amortization-schedules"),
  }))
  const amortizationSchedules = amortizationSchedulesRead.rows
  const amortizationLinesRead = plannedCollection("amortization-lines", useAmortizationLines(orgId, {
    enabled: readEnabled("amortization-lines"),
  }))
  const amortizationLines = amortizationLinesRead.rows
  const fiscalYearsRawRead = moduleCollection(useAccountFiscalYears(orgId, {
    enabled: organizationId > 0,
    initialData: initialFiscalYears,
    staleTime: 0,
  }))
  const fiscalYearsRaw = fiscalYearsRawRead.rows
  const accountPeriodsQuery = useAccountPeriods(orgId, {
    enabled: organizationId > 0,
    initialData: initialAccountPeriods,
  })
  const accountPeriodsRawRead = moduleCollection(accountPeriodsQuery)
  const accountPeriodsRaw = accountPeriodsRawRead.rows
  const financialReportsRead = plannedCollection("financial-reports", useFinancialReports(orgId, undefined, { enabled: readEnabled("financial-reports") }))
  const financialReportsRaw = financialReportsRead.rows

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
  const invoiceCurrencyOptions = useMemo(() => currencies.map((row) => {
    const code = String(row.code ?? "").trim().toUpperCase()
    return {
      value: String(row.id),
      label: String(row.code ?? row.name ?? row.id),
      code: /^[A-Z]{3}$/.test(code) ? code : undefined,
    }
  }), [currencies])

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

  const manualInvoiceCurrencyId = useMemo(
    () =>
      companies.find((company) => company.id === operatingCompanyId)?.currencyId ?? 0n,
    [companies, operatingCompanyId],
  )

  const manualInvoiceOptions = useMemo(() => {
    const companyKey = String(operatingCompanyId)
    const accountLabel = (row: ManualInvoiceAccountLookup) =>
      `${String(row.code ?? "").trim() ? `${String(row.code)} — ` : ""}${String(row.name ?? row.id ?? "")}`
    const allowedJournals = (row: ManualInvoiceAccountLookup) =>
      Array.isArray(row.allowedJournalIds) ? row.allowedJournalIds.map(String) : []
    const accountsFor = (kind: "invoice" | "bill", counterpart: boolean) =>
      (accounts as ManualInvoiceAccountLookup[])
        .filter((row) => String(row.companyId ?? row.company_id ?? "") === companyKey)
        .filter((row) => row.deprecated !== true && row.isOffBalance !== true)
        .filter((row) => enumTag(counterpart ? row.internalType : row.internalGroup) === (
          counterpart ? (kind === "invoice" ? "Receivable" : "Payable") : (kind === "invoice" ? "Income" : "Expense")
        ))
        .map((row) => ({ value: String(row.id), label: accountLabel(row), allowedJournalIds: allowedJournals(row) }))
    const partnersFor = (kind: "invoice" | "bill") =>
      (contacts as ManualInvoicePartnerLookup[])
        .filter((row) => row.deletedAt == null && row.deleted_at == null)
        .filter((row) => {
          const rowCompany = row.companyId ?? row.company_id
          return rowCompany == null || String(rowCompany) === companyKey
        })
        .filter((row) => kind === "invoice"
          ? row.isCustomer === true || Number(row.customerRank ?? 0) > 0
          : row.isVendor === true || Number(row.supplierRank ?? 0) > 0)
        .map((row) => ({ value: String(row.id), label: String(row.displayName ?? row.name ?? row.id) }))
    const journalsFor = (kind: "invoice" | "bill") =>
      (journals as ManualInvoiceJournalLookup[])
        .filter((row) => String(row.companyId ?? row.company_id ?? "") === companyKey && row.active !== false)
        .filter((row) => enumTag(row.type ?? row.type_) === (kind === "invoice" ? "Sale" : "Purchase"))
        .map((row) => ({
          value: String(row.id),
          label: `${String(row.code ?? "").trim() ? `${String(row.code)} — ` : ""}${String(row.name ?? row.id)}`,
          currencyId: String(row.currencyId ?? row.currency_id ?? defaultCurrencyId),
        }))
    const taxGroupById = new Map(
      (taxGroups as ManualInvoiceTaxGroupLookup[]).map((row) => [String(row.id), row]),
    )
    const taxesFor = (kind: "invoice" | "bill") =>
      (taxes as ManualInvoiceTaxLookup[])
        .filter((row) => String(row.companyId ?? row.company_id ?? "") === companyKey && row.active !== false)
        .filter((row) => [kind === "invoice" ? "Sale" : "Purchase", "None"].includes(enumTag(row.typeTaxUse ?? row.type_tax_use)))
        .filter((row) => row.priceInclude !== true && row.hasNegativeFactor !== true && Number(row.amount ?? 0) >= 0)
        .filter((row) => ["Percent", "Fixed", "Division"].includes(enumTag(row.amountType ?? row.amount_type)))
        .filter((row) => {
          const group = taxGroupById.get(String(row.taxGroupId ?? row.tax_group_id ?? ""))
          return group != null && (kind === "invoice"
            ? group.taxPayableAccountId ?? group.tax_payable_account_id
            : group.taxReceivableAccountId ?? group.tax_receivable_account_id) != null
        })
        .map((row) => ({
          value: String(row.id), label: String(row.name ?? row.id), amount: Number(row.amount ?? 0),
          amountType: enumTag(row.amountType ?? row.amount_type) as "Percent" | "Fixed" | "Division",
        }))
    const productsFor = (kind: "invoice" | "bill") =>
      (products as Record<string, unknown>[])
        .filter((row) => row.active !== false && (kind === "invoice" ? row.saleOk === true : row.purchaseOk === true))
        .map((row) => ({
          value: String(row.id),
          label: String(row.displayName ?? row.name ?? row.id),
          description: String((kind === "invoice" ? row.descriptionSale : row.descriptionPurchase) ?? row.name ?? ""),
          price: Number(kind === "invoice" ? row.listPrice ?? row.price ?? 0 : row.standardPrice ?? 0),
          accountId: String((kind === "invoice" ? row.propertyAccountIncomeId : row.propertyAccountExpenseId) ?? "") || undefined,
          taxIds: (Array.isArray(kind === "invoice" ? row.taxesId : row.supplierTaxesId)
            ? (kind === "invoice" ? row.taxesId : row.supplierTaxesId) as unknown[] : []).map(String),
        }))
    return {
      invoice: { journals: journalsFor("invoice"), partners: partnersFor("invoice"), counterpart: accountsFor("invoice", true), commercial: accountsFor("invoice", false), taxes: taxesFor("invoice"), products: productsFor("invoice") },
      bill: { journals: journalsFor("bill"), partners: partnersFor("bill"), counterpart: accountsFor("bill", true), commercial: accountsFor("bill", false), taxes: taxesFor("bill"), products: productsFor("bill") },
    }
  }, [accounts, contacts, defaultCurrencyId, journals, operatingCompanyId, products, taxGroups, taxes])

  const companySelectOptions = useMemo(
    () => companyRowsToSelectOptions(companies as Record<string, unknown>[]),
    [companies],
  )

  const invoicePartnerSelectOptions = useMemo(
    () => contactRowsToAccountingPartnerSelectOptions(contacts),
    [contacts],
  )

  const manualInvoiceAccountOptions = useMemo(() => {
    const eligibleAccounts = accounts.filter(
      (account) =>
        account.companyId === operatingCompanyId &&
        account.deprecated === false &&
        (account.currencyId == null || account.currencyId === manualInvoiceCurrencyId),
    )
    const toOptions = (rows: typeof accounts) =>
      rows.map((account) => ({
        value: String(account.id),
        label: `${account.code ? `${account.code} — ` : ""}${account.name ?? account.id}`,
      }))
    const lineOptions = (expectedType: "Income" | "Expense") =>
      toOptions(
        eligibleAccounts.filter((account) =>
          accountMatchesManualInvoiceLineType(account, accountTypes, expectedType),
        ),
      )
    const counterpartOptions = (expectedType: "Receivable" | "Payable") =>
      toOptions(
        eligibleAccounts.filter(
          (account) => enumTag(account.internalType) === expectedType,
        ),
      )

    return {
      income: lineOptions("Income"),
      expense: lineOptions("Expense"),
      receivable: counterpartOptions("Receivable"),
      payable: counterpartOptions("Payable"),
    }
  }, [accountTypes, accounts, manualInvoiceCurrencyId, operatingCompanyId])

  const manualInvoiceJournalOptions = useMemo(() => {
    const eligible = (journalType: "Sale" | "Purchase") =>
      accountJournalRowsToSelectOptions(
        journals.filter(
          (journal) =>
            journal.companyId === operatingCompanyId &&
            journal.active === true &&
            enumTag(journal.type) === journalType &&
            (journal.currencyId == null || journal.currencyId === manualInvoiceCurrencyId),
        ),
      )
    return { sales: eligible("Sale"), purchases: eligible("Purchase") }
  }, [journals, manualInvoiceCurrencyId, operatingCompanyId])

  const manualInvoiceTaxOptions = useMemo(() => {
    const accountById = new Map(accounts.map((account) => [account.id, account]))
    const groupById = new Map(taxGroups.map((group) => [group.id, group]))
    const eligible = (taxUse: "Sale" | "Purchase") =>
      taxes
        .filter((tax) => {
          const amount = Number(tax.amount)
          if (
            tax.companyId !== operatingCompanyId ||
            tax.active !== true ||
            tax.hasNegativeFactor === true ||
            enumTag(tax.typeTaxUse) !== taxUse ||
            enumTag(tax.amountType) !== "Percent" ||
            !Number.isFinite(amount) ||
            amount < 0 ||
            amount > 100 ||
            tax.taxGroupId == null
          ) {
            return false
          }
          const group = groupById.get(tax.taxGroupId)
          if (group == null || group.companyId !== operatingCompanyId) return false
          const postingAccountId =
            taxUse === "Sale" ? group.taxPayableAccountId : group.taxReceivableAccountId
          if (postingAccountId == null) return false
          const postingAccount = accountById.get(postingAccountId)
          if (
            postingAccount == null ||
            !accountIsEligibleManualInvoiceTaxPosting(
              postingAccount,
              operatingCompanyId,
              manualInvoiceCurrencyId,
            )
          ) {
            return false
          }
          return true
        })
        .map((tax) => ({
          value: String(tax.id),
          label: `${tax.name} (${Number(tax.amount)}%)`,
          rate: Number(tax.amount),
          priceIncluded: Boolean(tax.priceInclude),
        }))
    return { sales: eligible("Sale"), purchases: eligible("Purchase") }
  }, [accounts, manualInvoiceCurrencyId, operatingCompanyId, taxGroups, taxes])

  const accountingSetup = useMemo<AccountingSetupReadinessInput>(() => {
    const company = companies.find(
      (candidate) => String(candidate.id) === String(operatingCompanyId),
    )
    const companyFiscalYears = fiscalYearsRaw.filter((fiscalYear) => {
      return String(fiscalYear.companyId) === String(operatingCompanyId)
    })
    const companyPeriods = accountPeriodsRaw.filter((period) => {
      return String(period.companyId) === String(operatingCompanyId)
    })
    const activeCompanyTaxes = taxes.filter(
      (tax) => tax.companyId === operatingCompanyId && tax.active === true,
    )
    const usableTaxCount =
      manualInvoiceTaxOptions.sales.length + manualInvoiceTaxOptions.purchases.length

    return {
      companyConfigured: company != null,
      baseCurrencyConfigured:
        currencyCatalogContainsId(currencies, manualInvoiceCurrencyId),
      fiscalYearConfigured: companyFiscalYears.length > 0,
      openPeriodAvailable: companyPeriods.some(
        (period) => accountPeriodStateTag(copyAsRecord(period)) === "Open",
      ),
      salesJournalConfigured: manualInvoiceJournalOptions.sales.length > 0,
      purchaseJournalConfigured: manualInvoiceJournalOptions.purchases.length > 0,
      receivableAccountConfigured: manualInvoiceAccountOptions.receivable.length > 0,
      payableAccountConfigured: manualInvoiceAccountOptions.payable.length > 0,
      incomeAccountConfigured: manualInvoiceAccountOptions.income.length > 0,
      expenseAccountConfigured: manualInvoiceAccountOptions.expense.length > 0,
      taxConfiguration:
        activeCompanyTaxes.length === 0
          ? "missing"
          : usableTaxCount < activeCompanyTaxes.length
            ? "needs-review"
            : "ready",
    }
  }, [
    accountPeriodsRaw,
    companies,
    currencies,
    fiscalYearsRaw,
    manualInvoiceAccountOptions,
    manualInvoiceCurrencyId,
    manualInvoiceJournalOptions,
    manualInvoiceTaxOptions,
    operatingCompanyId,
    taxes,
  ])

  const readinessByAction = useMemo(
    () => ({
      invoice: evaluateAccountingSetupReadiness(accountingSetup, "invoice"),
      bill: evaluateAccountingSetupReadiness(accountingSetup, "bill"),
      import: evaluateAccountingSetupReadiness(accountingSetup, "import"),
    }),
    [accountingSetup],
  )

  const accountingSetupDataState = mergeModuleStates([
    accountsRead.state,
    taxesRead.state,
    taxGroupsRead.state,
    companiesRead.state,
    currenciesRead.state,
    journalsRead.state,
    accountTypesRead.state,
    fiscalYearsRawRead.state,
    accountPeriodsRawRead.state,
  ])

  const runAccountingAction = useCallback(
    (action: AccountingReadinessAction, onReady: () => void) => {
      const readiness = readinessByAction[action]
      setReadinessAction(readiness.isReady ? undefined : action)
      if (readiness.isReady) {
        onReady()
        return
      }
      const first = readiness.blockingItems[0]
      toast({
        variant: "destructive",
        title: `${first?.label ?? "Accounting setup"} is required`,
        description:
          first?.reason ?? "Complete the accounting setup requirements shown above first.",
      })
    },
    [readinessByAction, toast],
  )

  const requestAccountingAction = useCallback(
    (action: AccountingReadinessAction, onReady: () => void) => {
      setReadinessAction(action)
      if (accountingSetupDataState.status === "loading") {
        setPendingAccountingAction({ action, onReady })
        return
      }
      setPendingAccountingAction(null)
      runAccountingAction(action, onReady)
    },
    [accountingSetupDataState.status, runAccountingAction],
  )

  useEffect(() => {
    if (accountingSetupDataState.status === "loading" || pendingAccountingAction == null) return
    setPendingAccountingAction(null)
    runAccountingAction(pendingAccountingAction.action, pendingAccountingAction.onReady)
  }, [accountingSetupDataState.status, pendingAccountingAction, runAccountingAction])

  const openInvoiceCreate = useCallback(
    () => requestAccountingAction("invoice", () => setShowCreateInvoice(true)),
    [requestAccountingAction],
  )
  const openBillCreate = useCallback(
    () => requestAccountingAction("bill", () => setShowCreateBill(true)),
    [requestAccountingAction],
  )
  const openAccountingMoveImport = useCallback(
    () => requestAccountingAction("import", () => setCsvKind("accountMove")),
    [requestAccountingAction],
  )
  const openAccountingMoveLineImport = useCallback(
    () => requestAccountingAction("import", () => setCsvKind("accountMoveLine")),
    [requestAccountingAction],
  )
  const openOutstandingDocumentImport = useCallback(
    () => requestAccountingAction("import", () => setCsvKind("outstandingDocuments")),
    [requestAccountingAction],
  )
  const openHistoricalDocumentPaymentReplayImport = useCallback(
    () => requestAccountingAction("import", () => setCsvKind("historicalDocumentsForPaymentReplay")),
    [requestAccountingAction],
  )

  const handleReadinessResolve = useCallback(
    (item: AccountingReadinessItem) => {
      if (item.id === "company") {
        window.location.assign("/settings?section=finance-setup")
        return
      }
      if (item.id === "base-currency") {
        toast({
          title: "Base currency needs administrator repair",
          description:
            "This operating company has no valid base currency. Keep this company selected and repair its company record before posting or importing accounting history.",
          variant: "destructive",
        })
        return
      }
      if (item.id === "fiscal-year") setAccountingActiveTab("fiscal-years")
      else if (item.id === "open-period") setAccountingActiveTab("account-periods")
      else if (item.id === "sales-journal" || item.id === "purchase-journal") {
        setAccountingActiveTab("account-journals")
      } else if (item.id.endsWith("-account")) setAccountingActiveTab("accounts")
      else setAccountingActiveTab("taxes")
    },
    [setAccountingActiveTab, toast],
  )

  const partnerSelectOptions = useMemo(() => {
    if (invoicePartnerSelectOptions.length > 0) return invoicePartnerSelectOptions
    return [{ value: "", label: t("common.lookup.noPartners"), disabled: true }]
  }, [invoicePartnerSelectOptions, t])

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

  // Bills have no direct "pay" mutation: open the payment form pre-filled for the
  // supplier; the payment is then linked to the bill via the existing register flow.
  const openBillPayment = useCallback(
    (bill: { partnerId?: unknown; amountResidual?: number | null; name?: string | null }) =>
      setQuickActionForm({
        form: mergeFieldDefaultValues(accountPaymentFormConfig, {
          paymentType: "OutBound",
          partnerType: "Supplier",
          ...(bill.partnerId != null ? { partnerId: String(bill.partnerId) } : {}),
          ...(bill.amountResidual ? { amount: String(bill.amountResidual) } : {}),
          ...(bill.name ? { ref: String(bill.name) } : {}),
        }),
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
      wide: true,
      overviewContent: (record) => <FinanceReviewWorkspace
        editorLabel={t("financeReview.savedDetails", { defaultValue: "Saved details" })}
        editor={<EntityDetail config={accountMoveRecordSheet.detailConfig} data={record} />}
        preview={<BillSourcePreview organizationId={BigInt(organizationId)} companyId={BigInt(operatingCompanyId ?? 0)} recordId={String(record.id)} />}
      />,
      customTabs: [
        ...(accountMoveRecordSheet.customTabs ?? []),
        {
          id: "actions",
          label: t("accounting.invoices.recordSheet.actionsTab"),
          content: (record) => (
            <Button
              type="button"
              variant="outline"
              data-testid="accounting-invoice-record-actions"
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
    [accountMoveRecordSheet, t, organizationId, operatingCompanyId],
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

  const currentSelectedFixedAsset = useMemo(() => {
    if (!selectedFixedAsset?.id) return null
    const matches = fixedAssets.filter((asset) => String(asset.id) === String(selectedFixedAsset.id)
      && asset.organizationId === orgId && asset.companyId === operatingCompanyId)
    return matches.length === 1 ? matches[0]! : null
  }, [selectedFixedAsset?.id, fixedAssets, orgId, operatingCompanyId])

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
  const createManualInvoice = useCreateManualAccountInvoice(organizationId)
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
  const postMove = usePostAccountMove(organizationId, operatingCompanyId)
  const createCreditNote = useCreateCreditNoteFromInvoice(organizationId)
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
  const reconcileBankLine = useReconcileAccountBankStatementLine(organizationId, operatingCompanyId)
  const recoverBankSettlement = useRecoverBankStatementSettlement(organizationId, operatingCompanyId)
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
  const csvImports = useAccountingCsvImportMutations(organizationId, operatingCompanyId)
  const trackedBundleImport = useTrackedCsvImport()
  const cleanupAbandonedImport = useCleanupAbandonedAccountMoveImport(
    orgId,
    operatingCompanyId,
  )
  const applyHistoricalPaymentAllocations =
    useApplyHistoricalPaymentAllocations(organizationId)

  const createAccountPayment = useCreateAccountPayment(organizationId)
  const cancelAccountPayment = useCancelAccountPayment(organizationId)
  const workflowSurface = useWorkflowSurface({ organizationId })
  const resolvePostingAccounts = useCallback(() => {
    const resolved = resolveDefaultCogsInventoryAccountIds(accounts as readonly Record<string, unknown>[])
    return resolved
      ? {
          cogsAccountId: BigInt(resolved.cogsAccountId),
          inventoryAccountId: BigInt(resolved.inventoryAccountId),
        }
      : undefined
  }, [accounts])
  const invoiceToPayment = useInvoiceToPaymentWorkflow(
    orgId,
    {
      labels: {
        postInvoice: t("accounting.invoices.invoiceActions.postDraft"),
        postPayment: t("accounting.entities.payments.actions.postSelected"),
      },
      resolvePostingAccounts,
      missingAccountsMessage: t("accounting.invoices.postMissingCogsAccounts"),
    },
    {
      navigate: workflowSurface.navigate,
    record: workflowSurface.record,
      notify: (notice) => {
        // The register/reconcile dialogs render their own failure inline.
        if (notice.kind === "error" && notice.transitionId.startsWith("accounting.payment.re")) return
        workflowSurface.notify(notice)
      },
    },
  )
  const createPaymentTerm = useCreatePaymentTerm(organizationId)
  const updatePaymentTerm = useUpdatePaymentTerm(organizationId)
  const deletePaymentTerm = useDeletePaymentTerm(organizationId)
  const createPaymentTermLine = useCreatePaymentTermLine(organizationId)
  const updatePaymentTermLine = useUpdatePaymentTermLine(organizationId)
  const deletePaymentTermLine = useDeletePaymentTermLine(organizationId)
  const createCurrencyRate = useCreateCurrencyRate(organizationId, operatingCompanyId)
  const runFxRevaluation = useRunFxRevaluation(organizationId, operatingCompanyId)
  const runFxRevaluationBatch = useRunFxRevaluationBatch(organizationId, operatingCompanyId)
  const postRealizedFxGainLoss = usePostRealizedFxGainLoss(organizationId, operatingCompanyId)
  const upsertPartnerCreditControl = useUpsertPartnerCreditControl(organizationId, operatingCompanyId)
  const createBadDebtWriteOff = useCreateBadDebtWriteOff(organizationId, operatingCompanyId)
  const createAmortizationSchedule = useCreateAmortizationSchedule(organizationId, operatingCompanyId)
  const recognizeAmortizationLine = useRecognizeAmortizationLine(organizationId, operatingCompanyId)
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
  const statementLinesPager = usePagedRows(detailStatementLines)

  const statementBalancesMatch = useMemo(() => {
    if (!currentBankStatement) return false
    const end = currentBankStatement.balanceEnd
    const real = currentBankStatement.balanceEndReal
    return typeof end === "number" && typeof real === "number" && Number.isFinite(end) && Number.isFinite(real) && Math.abs(end - real) <= 0.01
  }, [currentBankStatement])

  const newBankStatementLineFormConfig = useMemo(() => {
    const base = !bankStatementDetail?.id
      ? newBankStatementLineForm(t, { statementId: "", defaultCurrencyId: defaultCurrencyId.toString() })
      : newBankStatementLineForm(t, {
          statementId: String(bankStatementDetail.id),
          defaultCurrencyId:
            bankStatementDetail.currencyId != null
              ? String(bankStatementDetail.currencyId)
              : defaultCurrencyId.toString(),
        })
    return mergeSelectOptionsForFields(base, {
      partnerId: optionalPartnerSelectOptions,
    })
  }, [bankStatementDetail, defaultCurrencyId, t, optionalPartnerSelectOptions])

  const reconciliationSelectionContext = useMemo(() => ({
    organizationId: String(orgId),
    companyId: String(operatingCompanyId),
    accounts,
    partners: contacts,
    lines: accountMoveLines,
    ready: canUseModuleData(accountsRead.state) && canUseModuleData(contactsRead.state) && canUseModuleData(accountMoveLinesRead.state),
  }), [orgId, operatingCompanyId, accounts, contacts, accountMoveLines, accountsRead.state, contactsRead.state, accountMoveLinesRead.state])

  const reconciliationAccountOptions = useMemo(() => {
    const choices = reconciliationAccountChoices(accounts, reconciliationSelectionContext)
    return choices.length > 0 ? choices : [{ value: "", label: t("common.noData"), disabled: true }]
  }, [accounts, reconciliationSelectionContext, t])
  const reconciliationPartnerOptions = useMemo(() => [
    { value: "", label: t("accounting.forms.reconciliationWidget.picker.anyPartner", { defaultValue: "Any partner" }) },
    ...reconciliationPartnerChoices(contacts, reconciliationSelectionContext),
  ], [contacts, reconciliationSelectionContext, t])

  const reconciliationSelectionMessage = useCallback((issue: ReconciliationSelectionIssue) => {
    switch (issue) {
      case "loading": return t("accounting.forms.reconciliationWidget.picker.loading", { defaultValue: "Journal item choices are unavailable until the company data is loaded." })
      case "account": return t("accounting.forms.reconciliationWidget.picker.invalidAccount", { defaultValue: "Choose an available account from the current company." })
      case "partner": return t("accounting.forms.reconciliationWidget.picker.invalidPartner", { defaultValue: "Choose an available partner from the current company, or choose Any partner." })
      case "lines": return t("accounting.forms.reconciliationWidget.picker.invalidLines", { defaultValue: "Choose at least one available journal item." })
      case "staleLines": return t("accounting.forms.reconciliationWidget.picker.staleLines", { defaultValue: "Some selected journal items no longer match the account, partner, or current company. Remove them or restore the matching selection before saving." })
      case "mode": return t("accounting.forms.reconciliationWidget.picker.invalidMode", { defaultValue: "Choose a listed reconciliation mode." })
    }
  }, [t])

  const reconciliationWidgetCreateFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newReconciliationWidgetForm(t), {
        accountId: reconciliationAccountOptions,
        partnerId: reconciliationPartnerOptions,
      }),
    [t, reconciliationAccountOptions, reconciliationPartnerOptions],
  )

  const reconciliationWidgetEditFormConfig = useMemo(() => {
    const empty: Parameters<typeof editReconciliationWidgetForm>[1] = {
      widgetId: "",
      accountId: "",
      partnerId: "",
      mode: "bank",
      moveLineIds: [],
      toCheck: false,
    }
    if (!reconciliationWidgetEdit) {
      return mergeSelectOptionsForFields(editReconciliationWidgetForm(t, empty), {
        accountId: reconciliationAccountOptions,
        partnerId: reconciliationPartnerOptions,
      })
    }
    const ml = reconciliationWidgetEdit.moveLineIds
    const moveLineIds = Array.isArray(ml) ? ml.map((x) => String(x)) : []
    const accountId = String(reconciliationWidgetEdit.accountId ?? "")
    const partnerId = String(reconciliationWidgetEdit.partnerId ?? "")
    const retainUnavailable = (options: Array<{ value: string; label: string; disabled?: boolean }>, selected: string) =>
      selected && !options.some((option) => option.value === selected)
        ? [...options, { value: selected, label: t("accounting.forms.reconciliationWidget.picker.unavailableRecord", { defaultValue: "Unavailable record #{{id}}", id: selected }), disabled: true }]
        : options
    return mergeSelectOptionsForFields(
      editReconciliationWidgetForm(t, {
        widgetId: String(reconciliationWidgetEdit.id ?? ""),
        accountId,
        partnerId,
        mode: String(reconciliationWidgetEdit.mode ?? "bank"),
        moveLineIds,
        toCheck: Boolean(reconciliationWidgetEdit.toCheck),
      }),
      {
        accountId: retainUnavailable(reconciliationAccountOptions, accountId),
        partnerId: retainUnavailable(reconciliationPartnerOptions, partnerId),
      },
    )
  }, [reconciliationWidgetEdit, t, reconciliationAccountOptions, reconciliationPartnerOptions])

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
    async (formData: FormValues) => {
      const wid = formData.widgetId
      if (wid === "" || wid == null) return
      const matches = reconciliationWidgets.filter((widget) => String(widget.id) === String(wid)
        && String(widget.organizationId) === String(orgId) && String(widget.companyId) === String(operatingCompanyId))
      if (!canUseModuleData(reconciliationWidgetsRead.state) || matches.length !== 1) {
        throw new Error(t("accounting.forms.reconciliationWidget.picker.staleWidget", { defaultValue: "This reconciliation widget is no longer available in the current company. Close the form and refresh the list." }))
      }
      const issue = reconciliationSelectionIssue(formData, { ...reconciliationSelectionContext, existingMode: String(matches[0].mode ?? "bank"), allowEmpty: true })
      if (issue) throw new Error(reconciliationSelectionMessage(issue))
      const params = toUpdateAccountReconciliationWidgetParams(formData)
      if (!params) return
      await updateReconciliationWidget.mutateAsync({
        widgetId: BigInt(String(wid)),
        params,
      })
      setReconciliationWidgetEdit(null)
    },
    [updateReconciliationWidget, reconciliationWidgets, reconciliationWidgetsRead.state, orgId, operatingCompanyId, reconciliationSelectionContext, reconciliationSelectionMessage, t],
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
            selection: "multiple",
            isApplicable: (rows) => rows.some((row) => fiscalYearStateTag(row as Record<string, unknown>) === "Draft"),
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.fiscalYears.actions.openSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                if (fiscalYearStateTag(r as Record<string, unknown>) === "Draft") {
                  await openFiscalYear.mutateAsync(BigInt(String(r.id)))
                }
              }
            },
          },
          {
            id: "fy-close",
            label: t("accounting.entities.fiscalYears.actions.closeSelected"),
            requiresSelection: true,
            selection: "multiple",
            isApplicable: (rows) => rows.some((row) => fiscalYearStateTag(row as Record<string, unknown>) === "Running"),
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.fiscalYears.actions.closeSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                if (fiscalYearStateTag(r as Record<string, unknown>) === "Running") {
                  await closeFiscalYear.mutateAsync(BigInt(String(r.id)))
                }
              }
            },
          },
          {
            id: "fy-delete",
            label: t("accounting.entities.fiscalYears.actions.deleteSelected"),
            requiresSelection: true,
            selection: "multiple",
            variant: "destructive",
            isApplicable: (rows) => rows.some((row) => fiscalYearStateTag(row as Record<string, unknown>) === "Draft"),
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.fiscalYears.actions.deleteSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                if (fiscalYearStateTag(r as Record<string, unknown>) === "Draft") {
                  await deleteFiscalYear.mutateAsync(BigInt(String(r.id)))
                }
              }
            },
          },
        ],
      },
    }
  }, [t, openFiscalYear, closeFiscalYear, deleteFiscalYear])

  // ── Tax deadline + tax rate row actions ─────────────────────────────────────
  /** Run a form-driven command; the reducer re-validates, so failures surface as an error toast. */
  const runTaxCommand = useCallback(
    async (title: string, work: () => Promise<unknown>): Promise<void> => {
      try {
        await work()
        showWorkflowToast({
          kind: "success",
          title: t("accounting.taxDeadlines.actions.done", { defaultValue: "{{action}} completed", action: title }),
        })
      } catch (error) {
        showWorkflowToast({
          kind: "error",
          title: t("accounting.taxDeadlines.actions.failed", { defaultValue: "{{action}} failed", action: title }),
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [t],
  )

  const taxDeadlinesEntityConfig = useMemo((): EntityViewConfig => {
    const base = taxDeadlinesTableConfig(t)
    const view = base.view as EntityTableConfig
    const newLabel = t("accounting.taxDeadlines.actions.new", { defaultValue: "New deadline" })
    const editLabel = t("accounting.taxDeadlines.actions.edit", { defaultValue: "Edit deadline" })
    const completeLabel = t("accounting.taxDeadlines.actions.complete", { defaultValue: "Mark complete" })
    const waiveLabel = t("accounting.taxDeadlines.actions.waive", { defaultValue: "Waive" })
    const deleteLabel = t("accounting.taxDeadlines.actions.delete", { defaultValue: "Delete deadline" })
    const invalidInput = (title: string) =>
      showWorkflowToast({
        kind: "error",
        title: t("accounting.taxDeadlines.actions.failed", { defaultValue: "{{action}} failed", action: title }),
        description: t("accounting.taxDeadlines.actions.invalid", {
          defaultValue: "Enter a title and a due date.",
        }),
      })
    const idOf = (row: Record<string, unknown>) => BigInt(String(row.id))
    const cancelLabel = t("common.cancel", { defaultValue: "Cancel" })

    const promptNew = async () => {
      const values = await askForm({
        title: newLabel,
        fields: [
          { id: "title", name: "title", label: t("accounting.taxDeadlines.columns.title", { defaultValue: "Deadline" }), type: "text", required: true },
          {
            id: "deadlineType",
            name: "deadlineType",
            label: t("accounting.taxDeadlines.form.type", { defaultValue: "Type" }),
            type: "select",
            required: true,
            defaultValue: "Filing",
            width: "1/2",
            options: ["Filing", "Payment", "Registration", "Report", "Renewal"].map((value) => ({
              value,
              label: t(`accounting.taxDeadlines.form.types.${value}`, { defaultValue: value }),
            })),
          },
          { id: "dueDate", name: "dueDate", label: t("accounting.taxDeadlines.columns.dueDate", { defaultValue: "Due date" }), type: "date", required: true, width: "1/2" },
          {
            id: "companyId",
            name: "companyId",
            label: t("accounting.taxDeadlines.form.company", { defaultValue: "Company (optional)" }),
            type: "select",
            options: companySelectOptions,
          },
          { id: "description", name: "description", label: t("accounting.taxDeadlines.columns.description", { defaultValue: "Description" }), type: "textarea" },
        ],
      })
      if (values == null) return
      const body = toTaxDeadlineCreateBody(values)
      if (body == null) return invalidInput(newLabel)
      await runTaxCommand(newLabel, () => createTaxDeadline.mutateAsync(body))
    }

    const promptEdit = async (row: Record<string, unknown>) => {
      const values = await askForm({
        title: editLabel,
        fields: [
          { id: "title", name: "title", label: t("accounting.taxDeadlines.columns.title", { defaultValue: "Deadline" }), type: "text", required: true, defaultValue: String(row.title ?? "") },
          { id: "dueDate", name: "dueDate", label: t("accounting.taxDeadlines.columns.dueDate", { defaultValue: "Due date" }), type: "date", defaultValue: deadlineDateInput(row.dueDate) },
          { id: "description", name: "description", label: t("accounting.taxDeadlines.columns.description", { defaultValue: "Description" }), type: "textarea", defaultValue: String(row.description ?? "") },
        ],
      })
      if (values == null) return
      const body = toTaxDeadlineUpdateBody(values)
      if (body == null) return invalidInput(editLabel)
      await runTaxCommand(editLabel, () => updateTaxDeadline.mutateAsync({ deadlineId: idOf(row), params: body }))
    }

    const actions: EntityAction[] = [
      {
        id: "tax-deadline-new",
        label: newLabel,
        permission: { resource: "tax_deadline", action: "create" },
        onClick: () => promptNew(),
      },
      {
        id: "tax-deadline-complete",
        label: completeLabel,
        requiresSelection: true,
        permission: { resource: "tax_deadline", action: "write" },
        isApplicable: (rows) => rows.every((r) => canCompleteTaxDeadline(r)),
        successMessage: t("accounting.taxDeadlines.actions.done", { defaultValue: "{{action}} completed", action: completeLabel }),
        onClick: (rows) => completeTaxDeadline.mutateAsync(idOf(rows[0]!)),
      },
      {
        id: "tax-deadline-edit",
        label: editLabel,
        requiresSelection: true,
        permission: { resource: "tax_deadline", action: "write" },
        isApplicable: (rows) => rows.every((r) => canEditTaxDeadline(r)),
        onClick: (rows) => promptEdit(rows[0]!),
      },
      {
        id: "tax-deadline-waive",
        label: waiveLabel,
        requiresSelection: true,
        permission: { resource: "tax_deadline", action: "admin" },
        isApplicable: (rows) => rows.every((r) => canWaiveTaxDeadline(r)),
        confirm: {
          title: waiveLabel,
          description: t("accounting.taxDeadlines.actions.waiveConfirm", {
            defaultValue: "Mark this deadline as not applicable. It stops counting as open.",
          }),
          confirmLabel: waiveLabel,
          cancelLabel,
        },
        successMessage: t("accounting.taxDeadlines.actions.done", { defaultValue: "{{action}} completed", action: waiveLabel }),
        onClick: (rows) => waiveTaxDeadline.mutateAsync(idOf(rows[0]!)),
      },
      {
        id: "tax-deadline-delete",
        label: deleteLabel,
        variant: "destructive",
        requiresSelection: true,
        permission: { resource: "tax_deadline", action: "delete" },
        isApplicable: (rows) => rows.every((r) => canDeleteTaxDeadline(r)),
        confirm: {
          title: deleteLabel,
          description: t("accounting.taxDeadlines.actions.deleteConfirm", {
            defaultValue: "Delete this tax deadline? It disappears from the list.",
          }),
          confirmLabel: t("common.delete", { defaultValue: "Delete" }),
          cancelLabel,
        },
        successMessage: t("accounting.taxDeadlines.actions.done", { defaultValue: "{{action}} completed", action: deleteLabel }),
        onClick: (rows) => deleteTaxDeadline.mutateAsync(idOf(rows[0]!)),
      },
    ]
    return { ...base, view: { ...view, actions: [...(view.actions ?? []), ...actions] } } as EntityViewConfig
  }, [
    t,
    askForm,
    companySelectOptions,
    runTaxCommand,
    createTaxDeadline.mutateAsync,
    updateTaxDeadline.mutateAsync,
    completeTaxDeadline.mutateAsync,
    waiveTaxDeadline.mutateAsync,
    deleteTaxDeadline.mutateAsync,
  ])

  const taxGroupRows = useMemo(() => {
    const accountLabel = new Map<string, string>()
    for (const a of copyAsRecords(accounts)) {
      const id = cellId(a.id)
      if (id != null) accountLabel.set(id.toString(), `${cellText(a.code)} ${cellText(a.name)}`.trim())
    }
    const companyLabel = new Map(companySelectOptions.map((o) => [String(o.value), o.label] as const))
    const labelOf = (map: Map<string, string>, v: unknown) => {
      const id = cellId(v)
      return id == null ? "" : (map.get(id.toString()) ?? id.toString())
    }
    return copyAsRecords(taxGroups).map((g) => ({
      ...g,
      sequence: Number(cellText(g.sequence)) || 0,
      companyName: labelOf(companyLabel, g.companyId),
      precedingSubtotalText: cellText(g.precedingSubtotal),
      payableAccountName: labelOf(accountLabel, g.taxPayableAccountId),
      receivableAccountName: labelOf(accountLabel, g.taxReceivableAccountId),
      advanceAccountName: labelOf(accountLabel, g.advanceTaxPaymentAccountId),
    }))
  }, [taxGroups, accounts, companySelectOptions])

  /** Tax groups table: "New tax group" and "Edit tax group" (the reducers re-validate accounts and company). */
  const taxGroupsEntityConfig = useMemo((): EntityViewConfig => {
    const base = taxGroupsTableConfig(t)
    const view = base.view as EntityTableConfig
    const newLabel = t("accounting.taxGroups.actions.new", { defaultValue: "New tax group" })
    const editLabel = t("accounting.taxGroups.actions.edit", { defaultValue: "Edit tax group" })
    const noneLabel = t("accounting.taxGroups.form.none", { defaultValue: "None" })
    const accountRows = copyAsRecords(accounts)
    const fields = (current: ReturnType<typeof taxGroupEditDefaults> | null): FormField[] => [
      { id: "name", name: "name", label: t("accounting.taxGroups.columns.name", { defaultValue: "Name" }), type: "text", required: true, defaultValue: current?.name ?? "", width: "2/3" },
      { id: "sequence", name: "sequence", label: t("accounting.taxGroups.columns.sequence", { defaultValue: "Sequence" }), type: "number", required: true, min: 0, step: 1, defaultValue: current?.sequence ?? 10, width: "1/3" },
      { id: "precedingSubtotal", name: "precedingSubtotal", label: t("accounting.taxGroups.columns.precedingSubtotal", { defaultValue: "Preceding subtotal" }), type: "text", defaultValue: current?.precedingSubtotal ?? "" },
      { id: "taxPayableAccountId", name: "taxPayableAccountId", label: t("accounting.taxGroups.columns.payableAccount", { defaultValue: "Tax payable account" }), type: "select", defaultValue: current?.taxPayableAccountId ?? "", options: withNone(taxGroupAccountOptions(accountRows, "payable", operatingCompanyId), noneLabel) },
      { id: "taxReceivableAccountId", name: "taxReceivableAccountId", label: t("accounting.taxGroups.columns.receivableAccount", { defaultValue: "Tax receivable account" }), type: "select", defaultValue: current?.taxReceivableAccountId ?? "", options: withNone(taxGroupAccountOptions(accountRows, "receivable", operatingCompanyId), noneLabel) },
      { id: "advanceTaxPaymentAccountId", name: "advanceTaxPaymentAccountId", label: t("accounting.taxGroups.columns.advanceAccount", { defaultValue: "Advance tax payment account" }), type: "select", defaultValue: current?.advanceTaxPaymentAccountId ?? "", options: withNone(taxGroupAccountOptions(accountRows, "advance", operatingCompanyId), noneLabel) },
    ]
    const invalid = (title: string) =>
      showWorkflowToast({
        kind: "error",
        title: t("accounting.taxDeadlines.actions.failed", { defaultValue: "{{action}} failed", action: title }),
        description: t("accounting.taxGroups.actions.invalid", { defaultValue: "Enter a name and a whole-number sequence." }),
      })

    const promptNew = async () => {
      const values = await askForm({ title: newLabel, fields: fields(null) })
      if (values == null) return
      const params = toTaxGroupCreateParams(values)
      if (params == null) return invalid(newLabel)
      await runTaxCommand(newLabel, () => createTaxGroup.mutateAsync(params))
    }
    const promptEdit = async (row: Record<string, unknown>) => {
      const values = await askForm({ title: editLabel, fields: fields(taxGroupEditDefaults(row)) })
      if (values == null) return
      const result = toTaxGroupUpdateParams(values, row)
      if (!result.ok) {
        if (result.reason === "invalid") return invalid(editLabel)
        showWorkflowToast({ kind: "info", title: t("accounting.accounts.edit.unchanged", { defaultValue: "Nothing to change." }) })
        return
      }
      await runTaxCommand(editLabel, () =>
        updateTaxGroup.mutateAsync({ groupId: BigInt(String(row.id)), params: result.params }),
      )
    }

    const actions: EntityAction[] = [
      {
        id: "tax-group-new",
        label: newLabel,
        permission: { resource: "account_tax_group", action: "create" },
        onClick: () => promptNew(),
      },
      {
        id: "tax-group-edit",
        label: editLabel,
        requiresSelection: true,
        permission: { resource: "account_tax_group", action: "write" },
        isApplicable: (rows) => rows.every((r) => canEditTaxGroup(r, operatingCompanyId)),
        onClick: (rows) => promptEdit(rows[0]!),
      },
    ]
    return { ...base, view: { ...view, actions: [...(view.actions ?? []), ...actions] } } as EntityViewConfig
  }, [t, askForm, accounts, operatingCompanyId, runTaxCommand, createTaxGroup.mutateAsync, updateTaxGroup.mutateAsync])

  const taxJurisdictionRows = useMemo(
    () =>
      copyAsRecords(taxJurisdictions).map((j) => {
        const current = taxJurisdictionEditDefaults(j)
        return {
          ...j,
          ...current,
          activeLabel: current.isActive
            ? t("accounting.taxJurisdictions.active", { defaultValue: "Active" })
            : t("accounting.taxJurisdictions.inactive", { defaultValue: "Inactive" }),
        }
      }),
    [taxJurisdictions, t],
  )

  /** Jurisdictions table: "New jurisdiction" and "Edit jurisdiction" (organization-level records). */
  const taxJurisdictionsEntityConfig = useMemo((): EntityViewConfig => {
    const base = taxJurisdictionsTableConfig(t)
    const view = base.view as EntityTableConfig
    const newLabel = t("accounting.taxJurisdictions.actions.new", { defaultValue: "New jurisdiction" })
    const editLabel = t("accounting.taxJurisdictions.actions.edit", { defaultValue: "Edit jurisdiction" })
    const fields = (current: ReturnType<typeof taxJurisdictionEditDefaults> | null): FormField[] => [
      { id: "name", name: "name", label: t("accounting.taxJurisdictions.columns.name", { defaultValue: "Name" }), type: "text", required: true, defaultValue: current?.name ?? "", width: "2/3" },
      { id: "code", name: "code", label: t("accounting.taxJurisdictions.columns.code", { defaultValue: "Code" }), type: "text", required: true, defaultValue: current?.code ?? "", width: "1/3" },
      // The reducer cannot change the country of an existing jurisdiction, so it is only asked for on create.
      ...(current == null
        ? [{ id: "countryCode", name: "countryCode", label: t("accounting.taxJurisdictions.columns.countryCode", { defaultValue: "Country code" }), description: t("accounting.taxJurisdictions.form.countryHint", { defaultValue: "ISO country code, for example US." }), type: "text" as const, required: true, defaultValue: "", width: "1/3" as const }]
        : []),
      { id: "stateCode", name: "stateCode", label: t("accounting.taxJurisdictions.columns.stateCode", { defaultValue: "State" }), type: "text", defaultValue: current?.stateCode ?? "", width: "1/3" },
      { id: "countyCode", name: "countyCode", label: t("accounting.taxJurisdictions.columns.countyCode", { defaultValue: "County" }), type: "text", defaultValue: current?.countyCode ?? "", width: "1/3" },
      { id: "city", name: "city", label: t("accounting.taxJurisdictions.columns.city", { defaultValue: "City" }), type: "text", defaultValue: current?.city ?? "", width: "1/3" },
      { id: "zipFrom", name: "zipFrom", label: t("accounting.taxJurisdictions.columns.zipFrom", { defaultValue: "Postal code from" }), type: "text", defaultValue: current?.zipFrom ?? "", width: "1/3" },
      { id: "zipTo", name: "zipTo", label: t("accounting.taxJurisdictions.columns.zipTo", { defaultValue: "Postal code to" }), type: "text", defaultValue: current?.zipTo ?? "", width: "1/3" },
      { id: "isActive", name: "isActive", label: t("accounting.taxJurisdictions.active", { defaultValue: "Active" }), type: "switch", defaultValue: current?.isActive ?? true, width: "1/3" },
    ]
    const invalid = (title: string) =>
      showWorkflowToast({
        kind: "error",
        title: t("accounting.taxDeadlines.actions.failed", { defaultValue: "{{action}} failed", action: title }),
        description: t("accounting.taxJurisdictions.actions.invalid", { defaultValue: "Enter a name, a code and a country code." }),
      })

    const promptNew = async () => {
      const values = await askForm({ title: newLabel, fields: fields(null) })
      if (values == null) return
      const params = toTaxJurisdictionCreateParams(values)
      if (params == null) return invalid(newLabel)
      await runTaxCommand(newLabel, () => createTaxJurisdiction.mutateAsync(params))
    }
    const promptEdit = async (row: Record<string, unknown>) => {
      const values = await askForm({ title: editLabel, fields: fields(taxJurisdictionEditDefaults(row)) })
      if (values == null) return
      const result = toTaxJurisdictionUpdateParams(values, row)
      if (!result.ok) {
        if (result.reason === "invalid") return invalid(editLabel)
        showWorkflowToast({ kind: "info", title: t("accounting.accounts.edit.unchanged", { defaultValue: "Nothing to change." }) })
        return
      }
      await runTaxCommand(editLabel, () =>
        updateTaxJurisdiction.mutateAsync({ jurisdictionId: BigInt(String(row.id)), params: result.params }),
      )
    }

    const actions: EntityAction[] = [
      {
        id: "tax-jurisdiction-new",
        label: newLabel,
        permission: { resource: "tax_jurisdiction", action: "create" },
        onClick: () => promptNew(),
      },
      {
        id: "tax-jurisdiction-edit",
        label: editLabel,
        requiresSelection: true,
        permission: { resource: "tax_jurisdiction", action: "write" },
        onClick: (rows) => promptEdit(rows[0]!),
      },
    ]
    return { ...base, view: { ...view, actions: [...(view.actions ?? []), ...actions] } } as EntityViewConfig
  }, [t, askForm, runTaxCommand, createTaxJurisdiction.mutateAsync, updateTaxJurisdiction.mutateAsync])

  const taxScheduleRows = useMemo(() => {
    const companyLabel = new Map(companySelectOptions.map((o) => [String(o.value), o.label] as const))
    const jurisdictionLabel = new Map(
      copyAsRecords(taxJurisdictions).map((j) => [cellId(j.id)?.toString() ?? "", cellText(j.name)] as const),
    )
    const taxLabel = new Map(
      copyAsRecords(taxes).map((x) => [cellId(x.id)?.toString() ?? "", cellText(x.name)] as const),
    )
    return copyAsRecords(taxSchedules).map((s) => {
      const current = taxScheduleEditDefaults(s)
      const companyKey = cellId(s.companyId)?.toString() ?? ""
      return {
        ...s,
        description: current.description,
        companyName: companyLabel.get(companyKey) ?? companyKey,
        jurisdictionName: jurisdictionLabel.get(current.jurisdictionId) ?? "",
        taxNames: current.taxIds.map((id) => taxLabel.get(id) ?? id).join(", "),
        effectiveFromDate: current.effectiveFrom,
        effectiveToDate: current.effectiveTo,
        activeLabel: current.isActive
          ? t("accounting.taxSchedules.active", { defaultValue: "Active" })
          : t("accounting.taxSchedules.inactive", { defaultValue: "Inactive" }),
      }
    })
  }, [taxSchedules, taxJurisdictions, taxes, companySelectOptions, t])

  /** Tax schedules table: "New schedule" and "Edit schedule" (taxes are picked from the company's active taxes). */
  const taxSchedulesEntityConfig = useMemo((): EntityViewConfig => {
    const base = taxSchedulesTableConfig(t)
    const view = base.view as EntityTableConfig
    const newLabel = t("accounting.taxSchedules.actions.new", { defaultValue: "New schedule" })
    const editLabel = t("accounting.taxSchedules.actions.edit", { defaultValue: "Edit schedule" })
    const noneLabel = t("accounting.taxSchedules.form.none", { defaultValue: "None" })
    const inactiveSuffix = t("accounting.taxSchedules.form.inactive", { defaultValue: "(inactive)" })
    const taxRows = copyAsRecords(taxes)
    const jurisdictionRows = copyAsRecords(taxJurisdictions)
    const fields = (current: ReturnType<typeof taxScheduleEditDefaults> | null): FormField[] => [
      { id: "name", name: "name", label: t("accounting.taxSchedules.columns.name", { defaultValue: "Name" }), type: "text", required: true, defaultValue: current?.name ?? "" },
      { id: "description", name: "description", label: t("accounting.taxSchedules.columns.description", { defaultValue: "Description" }), type: "textarea", defaultValue: current?.description ?? "" },
      { id: "jurisdictionId", name: "jurisdictionId", label: t("accounting.taxSchedules.columns.jurisdiction", { defaultValue: "Jurisdiction" }), type: "select", defaultValue: current?.jurisdictionId ?? "", options: withNone(scheduleJurisdictionOptions(jurisdictionRows, current?.jurisdictionId ?? "", inactiveSuffix), noneLabel) },
      taxPickerField({
        id: "taxIds",
        name: "taxIds",
        label: t("accounting.taxSchedules.columns.taxes", { defaultValue: "Taxes" }),
        options: scheduleTaxOptions(taxRows, operatingCompanyId, current?.taxIds ?? [], inactiveSuffix),
        defaultValue: current?.taxIds ?? [],
        emptyHint: t("accounting.taxSchedules.form.noActiveTaxes", { defaultValue: "There are no active taxes to choose from." }),
      }),
      { id: "effectiveFrom", name: "effectiveFrom", label: t("accounting.taxSchedules.columns.effectiveFrom", { defaultValue: "Effective from" }), type: "date", defaultValue: current?.effectiveFrom ?? "", width: "1/2" },
      { id: "effectiveTo", name: "effectiveTo", label: t("accounting.taxSchedules.columns.effectiveTo", { defaultValue: "Effective to" }), type: "date", defaultValue: current?.effectiveTo ?? "", width: "1/2" },
      { id: "isActive", name: "isActive", label: t("accounting.taxSchedules.active", { defaultValue: "Active" }), type: "switch", defaultValue: current?.isActive ?? true },
    ]
    const invalid = (title: string) =>
      showWorkflowToast({
        kind: "error",
        title: t("accounting.taxDeadlines.actions.failed", { defaultValue: "{{action}} failed", action: title }),
        description: t("accounting.taxSchedules.actions.invalid", { defaultValue: "Enter a name and valid effective dates." }),
      })

    const promptNew = async () => {
      const values = await askForm({ title: newLabel, fields: fields(null) })
      if (values == null) return
      const params = toTaxScheduleCreateParams(values)
      if (params == null) return invalid(newLabel)
      await runTaxCommand(newLabel, () => createTaxSchedule.mutateAsync(params))
    }
    const promptEdit = async (row: Record<string, unknown>) => {
      const values = await askForm({ title: editLabel, fields: fields(taxScheduleEditDefaults(row)) })
      if (values == null) return
      const result = toTaxScheduleUpdateParams(values, row)
      if (!result.ok) {
        if (result.reason === "invalid") return invalid(editLabel)
        showWorkflowToast({ kind: "info", title: t("accounting.accounts.edit.unchanged", { defaultValue: "Nothing to change." }) })
        return
      }
      await runTaxCommand(editLabel, () =>
        updateTaxSchedule.mutateAsync({ scheduleId: BigInt(String(row.id)), params: result.params }),
      )
    }

    const actions: EntityAction[] = [
      {
        id: "tax-schedule-new",
        label: newLabel,
        permission: { resource: "tax_schedule", action: "create" },
        onClick: () => promptNew(),
      },
      {
        id: "tax-schedule-edit",
        label: editLabel,
        requiresSelection: true,
        permission: { resource: "tax_schedule", action: "write" },
        isApplicable: (rows) => rows.every((r) => canEditTaxSchedule(r, operatingCompanyId)),
        onClick: (rows) => promptEdit(rows[0]!),
      },
    ]
    return { ...base, view: { ...view, actions: [...(view.actions ?? []), ...actions] } } as EntityViewConfig
  }, [t, askForm, taxes, taxJurisdictions, operatingCompanyId, runTaxCommand, createTaxSchedule.mutateAsync, updateTaxSchedule.mutateAsync])

  const editTaxAction = useMemo((): EntityAction => {
    const label = t("accounting.taxes.actions.edit", { defaultValue: "Edit tax" })
    return {
      id: "tax-edit",
      label,
      requiresSelection: true,
      permission: { resource: "account_tax", action: "write" },
      onClick: async (rows) => {
        const row = rows[0]
        if (!row) return
        const values = await askForm({
          title: label,
          fields: [
            { id: "name", name: "name", label: t("accounting.forms.newTax.fields.name"), type: "text", required: true, defaultValue: String(row.name ?? "") },
            { id: "amount", name: "amount", label: t("accounting.forms.newTax.fields.amount"), type: "number", required: true, min: 0, max: 100, defaultValue: Number(row.amount ?? 0), width: "1/2" },
            {
              id: "typeTaxUse",
              name: "typeTaxUse",
              label: t("accounting.forms.newTax.fields.taxType"),
              type: "select",
              required: true,
              defaultValue: variantTag(row.typeTaxUse).toLowerCase() || "sale",
              width: "1/2",
              options: [
                { value: "sale", label: t("accounting.forms.newTax.fields.options.sale") },
                { value: "purchase", label: t("accounting.forms.newTax.fields.options.purchase") },
                { value: "withholding", label: t("accounting.taxes.actions.withholding", { defaultValue: "Withholding" }) },
                { value: "none", label: t("accounting.forms.newTax.fields.options.none") },
              ],
            },
            { id: "priceInclude", name: "priceInclude", label: t("accounting.forms.newTax.fields.priceInclude"), type: "switch", defaultValue: Boolean(row.priceInclude), width: "1/2" },
            { id: "active", name: "active", label: t("accounting.taxes.actions.active", { defaultValue: "Active" }), type: "switch", defaultValue: row.active !== false, width: "1/2" },
            { id: "description", name: "description", label: t("accounting.forms.newTax.fields.description"), type: "textarea", defaultValue: String(row.description ?? "") },
          ],
        })
        if (values == null) return
        if (String(values.name ?? "").trim() === "") {
          showWorkflowToast({
            kind: "error",
            title: t("accounting.taxDeadlines.actions.failed", { defaultValue: "{{action}} failed", action: label }),
            description: t("accounting.taxes.actions.invalid", { defaultValue: "Enter a name and a rate." }),
          })
          return
        }
        await runTaxCommand(label, () =>
          updateTax.mutateAsync({
            companyId: operatingCompanyId,
            taxId: BigInt(String(row.id)),
            params: updateAccountTaxParamsForWire(toUpdateAccountTaxParams(values)),
          }),
        )
      },
    }
  }, [t, askForm, runTaxCommand, updateTax.mutateAsync, operatingCompanyId])

  /** Deprecate (after a confirmation) or reactivate a chart-of-accounts row; the reducer re-validates. */
  const toggleAccountDeprecated = useCallback(
    async (account: AccountAccount): Promise<void> => {
      const row = copyAsRecord(account)
      const params = deprecateAccountParams(row, operatingCompanyId)
      const label = params?.deprecated === false
        ? t("accounting.accounts.rowActions.reactivate", { defaultValue: "Reactivate account" })
        : t("accounting.accounts.rowActions.deprecate", { defaultValue: "Deprecate account" })
      const fail = (description: string) =>
        showWorkflowToast({
          kind: "error",
          title: t("accounting.taxDeadlines.actions.failed", { defaultValue: "{{action}} failed", action: label }),
          description,
        })
      if (params == null) {
        fail(t("accounting.accounts.rowActions.noCompany", { defaultValue: "No company is available for this account." }))
        return
      }
      if (
        !accountIsDeprecated(row) &&
        !(await confirmDialog({
          title: label,
          description: t("accounting.accounts.rowActions.deprecateConfirm", {
            defaultValue: "Deprecated accounts are marked as retired. You can reactivate the account later.",
          }),
        }))
      ) {
        return
      }
      try {
        await deprecateAccount.mutateAsync({ accountId: BigInt(String(account.id)), params })
        showWorkflowToast({
          kind: "success",
          title: t("accounting.taxDeadlines.actions.done", { defaultValue: "{{action}} completed", action: label }),
        })
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error))
      }
    },
    [t, operatingCompanyId, confirmDialog, deprecateAccount.mutateAsync],
  )

  /** Edit a chart-of-accounts row; only the fields the user changed are sent. */
  const editAccount = useCallback(
    async (account: AccountAccount): Promise<void> => {
      const row = copyAsRecord(account)
      const label = t("accounting.accounts.rowActions.edit", { defaultValue: "Edit account" })
      const current = accountEditDefaults(row)
      const values = await askForm({
        title: label,
        fields: [
          { id: "code", name: "code", label: t("accounting.accounts.code"), type: "text", required: true, defaultValue: current.code, width: "1/3" },
          { id: "name", name: "name", label: t("accounting.accounts.name"), type: "text", required: true, defaultValue: current.name, width: "2/3" },
          {
            id: "internalType",
            name: "internalType",
            label: t("accounting.accounts.edit.internalType", { defaultValue: "Account type" }),
            type: "select",
            defaultValue: current.internalType,
            options: ACCOUNT_INTERNAL_TYPES.map((value) => ({
              value,
              label: t(`accounting.accounts.edit.internalTypes.${value}`, { defaultValue: value }),
            })),
          },
          { id: "reconcile", name: "reconcile", label: t("accounting.accounts.edit.reconcile", { defaultValue: "Allow reconciliation" }), type: "switch", defaultValue: current.reconcile, width: "1/2" },
          { id: "deprecated", name: "deprecated", label: t("accounting.accounts.edit.deprecated", { defaultValue: "Deprecated" }), type: "switch", defaultValue: current.deprecated, width: "1/2" },
          { id: "note", name: "note", label: t("accounting.accounts.edit.note", { defaultValue: "Note" }), type: "textarea", defaultValue: current.note },
        ],
      })
      if (values == null) return
      const result = toAccountUpdateParams(values, row, operatingCompanyId)
      if (!result.ok) {
        showWorkflowToast({
          kind: result.reason === "unchanged" ? "info" : "error",
          title:
            result.reason === "unchanged"
              ? t("accounting.accounts.edit.unchanged", { defaultValue: "Nothing to change." })
              : t("accounting.taxDeadlines.actions.failed", { defaultValue: "{{action}} failed", action: label }),
          description:
            result.reason === "noCompany"
              ? t("accounting.accounts.rowActions.noCompany", { defaultValue: "No company is available for this account." })
              : result.reason === "invalid"
                ? t("accounting.accounts.edit.invalid", { defaultValue: "Enter a code and a name." })
                : undefined,
        })
        return
      }
      await runTaxCommand(label, () =>
        updateAccount.mutateAsync({ accountId: BigInt(String(account.id)), params: result.params }),
      )
    },
    [t, askForm, runTaxCommand, updateAccount.mutateAsync, operatingCompanyId],
  )

  const promptNewBankStatement = useCallback(async (): Promise<void> => {
    const label = t("accounting.bankStatements.actions.new", { defaultValue: "New statement" })
    const bank = bankJournals(copyAsRecords(journals))
    if (bank.length === 0) {
      showWorkflowToast({
        kind: "error",
        title: t("accounting.taxDeadlines.actions.failed", { defaultValue: "{{action}} failed", action: label }),
        description: t("accounting.bankStatements.actions.noBankJournal", {
          defaultValue: "Create a bank journal first; statements are opened on bank journals.",
        }),
      })
      return
    }
    const values = await askForm({
      title: label,
      fields: [
        {
          id: "journalId",
          name: "journalId",
          label: t("accounting.entities.bankStatements.columns.journalId"),
          type: "select",
          required: true,
          searchable: true,
          options: accountJournalRowsToSelectOptions(bank),
        },
        { id: "name", name: "name", label: t("accounting.entities.bankStatements.columns.name"), type: "text", width: "1/2" },
        { id: "reference", name: "reference", label: t("accounting.bankStatements.actions.reference", { defaultValue: "Reference" }), type: "text", width: "1/2" },
        { id: "date", name: "date", label: t("accounting.entities.bankStatements.columns.date"), type: "date", width: "1/2" },
        { id: "balanceStart", name: "balanceStart", label: t("accounting.entities.bankStatements.columns.balanceStart"), type: "number", step: 0.01, defaultValue: 0, width: "1/2" },
        {
          id: "currencyId",
          name: "currencyId",
          label: t("accounting.bankStatements.actions.currency", { defaultValue: "Currency" }),
          type: "select",
          required: true,
          defaultValue: defaultCurrencyId > 0n ? String(defaultCurrencyId) : "",
          options: currencySelectOptions,
        },
      ],
    })
    if (values == null) return
    const input = toBankStatementCreateInput(values, copyAsRecords(journals))
    if (input == null) {
      showWorkflowToast({
        kind: "error",
        title: t("accounting.taxDeadlines.actions.failed", { defaultValue: "{{action}} failed", action: label }),
        description: t("accounting.bankStatements.actions.invalidNew", {
          defaultValue: "Choose a bank journal and a currency, and enter a valid opening balance.",
        }),
      })
      return
    }
    await runTaxCommand(label, () => createBankStatement.mutateAsync(input))
  }, [t, askForm, journals, currencySelectOptions, defaultCurrencyId, runTaxCommand, createBankStatement.mutateAsync])

  const promptEditBankStatement = useCallback(
    async (statement: Record<string, unknown>): Promise<void> => {
      const label = t("accounting.bankStatements.actions.edit", { defaultValue: "Edit statement" })
      const values = await askForm({
        title: label,
        fields: [
          { id: "name", name: "name", label: t("accounting.entities.bankStatements.columns.name"), type: "text", defaultValue: String(statement.name ?? ""), width: "1/2" },
          { id: "reference", name: "reference", label: t("accounting.bankStatements.actions.reference", { defaultValue: "Reference" }), type: "text", defaultValue: String(statement.reference ?? ""), width: "1/2" },
          { id: "date", name: "date", label: t("accounting.entities.bankStatements.columns.date"), type: "date", defaultValue: statementDateInput(statement.date), width: "1/3" },
          { id: "balanceStart", name: "balanceStart", label: t("accounting.entities.bankStatements.columns.balanceStart"), type: "number", step: 0.01, defaultValue: Number(statement.balanceStart ?? 0), width: "1/3" },
          { id: "balanceEndReal", name: "balanceEndReal", label: t("accounting.entities.bankStatements.columns.balanceEndReal"), type: "number", step: 0.01, defaultValue: Number(statement.balanceEndReal ?? 0), width: "1/3" },
        ],
      })
      if (values == null) return
      const result = toBankStatementUpdateParams(values, statement)
      if (!result.ok) {
        showWorkflowToast({
          kind: result.reason === "unchanged" ? "info" : "error",
          title:
            result.reason === "unchanged"
              ? t("accounting.accounts.edit.unchanged", { defaultValue: "Nothing to change." })
              : t("accounting.taxDeadlines.actions.failed", { defaultValue: "{{action}} failed", action: label }),
          description:
            result.reason === "invalid"
              ? t("accounting.bankStatements.actions.invalidEdit", { defaultValue: "Enter valid balances and date." })
              : undefined,
        })
        return
      }
      const companyId = optionalBigIntU64(statement.companyId ?? statement.company_id) ?? operatingCompanyId
      await runTaxCommand(label, () =>
        updateBankStatement.mutateAsync({
          companyId,
          statementId: BigInt(String(statement.id)),
          params: result.params,
        }),
      )
    },
    [t, askForm, runTaxCommand, updateBankStatement.mutateAsync, operatingCompanyId],
  )

  /** The bank-statements table with its New / Edit actions, each shown only to users who may run it. */
  const bankStatementsActionsConfig = useMemo((): EntityViewConfig => {
    const view = bankStatementsEntityConfig.view as EntityTableConfig
    const actions: EntityAction[] = [
      {
        id: "bank-statement-new",
        label: t("accounting.bankStatements.actions.new", { defaultValue: "New statement" }),
        permission: { resource: "account_bank_statement", action: "create" },
        onClick: () => promptNewBankStatement(),
      },
      {
        id: "bank-statement-edit",
        label: t("accounting.bankStatements.actions.edit", { defaultValue: "Edit statement" }),
        requiresSelection: true,
        permission: { resource: "account_bank_statement", action: "write" },
        isApplicable: (rows) => rows.every((r) => canEditBankStatement(r)),
        onClick: (rows) => promptEditBankStatement(rows[0]!),
      },
    ]
    return { ...bankStatementsEntityConfig, view: { ...view, actions: [...(view.actions ?? []), ...actions] } } as EntityViewConfig
  }, [t, bankStatementsEntityConfig, promptNewBankStatement, promptEditBankStatement])

  /** The statement sheet plus an Edit tab (a posted statement is final, so it only explains that). */
  const bankStatementRecordSheetWithEdit = useMemo(
    (): EntityRecordSheetConfig => ({
      ...bankStatementRecordSheet,
      customTabs: [
        ...(bankStatementRecordSheet.customTabs ?? []),
        ...(checkPermission("account_bank_statement", "write").allowed
          ? [
              {
                id: "edit",
                label: t("accounting.bankStatements.actions.editTab", { defaultValue: "Edit" }),
                content: (record: Record<string, unknown>) =>
                  canEditBankStatement(record) ? (
                    <Button
                      type="button"
                      variant="outline"
                      data-testid="bank-statement-edit"
                      onClick={() => void promptEditBankStatement(record)}
                    >
                      {t("accounting.bankStatements.actions.edit", { defaultValue: "Edit statement" })}
                    </Button>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t("accounting.bankStatements.actions.postedLocked", {
                        defaultValue: "A posted statement can no longer be edited.",
                      })}
                    </p>
                  ),
              },
            ]
          : []),
      ],
    }),
    [t, bankStatementRecordSheet, checkPermission, promptEditBankStatement],
  )

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
            selection: "multiple",
            isApplicable: (rows) => rows.some((row) => accountPeriodStateTag(row as Record<string, unknown>) === "Draft"),
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.accountPeriods.actions.openSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                if (accountPeriodStateTag(r as Record<string, unknown>) === "Draft") {
                  await openAccountPeriod.mutateAsync(BigInt(String(r.id)))
                }
              }
            },
          },
          {
            id: "ap-close",
            label: t("accounting.entities.accountPeriods.actions.closeSelected"),
            requiresSelection: true,
            selection: "multiple",
            isApplicable: (rows) => rows.some((row) => accountPeriodStateTag(row as Record<string, unknown>) === "Open"),
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.accountPeriods.actions.closeSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                if (accountPeriodStateTag(r as Record<string, unknown>) === "Open") {
                  await closeAccountPeriod.mutateAsync(BigInt(String(r.id)))
                }
              }
            },
          },
          {
            id: "ap-delete",
            label: t("accounting.entities.accountPeriods.actions.deleteSelected"),
            requiresSelection: true,
            selection: "multiple",
            variant: "destructive",
            isApplicable: (rows) => rows.some((row) => accountPeriodStateTag(row as Record<string, unknown>) !== "Closed"),
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.accountPeriods.actions.deleteSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                if (accountPeriodStateTag(r as Record<string, unknown>) !== "Closed") {
                  await deleteAccountPeriod.mutateAsync(BigInt(String(r.id)))
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
    const newAssetLabel = t("accounting.entities.fixedAssets.actions.new", { defaultValue: "New asset" })
    const editAssetLabel = t("accounting.entities.fixedAssets.actions.edit", { defaultValue: "Edit asset" })
    const staleSuffix = t("accounting.entities.fixedAssets.form.unavailable", { defaultValue: "(unavailable)" })
    const noneLabel = t("accounting.entities.fixedAssets.form.none", { defaultValue: "None" })
    const accountRows = copyAsRecords(accounts)
    const journalRows = copyAsRecords(journals)
    const lookupState = mergeModuleStates([accountsRead.state, journalsRead.state, currenciesRead.state])
    const lookupsPending = lookupState.status === "loading" || accountsQuery.isFetching || journalsQuery.isFetching || currenciesQuery.isFetching
    const hasRequiredChoices = ["asset", "depreciation", "expense"].every((role) =>
      assetAccountOptions(accountRows, operatingCompanyId, role as Parameters<typeof assetAccountOptions>[2]).length > 0,
    ) && assetJournalOptions(journalRows, operatingCompanyId).length > 0 && currencySelectOptions.length > 0
    const lookupsReady = !lookupsPending && lookupState.status === "ready" && hasRequiredChoices
    const unavailableLabel = lookupsPending
      ? t("accounting.entities.fixedAssets.form.loadingSetup", { defaultValue: "Loading asset setup…" })
      : t("accounting.entities.fixedAssets.form.unavailableSetup", { defaultValue: "Asset setup unavailable" })
    const ensureLookupsReady = (): boolean => {
      if (lookupsReady) return true
      showWorkflowToast({
        kind: "info",
        title: unavailableLabel,
        description: lookupsPending
          ? t("accounting.entities.fixedAssets.form.waitForLookups", { defaultValue: "Wait for accounts, journals, and currencies to finish loading, then open the form." })
          : t("accounting.entities.fixedAssets.form.refreshLookups", { defaultValue: "Refresh the unavailable accounts, journals, or currencies before opening the asset form." }),
      })
      return false
    }
    const assetFailureMessage = (reason: AssetFailure): string => {
      switch (reason) {
        case "code":
        case "name":
        case "assetType":
        case "currency":
          return t("accounting.entities.fixedAssets.form.invalidIdentity", { defaultValue: "Enter a code, a name, an asset type and a currency." })
        case "originalValue":
        case "salvageValue":
          return t("accounting.entities.fixedAssets.form.invalidAmounts", { defaultValue: "The original value must be above zero and the salvage value from zero up to below the original value." })
        case "method":
        case "methodNumber":
        case "methodPeriod":
        case "progressFactor":
          return t("accounting.entities.fixedAssets.form.invalidMethod", { defaultValue: "Choose a method, at least one depreciation of at least one month, and a degressive factor above 0 up to 100 for degressive methods." })
        case "acquisitionDate":
        case "firstDepreciationDate":
          return t("accounting.entities.fixedAssets.form.invalidDates", { defaultValue: "Enter a valid acquisition date (and a valid first depreciation date, if any)." })
        case "journal":
        case "assetAccount":
        case "depreciationAccount":
        case "expenseAccount":
          return t("accounting.entities.fixedAssets.form.invalidAccounts", { defaultValue: "Choose a general journal, asset and depreciation accounts from the Asset group and an expense account from the Expense group." })
        default:
          return t("accounting.entities.fixedAssets.form.invalidDisposal", { defaultValue: "Disposal accounts must be an income account for gains, an expense account for losses and an asset account for disposals." })
      }
    }
    const assetFields = (
      companyId: bigint,
      current: ReturnType<typeof assetEditDefaults> | null,
    ): FormField[] => {
      const accountSelect = (
        id: string,
        label: string,
        role: Parameters<typeof assetAccountOptions>[2],
        value: string,
        optional: boolean,
      ): FormField => {
        const options = assetAccountOptions(accountRows, companyId, role, value, staleSuffix)
        return {
          id,
          name: id,
          label,
          type: "select",
          required: !optional,
          searchable: true,
          defaultValue: value,
          options: optional ? withNone(options, noneLabel) : options,
          width: "1/2",
        }
      }
      const f = (key: string, fallback: string) => t(`accounting.entities.fixedAssets.form.${key}`, { defaultValue: fallback })
      const typeLabels: Record<string, string> = {
        Purchase: f("typePurchase", "Purchase"),
        Sale: f("typeSale", "Sale"),
      }
      const methodLabels: Record<string, string> = {
        Linear: f("methodLinear", "Linear"),
        Degressive: f("methodDegressive", "Degressive"),
        DegressiveThenLinear: f("methodDegressiveThenLinear", "Degressive then linear"),
      }
      return withAssetAuthoringVisibility([
        ...(current == null
          ? ([
              { id: "code", name: "code", label: f("code", "Code"), type: "text", required: true, width: "1/2" },
              { id: "name", name: "name", label: f("name", "Name"), type: "text", required: true, width: "1/2" },
              {
                id: "assetType",
                name: "assetType",
                label: f("assetType", "Asset type"),
                type: "select",
                required: true,
                defaultValue: "Purchase",
                options: ASSET_TYPES.map((value) => ({ value, label: typeLabels[value]! })),
                width: "1/3",
              },
              {
                id: "currencyId",
                name: "currencyId",
                label: f("currency", "Currency"),
                type: "select",
                required: true,
                searchable: true,
                defaultValue: defaultCurrencyId > 0n ? String(defaultCurrencyId) : "",
                options: currencySelectOptions,
                width: "1/3",
              },
              { id: "acquisitionDate", name: "acquisitionDate", label: f("acquisitionDate", "Acquisition date"), type: "date", required: true, width: "1/3" },
            ] as FormField[])
          : ([{ id: "name", name: "name", label: f("name", "Name"), type: "text", required: true, defaultValue: current.name }] as FormField[])),
        { id: "originalValue", name: "originalValue", label: f("originalValue", "Original value"), type: "number", required: true, min: 0.01, step: 0.01, defaultValue: current?.originalValue, width: "1/2" },
        { id: "salvageValue", name: "salvageValue", label: f("salvageValue", "Salvage value"), type: "number", min: 0, step: 0.01, defaultValue: current?.salvageValue ?? 0, width: "1/2" },
        {
          id: "method",
          name: "method",
          label: f("method", "Depreciation method"),
          type: "select",
          required: true,
          defaultValue: current?.method ?? "Linear",
          options: DEPRECIATION_METHODS.map((value) => ({ value, label: methodLabels[value]! })),
          width: "1/2",
        },
        { id: "methodProgressFactor", name: "methodProgressFactor", label: f("progressFactor", "Degressive factor (%)"), type: "number", min: 0, max: 100, step: 0.01, defaultValue: current?.methodProgressFactor || 30, width: "1/2" },
        { id: "methodNumber", name: "methodNumber", label: f("methodNumber", "Number of depreciations"), type: "number", required: true, min: 1, step: 1, defaultValue: current?.methodNumber ?? 5, width: "1/2" },
        { id: "methodPeriod", name: "methodPeriod", label: f("methodPeriod", "Months between depreciations"), type: "number", required: true, min: 1, step: 1, defaultValue: current?.methodPeriod ?? 12, width: "1/2" },
        { id: "firstDepreciationDate", name: "firstDepreciationDate", label: f("firstDepreciationDate", "First depreciation date"), type: "date", defaultValue: current?.firstDepreciationDate ?? "", width: "1/2" },
        { id: "prorata", name: "prorata", label: f("prorata", "Prorata temporis"), type: "switch", defaultValue: current?.prorata ?? false, width: "1/2" },
        {
          id: "journalId",
          name: "journalId",
          label: f("journal", "Depreciation journal (general)"),
          type: "select",
          required: true,
          searchable: true,
          defaultValue: current?.journalId ?? "",
          options: assetJournalOptions(journalRows, companyId, current?.journalId ?? "", staleSuffix),
        },
        accountSelect("accountAssetId", f("assetAccount", "Asset account"), "asset", current?.accountAssetId ?? "", false),
        accountSelect("accountDepreciationId", f("depreciationAccount", "Accumulated depreciation account"), "depreciation", current?.accountDepreciationId ?? "", false),
        accountSelect("accountDepreciationExpenseId", f("expenseAccount", "Depreciation expense account"), "expense", current?.accountDepreciationExpenseId ?? "", false),
        accountSelect("gainAccountId", f("gainAccount", "Disposal gain account (optional)"), "gain", current?.gainAccountId ?? "", true),
        accountSelect("lossAccountId", f("lossAccount", "Disposal loss account (optional)"), "loss", current?.lossAccountId ?? "", true),
        accountSelect("accountDisposalId", f("disposalAccount", "Disposal account (optional)"), "disposal", current?.accountDisposalId ?? "", true),
      ], {
        disposalAccounts: f("showDisposalAccounts", "Show disposal account settings (optional)"),
        disposalAccountsHint: f("showDisposalAccountsHint", "Use these accounts when the asset is disposed. Hiding these fields keeps your selections."),
      })
    }
    const promptNewAsset = async () => {
      if (operatingCompanyId <= 0n || !ensureLookupsReady()) return
      // One idempotency key per dialog: resubmitting this dialog replays instead of duplicating.
      const idempotencyKey = `create-account-asset:${globalThis.crypto.randomUUID()}`
      const values = await askForm({ title: newAssetLabel, fields: assetFields(operatingCompanyId, null) })
      if (values == null) return
      const result = toAssetCreateParams(values, { companyId: operatingCompanyId, accounts: accountRows, journals: journalRows }, idempotencyKey)
      if (!result.ok) {
        showWorkflowToast({
          kind: "error",
          title: t("accounting.taxDeadlines.actions.failed", { defaultValue: "{{action}} failed", action: newAssetLabel }),
          description: assetFailureMessage(result.reason),
        })
        return
      }
      await runTaxCommand(newAssetLabel, () =>
        createAccountAsset.mutateAsync({ companyId: operatingCompanyId, params: result.params }),
      )
    }
    const promptEditAsset = async (row: Record<string, unknown>) => {
      const companyId = assetCompanyId(row, operatingCompanyId)
      if (companyId == null || !canEditAsset(row) || !ensureLookupsReady()) return
      const values = await askForm({ title: editAssetLabel, fields: assetFields(companyId, assetEditDefaults(row)) })
      if (values == null) return
      const result = toAssetUpdateParams(values, row, { companyId, accounts: accountRows, journals: journalRows })
      if (!result.ok) {
        showWorkflowToast(
          result.reason === "unchanged"
            ? { kind: "info", title: t("accounting.accounts.edit.unchanged", { defaultValue: "Nothing to change." }) }
            : {
                kind: "error",
                title: t("accounting.taxDeadlines.actions.failed", { defaultValue: "{{action}} failed", action: editAssetLabel }),
                description: assetFailureMessage(result.reason),
              },
        )
        return
      }
      await runTaxCommand(editAssetLabel, () =>
        updateAccountAsset.mutateAsync({ companyId, assetId: BigInt(String(row.id)), params: result.params }),
      )
    }
    return {
      ...base,
      view: {
        ...view,
        actions: [
          {
            id: "asset-new",
            label: lookupsReady ? newAssetLabel : unavailableLabel,
            permission: { resource: "account_asset", action: "create" },
            onClick: () => promptNewAsset(),
          },
          {
            id: "asset-edit",
            label: lookupsReady ? editAssetLabel : unavailableLabel,
            requiresSelection: true,
            selection: "single",
            permission: { resource: "account_asset", action: "write" },
            isApplicable: (rows) => lookupsReady && rows.length === 1 && canEditAsset(rows[0] as Record<string, unknown>),
            onClick: (rows) => promptEditAsset(rows[0] as Record<string, unknown>),
          },
          {
            id: "asset-activate",
            label: t("accounting.entities.fixedAssets.actions.activateSelected"),
            requiresSelection: true,
            selection: "multiple",
            isApplicable: (rows) => rows.some((row) => (row as Record<string, unknown>).active === false),
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.fixedAssets.actions.activateSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                const row = r as Record<string, unknown>
                if (row.active === false) {
                  await setAccountAssetActive.mutateAsync({
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
            selection: "multiple",
            isApplicable: (rows) => rows.some((row) => (row as Record<string, unknown>).active === true),
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.fixedAssets.actions.deactivateSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                const row = r as Record<string, unknown>
                if (row.active === true) {
                  await setAccountAssetActive.mutateAsync({
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
            selection: "multiple",
            isApplicable: (rows) => rows.some((row) => assetStateTag(row as Record<string, unknown>) === "Draft"),
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.fixedAssets.actions.confirmSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                if (assetStateTag(r as Record<string, unknown>) === "Draft") {
                  await confirmAccountAsset.mutateAsync(BigInt(String(r.id)))
                }
              }
            },
          },
          {
            id: "asset-close",
            label: t("accounting.entities.fixedAssets.actions.closeSelected"),
            requiresSelection: true,
            selection: "multiple",
            isApplicable: (rows) => rows.some((row) => assetStateTag(row as Record<string, unknown>) === "Running"),
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.fixedAssets.actions.closeSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                if (assetStateTag(r as Record<string, unknown>) === "Running") {
                  await closeAccountAsset.mutateAsync(BigInt(String(r.id)))
                }
              }
            },
          },
          {
            id: "asset-compute-depreciation",
            label: t("accounting.entities.fixedAssets.actions.computeDepreciation"),
            requiresSelection: true,
            selection: "multiple",
            isApplicable: (rows) =>
              rows.length > 0 &&
              rows.every(
                (row) =>
                  assetStateTag(row as EntityRow) === "Running",
              ),
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.fixedAssets.actions.computeDepreciation") }),
            onClick: async (rows) => {
              for (const r of rows) {
                if (assetStateTag(r as EntityRow) === "Running") {
                  await computeDepreciationBoard.mutateAsync(BigInt(String(r.id)))
                }
              }
            },
          },
          {
            id: "asset-dispose",
            label: t("accounting.entities.fixedAssets.actions.disposeSelected"),
            requiresSelection: true,
            selection: "multiple",
            variant: "destructive",
            isApplicable: (rows) =>
              rows.length > 0 &&
              rows.every((row) => {
                const state = assetStateTag(row as EntityRow)
                return state === "Running" || state === "Close"
              }),
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.fixedAssets.actions.disposeSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                const state = assetStateTag(r as EntityRow)
                if (state === "Running" || state === "Close") {
                  await disposeAccountAsset.mutateAsync({
                    assetId: BigInt(String(r.id)),
                    disposalDate: new Date(),
                  })
                }
              }
            },
          },
          {
            id: "asset-delete",
            label: t("accounting.entities.fixedAssets.actions.deleteSelected"),
            requiresSelection: true,
            selection: "multiple",
            variant: "destructive",
            isApplicable: (rows) => rows.some((row) => assetStateTag(row as Record<string, unknown>) === "Draft"),
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.fixedAssets.actions.deleteSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                if (assetStateTag(r as Record<string, unknown>) === "Draft") {
                  await deleteAccountAsset.mutateAsync(BigInt(String(r.id)))
                }
              }
            },
          },
        ],
      },
    }
  }, [
    t,
    askForm,
    accounts,
    journals,
    accountsRead.state,
    journalsRead.state,
    currenciesRead.state,
    accountsQuery.isFetching,
    journalsQuery.isFetching,
    currenciesQuery.isFetching,
    operatingCompanyId,
    defaultCurrencyId,
    currencySelectOptions,
    runTaxCommand,
    createAccountAsset.mutateAsync,
    updateAccountAsset.mutateAsync,
    setAccountAssetActive,
    confirmAccountAsset,
    closeAccountAsset,
    deleteAccountAsset,
    computeDepreciationBoard,
    disposeAccountAsset,
  ])

  const accountPaymentsEntityConfig = useMemo((): EntityViewConfig => {
    const base = accountPaymentsTableConfig(t, {
      onEmptyAction: openCreateAccountPayment,
      partnerLabelMap,
      journalLabelMap,
      currencyLabelMap,
    })
    const view = base.view as EntityTableConfig
    return {
      ...base,
      view: {
        ...view,
        actions: [
          ...workflowActionsToEntityActions(invoiceToPayment.paymentActions, {
            ids: { "accounting.payment.post": "pay-post" },
          }),
          {
            id: "pay-cancel",
            label: t("accounting.entities.payments.actions.cancelSelected"),
            requiresSelection: true,
            selection: "multiple",
            variant: "destructive",
            isApplicable: (rows) => rows.some((row) => {
              const st = paymentStateTag(row as Record<string, unknown>)
              return st === "NotPaid" || st === "Paid"
            }),
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.payments.actions.cancelSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                const st = paymentStateTag(r as Record<string, unknown>)
                if (st === "NotPaid" || st === "Paid") {
                  await cancelAccountPayment.mutateAsync(BigInt(String((r as Record<string, unknown>).id)))
                }
              }
            },
          },
          {
            id: "pay-link",
            label: t("accounting.entities.payments.actions.linkInvoices"),
            requiresSelection: true,
            isApplicable: (rows) => rows.length === 1 && isPaymentRegistrable(rows[0] as Record<string, unknown>),
            onClick: (rows) => {
              if (rows.length !== 1) return
              const r = rows[0] as Record<string, unknown>
              if (r.id == null) return
              if (!isPaymentRegistrable(r)) return
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
  }, [
    t,
    invoiceToPayment.paymentActions,
    cancelAccountPayment,
    openCreateAccountPayment,
    partnerLabelMap,
    journalLabelMap,
    currencyLabelMap,
  ])

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
            selection: "multiple",
            isApplicable: (rows) => rows.some((row) => !paymentTermIsActive(row as Record<string, unknown>)),
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.paymentTerms.actions.activateSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                if (!paymentTermIsActive(r as Record<string, unknown>)) {
                  await updatePaymentTerm.mutateAsync({
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
            selection: "multiple",
            isApplicable: (rows) => rows.some((row) => paymentTermIsActive(row as Record<string, unknown>)),
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.paymentTerms.actions.deactivateSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                if (paymentTermIsActive(r as Record<string, unknown>)) {
                  await updatePaymentTerm.mutateAsync({
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
            selection: "multiple",
            variant: "destructive",
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.paymentTerms.actions.deleteSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                await deletePaymentTerm.mutateAsync(BigInt(String((r as Record<string, unknown>).id)))
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
            selection: "multiple",
            variant: "destructive",
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.paymentTerms.actions.deleteLinesSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                await deletePaymentTermLine.mutateAsync(BigInt(String((r as Record<string, unknown>).id)))
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
    const base = accountMoveLinesTableConfig(t, {
      accountLabelMap,
      sourceDocumentLabelMap,
    })
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
            selection: "multiple",
            variant: "destructive",
            isApplicable: (rows) =>
              rows.every((r) => accountMoveLineCanBeDeleted(r as Record<string, unknown>, allMoves as Record<string, unknown>[])),
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.moveLines.actions.deleteSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                await deleteAccountMoveLine.mutateAsync({
                  lineId: BigInt(String((r as Record<string, unknown>).id)),
                  params: { companyId: operatingCompanyId },
                })
              }
            },
          },
        ],
      },
    }
  }, [t, deleteAccountMoveLine, organizationId, operatingCompanyId, accountLabelMap, sourceDocumentLabelMap, allMoves])

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
            selection: "multiple",
            isApplicable: (rows) => rows.some((row) => !intercompanyRuleIsActive(row as Record<string, unknown>)),
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.intercompanyRules.actions.activateSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                if (!intercompanyRuleIsActive(r as Record<string, unknown>)) {
                  await setIntercompanyRuleActive.mutateAsync({
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
            selection: "multiple",
            isApplicable: (rows) => rows.some((row) => intercompanyRuleIsActive(row as Record<string, unknown>)),
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.intercompanyRules.actions.deactivateSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                if (intercompanyRuleIsActive(r as Record<string, unknown>)) {
                  await setIntercompanyRuleActive.mutateAsync({
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
            selection: "multiple",
            variant: "destructive",
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.intercompanyRules.actions.deleteSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                await deleteIntercompanyRule.mutateAsync(BigInt(String(r.id)))
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
    const base = intercompanyTransactionsTableConfig(t, {
      sourceDocumentLabelMap,
      companyLabelMap,
      currencyLabelMap,
    })
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
            selection: "multiple",
            isApplicable: (rows) => rows.some((row) => {
              const state = intercompanyTransactionState(row as Record<string, unknown>)
              return state === "Pending" || state === "Draft"
            }),
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.intercompanyTransactions.actions.approveSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                const state = intercompanyTransactionState(r as Record<string, unknown>)
                if (state === "Pending" || state === "Draft") {
                  await approveIntercompanyTransaction.mutateAsync(BigInt(String(r.id)))
                }
              }
            },
          },
          {
            id: "ic-tx-process",
            label: t("accounting.entities.intercompanyTransactions.actions.processSelected"),
            requiresSelection: true,
            selection: "multiple",
            isApplicable: (rows) => rows.some((row) => intercompanyTransactionState(row as Record<string, unknown>) === "Approved"),
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.intercompanyTransactions.actions.processSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                const state = intercompanyTransactionState(r as Record<string, unknown>)
                if (state === "Approved") {
                  await processIntercompanyTransaction.mutateAsync({
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
            selection: "multiple",
            isApplicable: (rows) => rows.some((row) => intercompanyTransactionState(row as Record<string, unknown>) === "Processing"),
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.intercompanyTransactions.actions.completeSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                const state = intercompanyTransactionState(r as Record<string, unknown>)
                if (state === "Processing") {
                  await completeIntercompanyTransaction.mutateAsync(BigInt(String(r.id)))
                }
              }
            },
          },
          {
            id: "ic-tx-retry",
            label: t("accounting.entities.intercompanyTransactions.actions.retrySelected"),
            requiresSelection: true,
            selection: "multiple",
            isApplicable: (rows) => rows.some((row) => intercompanyTransactionState(row as Record<string, unknown>) === "Error"),
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.intercompanyTransactions.actions.retrySelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                const state = intercompanyTransactionState(r as Record<string, unknown>)
                if (state === "Error") {
                  await retryIntercompanyTransaction.mutateAsync(BigInt(String(r.id)))
                }
              }
            },
          },
          {
            id: "ic-tx-cancel",
            label: t("accounting.entities.intercompanyTransactions.actions.cancelSelected"),
            requiresSelection: true,
            selection: "multiple",
            variant: "destructive",
            isApplicable: (rows) => rows.some((row) => {
              const state = intercompanyTransactionState(row as Record<string, unknown>)
              return state !== "Completed" && state !== "Cancelled"
            }),
            successMessage: t("common.actionCompleted", { action: t("accounting.entities.intercompanyTransactions.actions.cancelSelected") }),
            onClick: async (rows) => {
              for (const r of rows) {
                const state = intercompanyTransactionState(r as Record<string, unknown>)
                if (state !== "Completed" && state !== "Cancelled") {
                  await cancelIntercompanyTransaction.mutateAsync({
                    transactionId: BigInt(String(r.id)),
                    reason: "Cancelled by user",
                  })
                }
              }
            },
          },
          {
            id: "ic-tx-error",
            label: t("accounting.entities.intercompanyTransactions.actions.errorSelected"),
            requiresSelection: true,
            variant: "destructive",
            onClick: (rows) => {
              const row = rows[0] as Record<string, unknown> | undefined
              if (row) setIntercompanyTxError(row)
            },
          },
        ],
      },
    }
  }, [
    t,
    approveIntercompanyTransaction,
    processIntercompanyTransaction,
    completeIntercompanyTransaction,
    retryIntercompanyTransaction,
    cancelIntercompanyTransaction,
    sourceDocumentLabelMap,
    companyLabelMap,
    currencyLabelMap,
  ])

  const runMutation = useCallback(
    async (op: () => Promise<unknown>): Promise<boolean> => {
      try {
        await op()
        return true
      } catch (e) {
        showWorkflowToast({
          kind: "error",
          title: t("common.error.title"),
          description: e instanceof Error ? e.message : t("common.error.generic"),
        })
        return false
      }
    },
    [t],
  )

  const postDraft = useCallback(
    (move: unknown) => {
      const row = move as Record<string, unknown>
      if (!row.id) return
      const id = row.id as string | number | bigint
      const mt = moveTypeTag(row)
      if (isInvoiceLikeMoveType(mt)) {
        // The workflow surface already reports the failure.
        void invoiceToPayment.postInvoice.execute(String(id)).catch(() => undefined)
      } else {
        void runMutation(() => postMove.mutateAsync(id))
      }
    },
    [postMove, invoiceToPayment.postInvoice, runMutation],
  )

  const handleInvoiceDownloadPdf = useCallback(async (move?: { id?: unknown }) => {
    const target = move ?? selectedInvoice
    if (!target?.id) return
    try {
      setInvoiceDocBusy("download")
      await downloadDocumentPdf("account-move", Number(target.id))
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

  const handleInvoiceArchivePdf = useCallback(async () => {
    if (!selectedInvoice?.id) return
    try {
      setInvoiceDocBusy("archive")
      const params = await archiveRenderedPdfAsDocument({
        kind: "account-move",
        recordId: Number(selectedInvoice.id),
        companyId: operatingCompanyId,
        name: String(selectedInvoice.name ?? `Invoice ${selectedInvoice.id}`),
      })
      await createDocument.mutateAsync(params)
      toast({
        title: "Archived to Documents",
        description: "PDF stored as a linked document version.",
      })
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Archive PDF",
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setInvoiceDocBusy(null)
    }
  }, [selectedInvoice, operatingCompanyId, createDocument, toast])

  const handleInvoiceSendEmail = useCallback((move?: { id?: unknown }) => {
    const id = optionalBigIntU64(move?.id ?? selectedInvoice?.id)
    if (id == null || id <= 0n) return
    // Review a single document; never drain the organization-wide mail queue here.
    router.push(`/accounting/invoices/${id}?review=email`)
  }, [selectedInvoice?.id, router])

  // ── Derived data ────────────────────────────────────────────────────────────
  const invoices = useMemo(
    () => allMoves.filter((m) => m.organizationId === orgId && m.companyId === operatingCompanyId && moveTypeTag(m as Record<string, unknown>) === "OutInvoice"),
    [allMoves, orgId, operatingCompanyId],
  )
  const bills = useMemo(
    () => allMoves.filter((m) => m.organizationId === orgId && m.companyId === operatingCompanyId && moveTypeTag(m as Record<string, unknown>) === "InInvoice"),
    [allMoves, orgId, operatingCompanyId],
  )

  const bankStatementMoney = (value: unknown) => formatInvoiceMoney(typeof value === "number" ? value : null, {
    id: currentBankStatement ? String(currentBankStatement.currencyId) : undefined,
    code: invoiceCurrencyOptions.find((currency) => currency.value === String(currentBankStatement?.currencyId))?.code,
  })
  const bankLinkLines = bankStatementLines.map(bankLineFromQueryRow)
  const bankLinkSource: ReconciliationSource = {
    organizationId, companyId: operatingCompanyId, companyCurrencyId: invoiceCompany?.currencyId,
    state: companyAvailable ? mergeModuleStates([bankStatementsRead.state, bankStatementLinesRead.state, allMovesRead.state,
      accountMoveLinesRead.state, accountsRead.state, currenciesRead.state, companiesRead.state]) : { status: "loading" },
    statement: currentBankStatement,
    line: bankLinkLines.find((row) => String(row.id) === String(bankLineMatchFocus?.id)) ?? null,
    bankLines: bankLinkLines, moves: allMoves, moveLines: accountMoveLines,
    accounts, currencies, suggestions: bankMatchCandidates, partners: contacts,
  }
  const bankLinkAccess = useRef({ source: bankLinkSource, allowed: false, recovery: { abandon: false, resubmit: false, reverse: false }, actorKey: currentUser?.id ?? null })
  // Posting/reconciliation are exact backend payment actions beyond the UI CRUD vocabulary.
  const canCreateBankSettlement = companyAvailable && checkPermission("account_bank_statement_line", "write").allowed
    && checkPermission("payment", "create").allowed
    && checkPermission("payment", "post").allowed
    && checkPermission("payment", "reconcile").allowed
    && checkPermission("account_move", "write").allowed
  const bankMutationAvailable = !postBankStatement.isPending && !deleteBankStatement.isPending && !deleteBankStatementLine.isPending
    && !createBankStatementLine.isPending && !updateBankStatementLine.isPending && !unreconcileBankLine.isPending
  const canLinkBankRecords = canCreateBankSettlement && bankMutationAvailable
    && !recoverBankSettlement.isPending
  const bankRecoveryPermissions = bankSettlementRecoveryPermissions(companyAvailable && bankMutationAvailable, canCreateBankSettlement, checkPermission)
  bankLinkAccess.current = { source: bankLinkSource, allowed: canLinkBankRecords, recovery: bankRecoveryPermissions, actorKey: currentUser?.id ?? null }
  const confirmBankLink = async (request: ReconciliationRequest): Promise<ReconciliationOutcome> => {
    const current = bankLinkAccess.current
    if (!current.actorKey || !canDispatchReviewedBankLink(current.source, request, current.allowed)) {
      return { status: "rejected", message: "The company, access or bank records changed. Review the current records before linking." }
    }
    if ([request.organizationId, request.companyId, request.lineId, ...request.moveLineIds].some((id) => BigInt(id) > BigInt(Number.MAX_SAFE_INTEGER))) {
      return { status: "rejected", message: "This record identifier is not supported by the current command transport. No link was submitted." }
    }
    try {
      const effect = await reconcileBankLine.mutateAsync({ lineId: BigInt(request.lineId), params: bankReconcileParamsToJson(request.moveLineIds.map((id) => BigInt(id)), 0) })
      if (!current.actorKey || bankLinkAccess.current.actorKey !== current.actorKey) return { status: "unknown", message: "The signed-in user changed. Return to the original user and check this action." }
      if ("attempt" in effect) return { status: "lifecycle", attempt: effect.attempt }
      return effect.status === "awaiting_approval" ? { status: "awaiting_approval", paymentId: effect.paymentId } : { status: "confirmed" }
    } catch {
      // The existing command hook does not retain HTTP status; no error is safe to replay automatically.
      return { status: "unknown", message: "The original bank-line link could not be confirmed. Check its saved result; do not submit it again." }
    }
  }
  const checkBankLink = async (request: ReconciliationRequest, recovery?: BankSettlementRecoveryRequest): Promise<ReconciliationStatusResult> => {
    const actorKey = bankLinkAccess.current.actorKey
    const sameScope = () => String(bankLinkAccess.current.source.organizationId) === request.organizationId
      && String(bankLinkAccess.current.source.companyId) === request.companyId
      && actorKey != null && bankLinkAccess.current.actorKey === actorKey
      && bankLinkAccess.current.source.state.status === "ready"
    if (!sameScope()) return "unconfirmed"
    const [lines, statements, payments, moves, moveLines] = await Promise.all([
      fetchQueryList("/api/query/bank-statement-lines", "Could not check the original bank line"),
      fetchQueryList("/api/query/bank-statements", "Could not check the original statement"),
      fetchQueryList("/api/query/account-payments", "Could not check the original settlement payment"),
      fetchQueryList("/api/query/account-moves", "Could not check the original settlement entries"),
      fetchQueryList("/api/query/account-move-lines", "Could not check the original settlement balances"),
    ])
    if (!sameScope()) return "unconfirmed"
    const lifecycle = resolveBankSettlementLifecycleEffect({ lines, statements, payments, moves, moveLines }, {
      organizationId: request.organizationId, companyId: request.companyId, lineId: request.lineId, request: recovery,
    })
    const expectedMoveIds = recovery?.moveLineIds ?? request.moveLineIds
    if (lifecycle && lifecycle.statementId === request.statementId && lifecycle.attempt.selectedMoveLineIds.length === expectedMoveIds.length
      && lifecycle.attempt.selectedMoveLineIds.every((id) => expectedMoveIds.includes(id))) return { status: "lifecycle", attempt: lifecycle.attempt }
    if (recovery || lines.some((line) => String(line.id) === request.lineId && hasBankSettlementAttempt(line.metadata))) return "unconfirmed"
    const effect = resolveBankStatementSettlementEffect(lines, statements, { payments, moves, moveLines }, {
      organizationId: BigInt(request.organizationId), companyId: BigInt(request.companyId),
      lineId: BigInt(request.lineId), moveIds: request.moveLineIds.map(BigInt), amountResidual: request.amountResidual,
    })
    return effect?.status === "awaiting_approval" ? { status: "awaiting_approval", paymentId: effect.paymentId }
      : effect?.status === "confirmed" ? "confirmed" : "unconfirmed"
  }
  const recoverReviewedBankSettlement = async (request: BankSettlementRecoveryRequest): Promise<ReconciliationOutcome> => {
    const actorKey = bankLinkAccess.current.actorKey
    const mayDispatch = () => {
      const current = bankLinkAccess.current
      if (!actorKey || current.actorKey !== actorKey || !current.recovery[request.action] || current.source.state.status !== "ready"
        || String(current.source.organizationId) !== request.organizationId || String(current.source.companyId) !== request.companyId
        || String(current.source.statement?.id) !== request.statementId || String(current.source.line?.id) !== request.lineId) return false
      const attempt = bankSettlementAttempt(current.source.line?.metadata)
      if (!attempt) return false
      if (bankSettlementRecoveryCorrelates(attempt, request)) return true
      return attempt.attemptId === request.attemptId && attempt.paymentId === request.paymentId && bankSettlementRecoveryAllowed(attempt, request.action)
        && (request.action !== "resubmit" || canDispatchReviewedBankLink(current.source, { organizationId: request.organizationId, companyId: request.companyId,
          statementId: request.statementId, lineId: request.lineId, moveLineIds: request.moveLineIds, amountResidual: 0 }, true))
    }
    if (!mayDispatch()) return { status: "rejected", message: "The original settlement, user, company or access changed. Check its current status before recovering it." }
    try {
      const effect = await recoverBankSettlement.mutateAsync({ request, mayDispatch })
      return { status: "lifecycle", attempt: effect.attempt }
    } catch (error) {
      const status = error != null && typeof error === "object" && "status" in error ? error.status : undefined
      return typeof status === "number" && status >= 400 && status < 500 && ![408, 429].includes(status)
        ? { status: "rejected", message: error instanceof Error ? error.message : "The recovery request was rejected." }
        : { status: "unknown", message: "The settlement recovery is unconfirmed. Keep the original request and check its saved result." }
    }
  }

  // Each overview card owns its source state; an unavailable auxiliary read must
  // never become a zero balance or hide the other independently available queues.
  const manualInvoiceReadState = mergeModuleStates([
    accountsRead.state, accountTypesRead.state, journalsRead.state, contactsRead.state, taxesRead.state,
    productsRead.state, paymentTermsRead.state, currenciesRead.state, companiesRead.state, taxGroupsRead.state,
    fiscalYearsRawRead.state, accountPeriodsRawRead.state,
  ])
  const draftReviewState = mergeModuleStates([invoiceIdentityState, invoicePersonalization.state])
  const selectedInvoiceCompanyMatches = selectedInvoice != null && String(selectedInvoice.companyId) === String(operatingCompanyId)
  const selectedDraftReviewState = !selectedInvoiceCompanyMatches
    ? { status: "error" as const, message: "Select this invoice’s company before reviewing or posting it." }
    : draftReviewState
  const selectedInvoiceMoveType = enumTag(selectedInvoice?.moveType)
  const draftInvoicePersonalization = selectedInvoice && selectedInvoiceCompanyMatches && ["OutInvoice", "OutRefund"].includes(selectedInvoiceMoveType) && invoicePersonalization.profile && invoiceSeller
    ? resolveDraftInvoiceDocument(selectedInvoice.metadata, invoicePersonalization.profile, invoicePersonalization.profileVersionIds, invoiceSeller)
    : null
  const financeChartSections = useMemo(() => {
    const now = new Date()
    const currentRange = { startMs: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), endMs: now.getTime() }
    const previousRange = { startMs: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(), endMs: currentRange.startMs - 1 }
    const chartInvoices = invoices.filter((move) => move.companyId === operatingCompanyId)
    const chartBills = bills.filter((move) => move.companyId === operatingCompanyId)
    const chartPayments = accountPayments.filter((payment) => payment.companyId === operatingCompanyId)
    const currencyId = singleCurrencyId([...chartInvoices, ...chartBills, ...chartPayments])
    const currencyCode = currencyId ? currencyCodeMap(currencies).get(currencyId) : undefined
    const money: ChartValueFormat = currencyCode ? { kind: "currency", currency: currencyCode } : { kind: "number" }
    const sourceState = mergeModuleStates([allMovesRead.state, accountPaymentsRead.state, currenciesRead.state])
    const ids = ["acc-revenue-expenses", "acc-collection-rate", "acc-aging-share", "acc-top-customers", "acc-cash-movements"]
    return mapDashboardWidgets(moduleConfigBase, (w) => {
      if (!ids.includes(w.id)) return w
      if (sourceState.status !== "ready" || !currencyCode) return { ...w, type: "diagnostic", data: { code: "missing-measure", message: sourceState.status !== "ready" ? "Financial source data is not ready. Refresh this overview before interpreting totals." : "This aggregate requires one known currency. Mixed currencies need verified conversion." } }
      if (w.type === "combo-chart" && w.id === "acc-revenue-expenses") return { ...w, data: { ...w.data, values: revenueVsExpensesByMonth(chartInvoices, chartBills, now), valueFormat: money } }
      if (w.type === "radial-gauge" && w.id === "acc-collection-rate") {
        const rate = collectionRate(chartInvoices, currentRange)
        return { ...w, data: { ...w.data, value: rate.collected, max: rate.invoiced, stats: [{ label: "Invoiced", value: formatChartValue(rate.invoiced, money) }, { label: "Collected", value: formatChartValue(rate.collected, money) }, { label: "Outstanding", value: formatChartValue(rate.outstanding, money) }] } }
      }
      if (w.type === "share-bar" && w.id === "acc-aging-share") return { ...w, data: { ...w.data, rows: agingShareRows(agingTotals(chartInvoices, chartBills, now.getTime()), { ar: "Invoices", ap: "Bills" }), valueFormat: money } }
      if (w.type === "ranked-bars" && w.id === "acc-top-customers") return { ...w, data: { ...w.data, items: topCustomers(chartInvoices, partnerLabelMap, currentRange, previousRange), valueFormat: money } }
      if (w.type === "step-chart" && w.id === "acc-cash-movements") {
        const cash = weeklyCashMovements(chartPayments, now)
        return { ...w, data: { ...w.data, values: cash.values, anomalies: cash.anomalies, valueFormat: money } }
      }
      return w
    }).map((section) => ({ ...section, widgets: section.widgets.filter((widget) => ids.includes(widget.id)) })).filter((section) => section.widgets.length > 0)
  }, [invoices, bills, accountPayments, operatingCompanyId, currencies, allMovesRead.state, accountPaymentsRead.state, currenciesRead.state, moduleConfigBase, partnerLabelMap])
  const accountantOverview = (
    <AccountantOverview
      companyName={companyLabelMap.get(String(operatingCompanyId))}
      data={{
        organizationId,
        companyId: operatingCompanyId,
        moves: allMovesRead,
        payments: accountPaymentsRead,
        paymentAllocationSources: { moveLines: accountMoveLinesRead, transactions: paymentTransactionsRead, reversals: paymentReversalsRead },
        bankStatements: bankStatementsRead,
        bankLines: bankStatementLinesRead,
        deadlines: taxDeadlinesRead,
        periods: accountPeriodsRawRead,
        currencies: currenciesRead,
        companies: companiesRead,
        budgets: budgetsRead,
      }}
      onNavigate={setAccountingActiveTab}
      onCreateInvoice={checkPermission("account_move", "create").allowed && manualInvoiceReadState.status === "ready" ? openInvoiceCreate : undefined}
      onCreateBill={checkPermission("account_move", "create").allowed && manualInvoiceReadState.status === "ready" ? openBillCreate : undefined}
      onCreateJournalEntry={checkPermission("account_move", "create").allowed && mergeModuleStates([
        allMovesRead.state, accountsRead.state, journalsRead.state, saleOrdersRead.state,
      ]).status === "ready" ? () => setQuickActionForm({ form: journalEntryFormConfig, action: "createMove" }) : undefined}
      onOpenBankLine={(line, statement) => {
        setBankStatementDetail({ ...statement })
        setBankLineMatchFocus({ ...line })
      }}
    />
  )

  const chartStructurePanel = useMemo(
    () => (
      <ChartStructureWorkspace
        accountTypes={accountTypes}
        accountGroups={accountGroups}
        onCreateAccountType={async (fd) => {
          const p = toCreateAccountAccountTypeParams(fd, operatingCompanyId)
          if (p.name.trim() && p.type.trim()) {
            await createAccountType.mutateAsync(p)
          }
        }}
        onUpdateAccountType={async (typeId, fd) => {
          await updateAccountType.mutateAsync({
            typeId,
            params: toUpdateAccountAccountTypeParams(
              fd,
              operatingCompanyId,
            ),
          })
        }}
        onCreateAccountGroup={async (fd) => {
          const p = toCreateAccountGroupParams(fd, operatingCompanyId)
          if (p.name.trim()) {
            await createAccountGroup.mutateAsync(p)
          }
        }}
        onUpdateAccountGroup={async (groupId, fd) => {
          await updateAccountGroup.mutateAsync({
            groupId,
            params: toUpdateAccountGroupParams(fd, operatingCompanyId),
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
  const dataState = {
    dashboard: { status: "ready" } as const,
    accounts: mergeModuleStates([accountsRead.state, accountTypesRead.state, accountGroupsRead.state]),
    "journal-entries": mergeModuleStates([
      allMovesRead.state,
      accountMoveLinesRead.state,
      accountsRead.state,
      saleOrdersRead.state,
      journalsRead.state,
    ]),
    invoices: mergeModuleStates([
      allMovesRead.state,
      accountMoveLinesRead.state,
      accountsRead.state,
      saleOrdersRead.state,
      journalsRead.state,
    ]),
    bills: mergeModuleStates([
      allMovesRead.state,
      accountMoveLinesRead.state,
      accountsRead.state,
      saleOrdersRead.state,
      journalsRead.state,
    ]),
    taxes: taxesRead.state,
    payments: mergeModuleStates([
      accountPaymentsRead.state,
      contactsRead.state,
      journalsRead.state,
      currenciesRead.state,
      companiesRead.state,
      allMovesRead.state,
    ]),
    "payment-operations": mergeModuleStates([
      accountMoveLinesRead.state,
      accountsRead.state,
      contactsRead.state,
      journalsRead.state,
      currenciesRead.state,
      companiesRead.state,
    ]),
    "tax-groups": taxGroupsRead.state,
    "tax-jurisdictions": taxJurisdictionsRead.state,
    "tax-schedules": mergeModuleStates([taxSchedulesRead.state, taxJurisdictionsRead.state, taxesRead.state]),
    "tax-deadlines": taxDeadlinesRead.state,
    "payment-terms": paymentTermsRead.state,
    "payment-term-lines": mergeModuleStates([paymentTermLinesRead.state, paymentTermsRead.state]),
    budgets: mergeModuleStates([budgetsRead.state, budgetLinesRead.state, budgetPostsRead.state]),
    analytic: mergeModuleStates([analyticRead.state, currenciesRead.state, companiesRead.state]),
    "analytic-lines": mergeModuleStates([
      analyticLinesRead.state,
      analyticRead.state,
      currenciesRead.state,
      companiesRead.state,
    ]),
    "analytic-distribution": mergeModuleStates([analyticDistributionRead.state, analyticRead.state]),
    "bank-statements": mergeModuleStates([
      bankStatementsRead.state,
      bankStatementLinesRead.state,
      bankMatchCandidatesRead.state,
      contactsRead.state,
      journalsRead.state,
      currenciesRead.state,
      companiesRead.state,
    ]),
    "reconciliation-widgets": mergeModuleStates([
      reconciliationWidgetsRead.state,
      accountsRead.state,
      contactsRead.state,
    ]),
    "fixed-assets": mergeModuleStates([
      fixedAssetsRead.state,
      depreciationLinesRead.state,
      accountsRead.state,
      journalsRead.state,
      currenciesRead.state,
      companiesRead.state,
      allMovesRead.state,
    ]),
    "fiscal-years": fiscalYearsRawRead.state,
    "account-periods": accountPeriodsRawRead.state,
    "fx-revaluation": mergeModuleStates([
      fxRevaluationRunsRead.state,
      currenciesRead.state,
      journalsRead.state,
      accountsRead.state,
      accountPaymentsRead.state,
      allMovesRead.state,
    ]),
    "credit-control": mergeModuleStates([
      partnerCreditControlsRead.state,
      contactsRead.state,
      journalsRead.state,
      accountsRead.state,
      allMovesRead.state,
    ]),
    amortization: mergeModuleStates([
      amortizationSchedulesRead.state,
      amortizationLinesRead.state,
      journalsRead.state,
      accountsRead.state,
      currenciesRead.state,
    ]),
    consolidation: mergeModuleStates([
      consolidationAccountsRead.state,
      consolidationJournalsRead.state,
      eliminationEntriesRead.state,
      companiesRead.state,
      currenciesRead.state,
      accountPeriodsRawRead.state,
    ]),
    "intercompany-rules": mergeModuleStates([
      intercompanyRulesRead.state,
      companiesRead.state,
      journalsRead.state,
      accountsRead.state,
    ]),
    "intercompany-transactions": mergeModuleStates([
      intercompanyTransactionsRead.state,
      companiesRead.state,
      currenciesRead.state,
      saleOrdersRead.state,
      allMovesRead.state,
    ]),
    "account-journals": journalsRead.state,
    "move-lines": mergeModuleStates([
      accountMoveLinesRead.state,
      accountsRead.state,
      saleOrdersRead.state,
      allMovesRead.state,
    ]),
    // The checklist owns source truth and retries per check, like the overview.
    "period-close": { status: "ready" } as const,
  }
  type AccountingTab = keyof typeof dataState
  const isAccountingTab = (tab: string): tab is AccountingTab =>
    Object.prototype.hasOwnProperty.call(dataState, tab)
  const tabUsable = (tab: string | undefined) =>
    tab == null || (isAccountingTab(tab) && canUseModuleData(dataState[tab]))
  type AccountingDataAction =
    | "createAccount"
    | "createMove"
    | "createTax"
    | "createBudget"
    | "createAnalyticAccount"
    | "createAnalyticLine"
    | "createAnalyticDistributionModel"
    | "createReconciliationWidget"
    | "createFiscalYear"
    | "createAccountPeriod"
    | "createAccountPayment"
    | "createPaymentTerm"
    | "createPaymentTermLine"
    | "createAccountJournal"
    | "addAccountMoveLine"
    | "createCurrencyRate"
    | "createDepreciationLine"
    | "createIntercompanyRule"
    | "createIntercompanyTransaction"
  const actionTabs = {
    createAccount: "accounts", createMove: "journal-entries", createTax: "taxes", createBudget: "budgets",
    createAnalyticAccount: "analytic", createAnalyticLine: "analytic-lines",
    createAnalyticDistributionModel: "analytic-distribution", createReconciliationWidget: "reconciliation-widgets",
    createFiscalYear: "fiscal-years", createAccountPeriod: "account-periods", createAccountPayment: "payments",
    createPaymentTerm: "payment-terms", createPaymentTermLine: "payment-term-lines",
    createAccountJournal: "account-journals", addAccountMoveLine: "move-lines",
    createCurrencyRate: "fx-revaluation",
    createDepreciationLine: "fixed-assets", createIntercompanyRule: "intercompany-rules",
    createIntercompanyTransaction: "intercompany-transactions",
  } satisfies Record<AccountingDataAction, AccountingTab>
  const isAccountingDataAction = (action: string): action is AccountingDataAction =>
    Object.prototype.hasOwnProperty.call(actionTabs, action)
  const actionUsable = (action: string) =>
    !isAccountingDataAction(action) || tabUsable(actionTabs[action])
  const csvTabs: Record<AccountingCsvImportKind, AccountingTab> = {
    account: "accounts",
    accountMove: "journal-entries",
    outstandingDocuments: "journal-entries",
    historicalDocumentsForPaymentReplay: "journal-entries",
    accountMoveLine: "journal-entries",
    tax: "taxes",
    budget: "budgets",
    budgetLine: "budgets",
    analytic: "analytic",
  }
  const quickActionUsable = quickActionForm == null || actionUsable(quickActionForm.action)
  const csvUsable = csvKind == null || tabUsable(csvTabs[csvKind])
  // Overview can open these dialogs while a different source's tab is active.
  // Close them when their own primary reads stop being usable.
  const bankDetailUsable = companyAvailable && canUseModuleData(bankStatementsRead.state) && canUseModuleData(bankStatementLinesRead.state)
  const manualInvoiceDataReady = companyAvailable && manualInvoiceReadState.status === "ready"
  useEffect(() => {
    if (!bankDetailUsable && !bankLinkLockRef.current) {
      setBankStatementDetail(null)
      setBankLineMatchFocus(null)
      setBankLineEdit(null)
      setBankLineCreateOpen(false)
    }
    if (!manualInvoiceDataReady) {
      setShowCreateInvoice(false)
      setShowCreateBill(false)
    }
  }, [bankDetailUsable, manualInvoiceDataReady, bankLinkLocked])
  // Record sheets, row editors and prompts are opened from the active tab's rows.
  const activeTabUsable = companyAvailable && tabUsable(accountingActiveTab)
  useEffect(() => {
    // Dialogs close when the collection their rows came from is denied or fails.
    if (!quickActionUsable) setQuickActionForm(null)
    if (!csvUsable) setCsvKind(null)
    if (!activeTabUsable) {
      setSelectedInvoice(null)
      setInvoiceSheetRecord(null)
      setShowCreateInvoice(false)
      setShowCreateBill(false)
      setCreditNoteSource(null)
      setAnalyticAccountEdit(null)
      setAnalyticLineEdit(null)
      setAnalyticDistEdit(null)
      if (!bankLinkLockRef.current) setBankStatementDetail(null)
      setBankLineCreateOpen(false)
      setBankLineEdit(null)
      if (!bankLinkLockRef.current) setBankLineMatchFocus(null)
      setReconciliationWidgetEdit(null)
      setFiscalYearEdit(null)
      setFiscalSetupOpen(false)
      setAccountPeriodEdit(null)
      setRegisterPaymentForId(null)
      setReconcilePaymentOpen(false)
      setJournalEdit(null)
      setPaymentTermLineEdit(null)
      setSelectedFixedAsset(null)
      setDepreciationLineCreateOpen(false)
      setIntercompanyRuleEdit(null)
      setIntercompanyTxCreateOpen(false)
      setMoveLineEdit(null)
      setChatterTarget(null)
      setGlDrilldownAccount(null)
      cancelForm()
    }
  }, [quickActionUsable, csvUsable, activeTabUsable, cancelForm, bankLinkLocked])

  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>,
  ) => {
    if (!companyAvailable) throw new Error("Select an active company before saving this accounting form.")
    if (isAccountingDataAction(action) && dataState[actionTabs[action]].status !== "ready") {
      throw new Error("The accounting records needed by this form are not ready. Refresh their source before saving.")
    }
    if (action === "createAccount") {
      const p = toCreateAccountAccountParams(formData, {
        companyId: operatingCompanyId,
        accountTypes,
      })
      if (p) await createAccount.mutateAsync(p)
    } else if (action === "createMove") {
      const p = toCreateAccountMoveParams(formData, operatingCompanyId)
      if (p) await createMove.mutateAsync(p)
    } else if (action === "createTax") {
      await createTax.mutateAsync({
        companyId: operatingCompanyId,
        params: toCreateAccountTaxParams(formData),
      })
    } else if (action === "createBudget") {
      await createBudget.mutateAsync(toCreateCrossoveredBudgetParams(formData, operatingCompanyId))
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
      const issue = reconciliationSelectionIssue(formData, reconciliationSelectionContext)
      if (issue) throw new Error(reconciliationSelectionMessage(issue))
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
      const params = toCreateAccountJournalParams(formData, operatingCompanyId)
      await createAccountJournal.mutateAsync(params)
    } else if (action === "addAccountMoveLine") {
      const parsed = toAddAccountMoveLineParamsFromForm(formData)
      if (parsed) {
        await addAccountMoveLine.mutateAsync({ moveId: parsed.moveId, params: parsed.params })
      }
    } else if (action === "createCurrencyRate") {
      const p = toCreateCurrencyRateParamsFromForm(formData)
      if (p) await createCurrencyRate.mutateAsync(p)
    } else if (action === "createDepreciationLine") {
      const p = toCreateDepreciationLineParams(formData)
      if (p) await createDepreciationLine.mutateAsync(depreciationLineParamsToJson(p))
    } else if (action === "createIntercompanyRule") {
      const sourceCompanyId = optionalBigIntU64(formData.sourceCompanyId)
      const destinationCompanyId = optionalBigIntU64(formData.destinationCompanyId)
      const p = toCreateIntercompanyRuleParams(formData)
      if (p && sourceCompanyId != null && destinationCompanyId != null) {
        await createIntercompanyRule.mutateAsync({
          sourceCompanyId,
          destinationCompanyId,
          params: intercompanyRuleParamsToJson(p),
        })
      }
    } else if (action === "createIntercompanyTransaction") {
      const p = toCreateIntercompanyTransactionParams(formData)
      if (p && operatingCompanyId > 0n) {
        await createIntercompanyTransaction.mutateAsync({
          originCompanyId: operatingCompanyId,
          params: intercompanyTransactionParamsToJson(p),
        })
      }
    }
  }

  const canImportCsv = useCallback(
    (kind: "account" | "accountMove" | "accountMoveLine" | "budget" | "budgetLine") =>
      checkPermission(CSV_IMPORT_CONTRACTS[kind].resource, "create").allowed,
    [checkPermission],
  )

  const addCsvToolbar = useCallback(
    (ec: EntityViewConfig, actions: EntityAction[]): EntityViewConfig => {
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

  const submitAccountMoveBundle = useCallback(
    async ({
      headers,
      split,
      parentMapping,
      lineMapping,
      fileNamePrefix,
      resume,
    }: {
      headers: string[]
      split: SplitAccountMoveImportResult
      parentMapping: ColumnMappingMap
      lineMapping: ColumnMappingMap
      fileNamePrefix: string
      resume?: HistoricalImportResume
    }) => {
      const canonicalParentCsv = buildBundleParentCsv(
        split.parentHeaders,
        split.parentRows,
        parentMapping,
      )
      const bundleToken = accountMoveBundleToken(canonicalParentCsv)
      if (resume?.phase === "complete") {
        return { bundleToken, moveIdByRef: resume.moveIdByReference }
      }
      const parentCsv = markAccountMoveBundleParentCsv(canonicalParentCsv)
      let moveIdByRef =
        resume?.phase === "lines_pending" ? resume.moveIdByReference : undefined
      if (!moveIdByRef) {
        const parentReceipt = await trackedBundleImport.mutateAsync(
          createCsvImportRequest(
            orgId,
            "account_move",
            parentCsv,
            `${fileNamePrefix}-headers.csv`,
            { companyId: operatingCompanyId },
          ),
        )
        assertBundleImportSucceeded("Journal entry header", parentReceipt)

        let importedMoves = await fetchQueryList<"account-moves">(
          `/api/query/account-moves?companyId=${encodeURIComponent(String(operatingCompanyId))}`,
          "Failed to resolve imported journal entries",
        )
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const availableRefs = new Set(
            importedMoves
              .filter((move) => String(move.companyId) === String(operatingCompanyId))
              .map((move) => accountMoveReference({ id: move.id, ref: move.ref }))
              .filter(Boolean),
          )
          if (split.parentLinkValues.every((reference) => availableRefs.has(reference))) break
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
          importedMoves = await fetchQueryList<"account-moves">(
            `/api/query/account-moves?companyId=${encodeURIComponent(String(operatingCompanyId))}`,
            "Failed to resolve imported journal entries",
          )
        }

        const afterMoveLinks = importedMoves
          .filter((move) => String(move.companyId) === String(operatingCompanyId))
          .map((move) => ({ id: move.id, ref: move.ref }))
        moveIdByRef = buildMoveIdMapFromAccountMoves(
          afterMoveLinks,
          split.parentLinkValues,
        )
      }
      const lineCsv = markAccountMoveBundleLineCsv(
        buildAccountMoveLineCsv(
          headers,
          split.lineRows,
          lineMapping,
          moveIdByRef,
        ),
        bundleToken,
      )
      const lineReceipt = await trackedBundleImport.mutateAsync(
        createCsvImportRequest(
          orgId,
          "account_move_line",
          lineCsv,
          `${fileNamePrefix}-lines.csv`,
          { companyId: operatingCompanyId },
        ),
      )
      assertBundleImportSucceeded("Journal entry line", lineReceipt)
      return { bundleToken, moveIdByRef }
    },
    [operatingCompanyId, orgId, trackedBundleImport],
  )

  const importAccountMoveBundle = useCallback(
    async (text: string) => {
      const parsed = parseCsvText(text)
      const headers = parsed.headers.map((header) => header.trim().toLowerCase())
      if (new Set(headers).size !== headers.length) {
        throw new Error("The journal import contains duplicate column names.")
      }

      const { parentMapping, lineMapping } = accountMoveBundleMappings(headers)
      const split = splitAccountMoveImportCsv({
        headers,
        rows: parsed.rows,
        parentMapping,
        lineMapping,
        parentLinkSourceColumn: ACCOUNT_MOVE_IMPORT_BUNDLE.parentLinkField,
      })
      await submitAccountMoveBundle({
        headers,
        split,
        parentMapping,
        lineMapping,
        fileNamePrefix: "journal-entry",
      })
    },
    [submitAccountMoveBundle],
  )

  const importOutstandingDocuments = useCallback(
    async (text: string, mode: OutstandingDocumentImportMode) => {
      const parsed = parseCsvText(text)
      const headers = parsed.headers.map((header) => header.trim().toLowerCase())
      if (new Set(headers).size !== headers.length) {
        throw new Error("The outstanding-document import contains duplicate column names.")
      }
      const supportedColumns: ReadonlySet<string> = new Set([
        ...(mode === "reconstruct_original_total"
          ? HISTORICAL_PAYMENT_REPLAY_IMPORT_COLUMNS.required
          : OUTSTANDING_DOCUMENT_IMPORT_COLUMNS.required),
        ...(mode === "reconstruct_original_total"
          ? HISTORICAL_PAYMENT_REPLAY_IMPORT_COLUMNS.optional
          : OUTSTANDING_DOCUMENT_IMPORT_COLUMNS.optional),
      ])
      const mapping = Object.fromEntries(
        headers
          .filter((header) => supportedColumns.has(header))
          .map((header) => [header, header]),
      )
      const prepared = prepareOutstandingDocumentImport({
        headers,
        rows: parsed.rows,
        mapping,
        mode,
        companyCurrencyId: manualInvoiceCurrencyId,
        importBatchIdentity:
          mode === "reconstruct_original_total"
            ? accountMoveBundleToken(text)
            : undefined,
      })
      let resume: HistoricalImportResume | undefined
      if (mode === "reconstruct_original_total") {
        const capabilityResponse = await apiFetch(
          "/api/accounting/historical-payment-allocations/capability",
        )
        if (!capabilityResponse.ok) {
          throw new Error(
            `Historical payment replay capability check failed (${capabilityResponse.status})`,
          )
        }
        validateHistoricalPaymentReplayCapability(await capabilityResponse.json())
        validateHistoricalPaymentReplaySources({
          groups: prepared.paymentReplayGroups,
          paymentTransactions: await fetchQueryList<"payment-transactions">(
            `/api/query/payment-transactions?companyId=${encodeURIComponent(String(operatingCompanyId))}`,
            "Failed to validate historical payment transactions",
          ),
          companyId: operatingCompanyId,
        })
      }
      const split = splitAccountMoveImportCsv(outstandingDocumentSplitArgs(prepared))
      if (mode === "reconstruct_original_total") {
        const canonicalParentCsv = buildBundleParentCsv(
          split.parentHeaders,
          split.parentRows,
          prepared.parentMapping,
        )
        const bundleToken = accountMoveBundleToken(canonicalParentCsv)
        const [existingMoves, existingLines] = await Promise.all([
          fetchQueryList<"account-moves">(
            `/api/query/account-moves?companyId=${encodeURIComponent(String(operatingCompanyId))}`,
            "Failed to inspect existing historical documents",
          ),
          fetchQueryList<"account-move-lines">(
            `/api/query/account-move-lines?companyId=${encodeURIComponent(String(operatingCompanyId))}`,
            "Failed to inspect existing historical document lines",
          ),
        ])
        resume = resolveHistoricalImportResume({
          checks: prepared.documentResumeChecks,
          existingMoves,
          existingLines,
          companyId: operatingCompanyId,
          bundleToken,
          markedParentCsv: markAccountMoveBundleParentCsv(canonicalParentCsv),
          importBatchIdentity: prepared.importBatchIdentity,
        })
      }
      const imported = await submitAccountMoveBundle({
        headers: prepared.headers,
        split,
        parentMapping: prepared.parentMapping,
        lineMapping: prepared.lineMapping,
        fileNamePrefix:
          mode === "reconstruct_original_total"
            ? "historical-document-payment-replay"
            : "outstanding-document",
        resume,
      })
      if (mode === "reconstruct_original_total") {
        const moveIds = [...new Set(imported.moveIdByRef.values())].sort((left, right) =>
          BigInt(left) < BigInt(right) ? -1 : 1,
        )
        for (const moveId of moveIds) {
          try {
            await postMove.mutateAsync(moveId)
          } catch (cause) {
            const detail = cause instanceof Error ? cause.message : String(cause)
            throw new Error(
              `Original-total document ${moveId} was imported but could not be posted before payment replay. Complete any required approval, then retry this file. ${detail}`,
            )
          }
        }
        const batches = buildHistoricalPaymentReplayBatches({
          groups: prepared.paymentReplayGroups,
          moveIdByReference: imported.moveIdByRef,
          companyId: operatingCompanyId,
          bundleToken: imported.bundleToken,
        })
        for (const batch of batches) {
          try {
            await applyHistoricalPaymentAllocations.mutateAsync(batch)
          } catch (cause) {
            const detail = cause instanceof Error ? cause.message : String(cause)
            throw new Error(
              `Documents were imported and posted, but payment transaction ${batch.paymentTransactionId} could not be replayed. Correct the payment and retry this file; completed batches are idempotent. ${detail}`,
            )
          }
        }
      }
    },
    [
      applyHistoricalPaymentAllocations,
      manualInvoiceCurrencyId,
      operatingCompanyId,
      postMove,
      submitAccountMoveBundle,
    ],
  )

  const csvFormConfig = useMemo(() => {
    if (!csvKind) return null
    const titleKey: Record<AccountingCsvImportKind, string> = {
      account: "accounting.csvImport.accountsTitle",
      accountMove: "accounting.csvImport.movesTitle",
      outstandingDocuments: "accounting.csvImport.outstandingDocumentsTitle",
      historicalDocumentsForPaymentReplay:
        "accounting.csvImport.historicalDocumentsForPaymentReplayTitle",
      accountMoveLine: "accounting.csvImport.moveLinesTitle",
      tax: "accounting.csvImport.taxTitle",
      budget: "accounting.csvImport.budgetTitle",
      budgetLine: "accounting.csvImport.budgetLineTitle",
      analytic: "accounting.csvImport.analyticTitle",
    }
    return csvImportForm(
      t,
      t(titleKey[csvKind]),
      csvKind === "accountMove"
        ? t("accounting.csvImport.movesBundleDescription")
        : csvKind === "outstandingDocuments"
          ? t("accounting.csvImport.outstandingDocumentsDescription")
          : csvKind === "historicalDocumentsForPaymentReplay"
            ? t("accounting.csvImport.historicalDocumentsForPaymentReplayDescription")
            : undefined,
    )
  }, [csvKind, t])

  // ── Config: inject rich custom content for invoices/bills/accounts/ledger ───
  const authoringCompanyLabel = companies.find((company) => company.id === operatingCompanyId)?.name
    ?? t("accounting.authoring.companyId", { defaultValue: "Company {{id}}", id: String(operatingCompanyId) })

  const config = useMemo(
    () => {
      // Omit `tabs` from spread so static analysis (and runtime) only see the mapped tabs below.
      const { tabs: _ignoreBaseTabs, ...moduleWithoutTabs } = moduleConfigBase
      return {
        ...moduleWithoutTabs,
        tabs: (() => {
          const mapped = moduleConfigBase.tabs.map((tab) => {
            if (tab.id === "dashboard") {
              return { ...tab, type: "custom" as const, customContent: <div className="space-y-8">{accountantOverview}<section aria-label="Financial charts" data-testid="accounting-finance-charts" className="grid grid-cols-1 gap-4 lg:grid-cols-3">{financeChartSections.flatMap((section) => section.widgets.map((widget) => <DashboardWidgetRenderer key={widget.id} widget={widget} widthClass={widget.width === "full" ? "lg:col-span-3" : widget.width === "2/3" ? "lg:col-span-2" : "lg:col-span-1"} />))}</section></div> }
            }
            if (tab.id === "analytic-lines") {
              return {
                ...tab,
                createForm: analyticLineFormConfig,
                entityConfig: analyticLinesTableConfig(t, { accountLabelMap: analyticAccountLabelMap }),
              }
            }
            if (tab.id === "analytic") {
              return { ...tab, createForm: newAnalyticAccountFormConfig }
            }
            if (tab.id === "analytic-distribution") {
              return { ...tab, createForm: analyticDistFormConfig }
            }
            if (tab.id === "invoices") {
              const { createForm: _cf, createAction: _ca, createLabel: _cl, ...tabRest } = tab
              return {
                ...tabRest,
                type: "custom" as const,
                customContent: (
                  <div className="space-y-8">
                  <ListPivotSwitch
                    storageId={`accounting-invoices-list:${organizationId}:${operatingCompanyId}:${currentUser?.id ?? "session"}`}
                    t={t}
                    rows={copyAsRecords(invoices)}
                    {...accountMovePivotSetup(t)}
                  >
                  <InvoiceListView
                    invoices={invoices}
                    worklistScope={{ organizationId, companyId: operatingCompanyId, userId: currentUser?.id }}
                    sourceState={mergeModuleStates([allMovesRead.state, currenciesRead.state])}
                    currencyOptions={invoiceCurrencyOptions}
                    initialFilters={invoiceFilters}
                    onInitialFilterClear={clearInvoiceFilter}
                    onSelectInvoice={(invoice) => setInvoiceSheetRecord(copyAsRecord(invoice))}
                    onCreateInvoice={openInvoiceCreate}
                    onSendInvoice={(inv) => void handleInvoiceSendEmail(inv)}
                    onDownloadPdf={(inv) => void handleInvoiceDownloadPdf(inv)}
                    onRecalculateTotals={(inv) =>
                      void runMutation(() => computeInvoiceTotals.mutateAsync(inv.id as string | number | bigint))
                    }
                  />
                  </ListPivotSwitch>
                  <CollectionsWorkspace
                    invoices={invoices}
                    scope={{ organizationId, companyId: operatingCompanyId }}
                    dataState={mergeModuleStates([allMovesRead.state, currenciesRead.state])}
                    currencyOptions={invoiceCurrencyOptions}
                    canReview={checkPermission("account_move", "read").allowed && checkPermission("mail_template", "read").allowed
                      && checkPermission("mail_template", "write").allowed && checkPermission("mail_message", "read").allowed}
                    onReviewReminder={(invoice) => router.push(`/accounting/invoices/${invoice.id}?reminder=1`)}
                  />
                  </div>
                ),
              }
            }
            if (tab.id === "bills") {
              const { createForm: _cf, createAction: _ca, createLabel: _cl, ...tabRest } = tab
              return {
                ...tabRest,
                type: "custom" as const,
                customContent: (
                  <ListPivotSwitch
                    storageId={`accounting-bills-list:${organizationId}:${operatingCompanyId}:${currentUser?.id ?? "session"}`}
                    t={t}
                    rows={copyAsRecords(bills)}
                    {...accountMovePivotSetup(t)}
                  >
                  <BillsListView
                    bills={bills}
                    intake={{ lines: accountMoveLines, sourceState: mergeModuleStates([allMovesRead.state, accountMoveLinesRead.state]),
                      renderDocuments: (bill) => <BillDocumentIntake organizationId={orgId} companyId={operatingCompanyId} billId={bill.id} partnerId={bill.partnerId} /> }}
                    worklistScope={{ organizationId, companyId: operatingCompanyId, userId: currentUser?.id }}
                    sourceState={mergeModuleStates([allMovesRead.state, currenciesRead.state])}
                    currencyOptions={invoiceCurrencyOptions}
                    initialFilters={invoiceFilters}
                    onInitialFilterClear={clearInvoiceFilter}
                    onCreateBill={openBillCreate}
                    onSelectBill={(bill) => setInvoiceSheetRecord(copyAsRecord(bill))}
                    onPayBill={openBillPayment}
                    onDownloadBill={(bill) => void handleInvoiceDownloadPdf(bill)}
                    onRecalculateTotals={(bill) =>
                      void runMutation(() => computeInvoiceTotals.mutateAsync(bill.id as string | number | bigint))
                    }
                  />
                  </ListPivotSwitch>
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
                    accounts={accounts}
                    chartStructureContent={chartStructurePanel}
                    onImportAccountsCsv={canImportCsv("account") ? () => setCsvKind("account") : undefined}
                    onAccountClick={(account) => setGlDrilldownAccount(account)}
                    onToggleDeprecated={
                      checkPermission("account_account", "write").allowed ? toggleAccountDeprecated : undefined
                    }
                    onEdit={checkPermission("account_account", "write").allowed ? editAccount : undefined}
                    onCreate={accountTypes.length > 0 ? async (data) => {
                      const p = toCreateAccountAccountParams(data as Record<string, unknown>, {
                        companyId: operatingCompanyId,
                        accountTypes,
                      })
                      if (!p) throw new Error("Account type configuration is unavailable")
                      await createAccount.mutateAsync(p)
                    } : undefined}
                  />
                ),
              }
            }
            if (tab.id === "journal-entries") {
              const { createForm: _cf, createAction: _ca, createLabel: _cl, ...tabRest } = tab
              return {
                ...tabRest,
                recordSheet: accountMoveRecordSheet,
                type: "custom" as const,
                customContent: (
                  <GeneralLedgerView
                    moves={allMoves}
                    onImportMovesCsv={canImportCsv("accountMove") ? openAccountingMoveImport : undefined}
                    onImportOutstandingDocumentsCsv={
                      canImportCsv("accountMove") && canImportCsv("accountMoveLine")
                        ? openOutstandingDocumentImport
                        : undefined
                    }
                    onImportHistoricalDocumentsForPaymentReplayCsv={
                      HISTORICAL_PAYMENT_REPLAY_CALLABLE &&
                      canImportCsv("accountMove") &&
                      canImportCsv("accountMoveLine") &&
                      checkPermission("account_move", "write").allowed &&
                      checkPermission("payment_transaction", "read").allowed &&
                      checkPermission("payment_reconciliation", "create").allowed
                        ? openHistoricalDocumentPaymentReplayImport
                        : undefined
                    }
                    onImportMoveLinesCsv={canImportCsv("accountMoveLine") ? openAccountingMoveLineImport : undefined}
                    onCreate={() => setQuickActionForm({ form: journalEntryFormConfig, action: "createMove" })}
                    onPostMove={(move) => postDraft(move)}
                    onCancelMove={(move) =>
                      void runMutation(() => cancelMove.mutateAsync(move.id as string | number | bigint))
                    }
                    onComputeInvoiceTotals={(move) =>
                      void runMutation(() => computeInvoiceTotals.mutateAsync(move.id as string | number | bigint))
                    }
                    postMovePending={postMove.isPending || invoiceToPayment.isPending}
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
                      {canImportCsv("budget") ? (
                        <Button type="button" variant="outline" onClick={() => setCsvKind("budget")}>
                          {t("accounting.csvImport.toolbarBudgets")}
                        </Button>
                      ) : null}
                      {canImportCsv("budgetLine") ? (
                        <Button type="button" variant="outline" onClick={() => setCsvKind("budgetLine")}>
                          {t("accounting.csvImport.toolbarBudgetLines")}
                        </Button>
                      ) : null}
                    </div>
                    <BudgetsWorkspace
                      budgets={budgets}
                      budgetLines={budgetLines}
                      budgetPosts={budgetPosts}
                      accountOptions={glAccountSelectOptions}
                      onCreateBudget={(params) =>
                        createBudget.mutateAsync(toCreateCrossoveredBudgetParams(params, operatingCompanyId))
                      }
                      onUpdateBudget={(budgetId, params) =>
                        updateBudget.mutateAsync({
                          budgetId,
                          params: toUpdateBudgetParams(params),
                        })
                      }
                      onCreateBudgetLine={(budgetId, params) =>
                        createBudgetLine.mutateAsync({
                          budgetId,
                          params: toCreateCrossoveredBudgetLineParams(params),
                        })
                      }
                      onUpdateBudgetLine={(lineId, params) =>
                        updateBudgetLine.mutateAsync({
                          lineId,
                          params: toUpdateBudgetLineParams(params),
                        })
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
                    {currentSelectedFixedAsset ? (
                      <div className="flex flex-col gap-4">
                        <AssetDepreciationSchedule
                          key={String(currentSelectedFixedAsset.id)}
                          asset={currentSelectedFixedAsset}
                          lines={depreciationLines}
                          companyId={operatingCompanyId}
                          dataState={mergeModuleStates([fixedAssetsRead.state, depreciationLinesRead.state])}
                          currencyLabel={currencySelectOptions.find((option) => option.value === String(currentSelectedFixedAsset.currencyId))?.label}
                          onGenerate={checkPermission("account_asset", "write").allowed ? async () => { await computeDepreciationBoard.mutateAsync(BigInt(String(currentSelectedFixedAsset.id))) } : undefined}
                          generationPending={computeDepreciationBoard.isPending}
                          onRefresh={async () => { const result = await depreciationLinesQuery.refetch(); if (result.isError) throw result.error }}
                        />
                      <div className="rounded-lg border p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm text-muted-foreground">
                            {t("accounting.entities.depreciationSchedule.title")}
                            {" — "}
                            <span className="font-medium text-foreground">
                              {String(currentSelectedFixedAsset.name ?? currentSelectedFixedAsset.id ?? "")}
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
                // The controller lives below ModuleView so tab changes cannot unmount
                // an in-flight or uncertain payment allocation.
                customContent: null,
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
                organizationId={orgId}
                companyId={operatingCompanyId}
                fiscalYears={fiscalYearsRaw as Record<string, unknown>[]}
                accountPeriods={accountPeriodsRaw as Record<string, unknown>[]}
                moves={allMoves as Record<string, unknown>[]}
                bankStatements={bankStatements as Record<string, unknown>[]}
                bankStatementLines={bankStatementLines as Record<string, unknown>[]}
                financialReports={financialReportsRaw as Record<string, unknown>[]}
                sourceStates={{ fiscalYears: fiscalYearsRawRead.state, accountPeriods: accountPeriodsRawRead.state,
                  moves: allMovesRead.state, bankStatements: bankStatementsRead.state,
                  bankStatementLines: bankStatementLinesRead.state, financialReports: financialReportsRead.state }}
                onNavigateToTab={setAccountingActiveTab}
                companyLabel={authoringCompanyLabel}
                dataState={mergeModuleStates([fiscalYearsRawRead.state, accountPeriodsRawRead.state, allMovesRead.state, bankStatementsRead.state, bankStatementLinesRead.state, financialReportsRead.state])}
                onClosePeriod={checkPermission("account_period", "write").allowed ? async (periodId) => {
                  await closeAccountPeriod.mutateAsync(periodId)
                  const result = await accountPeriodsQuery.refetch()
                  if (result.isError) throw result.error
                } : undefined}
                closePending={closeAccountPeriod.isPending}
                onInspectBankLine={(statementId, lineId) => {
                  const statements = bankStatements.filter((statement) => String(statement.id) === statementId && String(statement.companyId) === String(operatingCompanyId))
                  const lines = bankStatementLines.filter((line) => String(line.id) === lineId && String(line.statementId) === statementId)
                  if (statements.length !== 1 || lines.length !== 1) return
                  setBankLineMatchFocus(lines[0]!)
                  setBankStatementDetail(statements[0]!)
                }}
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
      accountantOverview,
      financeChartSections,
      invoiceCurrencyOptions,
      invoiceFilters,
      clearInvoiceFilter,
      currentUser?.id,
      allMovesRead.state,
      currenciesRead.state,
      accountMoveLinesRead.state,
      fiscalYearsRawRead.state,
      accountPeriodsRawRead.state,
      bankStatementsRead.state,
      bankStatementLinesRead.state,
      financialReportsRead.state,
      router,
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
      currentSelectedFixedAsset,
      depreciationLinesQuery.refetch,
      fixedAssetsRead.state,
      depreciationLinesRead.state,
      allMovesRead.state,
      accountsRead.state,
      accountMoveLinesRead.state,
      fiscalYearsRawRead.state,
      accountPeriodsRawRead.state,
      bankStatementsRead.state,
      bankStatementLinesRead.state,
      financialReportsRead.state,
      closeAccountPeriod,
      computeDepreciationBoard,
      checkPermission,
      authoringCompanyLabel,
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
      openInvoiceCreate,
      openBillCreate,
      openAccountingMoveImport,
      openAccountingMoveLineImport,
      openOutstandingDocumentImport,
      openHistoricalDocumentPaymentReplayImport,
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

  const renderAccountingAuthoringPreview = (values: FormValues, form: FormConfig) => {
    if (!hasAccountingAuthoringPreview(form.id)) return null
    const selectedJournal = journals.find((journal) => String(journal.id) === String(values.journalId ?? ""))
    const currencyId = String(selectedJournal?.currencyId ?? defaultCurrencyId)
    return <AccountingAuthoringPreview
      key={form.id}
      config={form}
      values={values}
      companyId={String(operatingCompanyId)}
      companyLabel={authoringCompanyLabel}
      currencyLabel={currencySelectOptions.find((option) => option.value === currencyId)?.label ?? "—"}
      moves={allMoves}
      moveLines={accountMoveLines}
      ledgerLoaded={canUseModuleData(allMovesRead.state) && canUseModuleData(accountMoveLinesRead.state)}
    />
  }

  return (
    <ReconciliationMoveLineProvider value={reconciliationSelectionContext}>
      {activeTabUsable && formDialog}
      {companyAvailable ? <AccountingSetupReadinessPanel
        setup={accountingSetup}
        compact={readinessAction === undefined && !config.tabGroups?.find((group) => group.tabIds.includes("taxes"))?.tabIds.includes(accountingActiveTab)}
        action={readinessAction}
        onResolve={handleReadinessResolve}
        className="mb-4"
      /> : <p role="status" className="rounded-lg border p-4 text-sm">Select an active company to continue. Original pending operations have been retained.</p>}
      {companyAvailable ? <ModuleView
        config={config}
        data={data}
        dataLoading={dataLoading}
        dataState={dataState}
        onFormSubmit={handleFormSubmit}
        renderCreatePreview={(_tabId, values, form) => renderAccountingAuthoringPreview(values, form)}
        onRowClick={handleEntityRowClick}
        activeTab={accountingActiveTab}
        onActiveTabChange={setAccountingActiveTab}
        onOpenFormChange={setModuleFormWorkspace}
        runtimeForms={{
          organizationId,
          roleId: runtimeRoleId,
        }}
      /> : null}

      {(accountingActiveTab === "payment-operations" && dataState["payment-operations"].status === "ready") || paymentOperationsLocked ? (
        <section className="mt-6 space-y-3" aria-label="Payment operations">
          {accountingActiveTab !== "payment-operations" ? <p role="status" className="rounded-lg border p-3 text-sm">The original payment operation is retained here until its result is confirmed.</p> : null}
          <PaymentOperationsPanel
            organizationId={organizationId}
            companyId={operatingCompanyId}
            defaultCurrencyId={defaultCurrencyId}
            currencyOptions={currencySelectOptions}
            journalOptions={journalFieldOptionsForModularForm}
            glAccountOptions={glAccountFieldOptions}
            partnerOptions={partnerSelectOptions}
            moveLines={accountMoveLines}
            moves={allMoves}
            glAccounts={accounts}
            lookupDataReady={allMovesRead.state.status === "ready" && accountsRead.state.status === "ready" && accountMoveLinesRead.state.status === "ready"}
            onRecoveryLockChange={setPaymentOperationsLocked}
            scopeAvailable={companyAvailable}
          />
        </section>
      ) : null}

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

      {csvKind && csvUsable && csvFormConfig ? (
        <CsvImportModal
          fileReader={readImportFile}
          trackedImport={
            csvKind === "accountMove" ||
            csvKind === "outstandingDocuments" ||
            csvKind === "historicalDocumentsForPaymentReplay"
              ? undefined
              : { companyId: operatingCompanyId }
          }
          organizationId={orgId}
          companyId={operatingCompanyId}
          abandonedAccountingCleanup={
            (csvKind === "accountMove" ||
              csvKind === "outstandingDocuments" ||
              csvKind === "historicalDocumentsForPaymentReplay") &&
            operatingCompanyId > 0n &&
            checkPermission("account_move", "delete").allowed
              ? {
                  companyId: operatingCompanyId,
                  authorized: true,
                  pendingJobId: cleanupAbandonedImport.isPending
                    ? String(cleanupAbandonedImport.variables ?? "")
                    : null,
                  onCleanup: (parentJobId) =>
                    cleanupAbandonedImport.mutateAsync(parentJobId),
                }
              : undefined
          }
          tableName={{
            account: "account_account",
            accountMove: "account_move_line",
            outstandingDocuments: "account_move_line",
            historicalDocumentsForPaymentReplay: "account_move_line",
            accountMoveLine: "account_move_line",
            tax: "account_tax",
            budget: "crossovered_budget",
            budgetLine: "crossovered_budget_lines",
            analytic: "account_analytic_account",
          }[csvKind]}
          key={csvKind}
          onClose={() => setCsvKind(null)}
          config={csvFormConfig}
          columns={
            csvKind === "accountMove"
              ? ACCOUNT_MOVE_BUNDLE_COLUMNS
              : csvKind === "outstandingDocuments"
                ? OUTSTANDING_DOCUMENT_IMPORT_COLUMNS
                : csvKind === "historicalDocumentsForPaymentReplay"
                  ? HISTORICAL_PAYMENT_REPLAY_IMPORT_COLUMNS
                  : CSV_IMPORT_CONTRACTS[
                      csvKind === "tax"
                        ? "taxRate"
                        : csvKind === "analytic"
                          ? "analyticAccount"
                          : csvKind
                    ]
          }
          templateFileName={
            csvKind === "accountMove"
              ? "accounting-journal-entry-with-lines-template.csv"
              : csvKind === "outstandingDocuments"
                ? "accounting-outstanding-invoices-and-bills-template.csv"
                : csvKind === "historicalDocumentsForPaymentReplay"
                  ? "accounting-historical-invoices-and-bills-payment-replay-template.csv"
                  : `accounting-${csvKind}-import-template.csv`
          }
          onImport={async (text) => {
            if (csvKind === "account") await csvImports.importAccount.mutateAsync(text)
            else if (csvKind === "accountMove") await importAccountMoveBundle(text)
            else if (csvKind === "outstandingDocuments")
              await importOutstandingDocuments(text, "cutover_open_residual")
            else if (csvKind === "historicalDocumentsForPaymentReplay")
              await importOutstandingDocuments(text, "reconstruct_original_total")
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
        organizationId={organizationId}
        draftPersonalization={draftInvoicePersonalization?.personalization}
        draftPersonalizationState={selectedInvoice && ["OutInvoice", "OutRefund"].includes(selectedInvoiceMoveType)
          ? draftInvoicePersonalization?.personalizationError ? { status: "error", message: draftInvoicePersonalization.personalizationError } : selectedDraftReviewState
          : undefined}
        currencyId={selectedInvoice ? String(selectedInvoice.currencyId ?? "") : undefined}
        currencyCode={selectedInvoice ? invoiceCurrencyOptions.find((currency) => currency.value === String(selectedInvoice.currencyId))?.code : undefined}
        open={!!selectedInvoice}
        onClose={() => setSelectedInvoice(null)}
        onPostDraft={selectedInvoice ? () => {
          if (["OutInvoice", "OutRefund"].includes(selectedInvoiceMoveType) && (selectedDraftReviewState.status !== "ready" || !draftInvoicePersonalization?.personalization)) return
          postDraft(selectedInvoice)
        } : undefined}
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
        onSendEmail={selectedInvoice && ["OutInvoice", "OutRefund"].includes(selectedInvoiceMoveType)
          && enumTag(selectedInvoice.state) === "Posted"
          && checkPermission("mail_template", "read").allowed && checkPermission("mail_template", "write").allowed
          ? handleInvoiceSendEmail : undefined}
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
        kind="invoice"
        companyId={operatingCompanyId}
        onClose={() => setShowCreateInvoice(false)}
        organizationId={organizationId}
        profile={invoicePersonalization.profile}
        profileVersionIds={invoicePersonalization.profileVersionIds}
        seller={invoiceSeller}
        personalizationState={draftReviewState}
        journalOptions={manualInvoiceOptions.invoice.journals}
        currencyOptions={invoiceCurrencyOptions}
        partnerOptions={manualInvoiceOptions.invoice.partners}
        counterpartAccountOptions={manualInvoiceOptions.invoice.counterpart}
        lineAccountOptions={manualInvoiceOptions.invoice.commercial}
        taxOptions={manualInvoiceOptions.invoice.taxes}
        productOptions={manualInvoiceOptions.invoice.products}
        paymentTermOptions={paymentTermSelectOptions.filter((option) => option.value !== "")}
        onSave={async (params: CreateManualAccountInvoiceParams) => {
          const outcome = await createManualInvoice.mutateAsync(params)
          if (outcome.kind === "converged" || outcome.kind === "already-applied") {
            await persistAccountMoveCustomFieldsExact(params.metadata, outcome.ref.id, params.companyId)
          }
          return outcome
        }}
        onCheckStatus={async (params) => {
          const ref = await readManualAccountInvoiceEffect(params.companyId, params.idempotencyKey)
          if (ref) await persistAccountMoveCustomFieldsExact(params.metadata, ref.id, params.companyId)
          return ref
        }}
        onResolved={(ref) => ref.href && router.push(ref.href)}
      />

      {/* Create bill (same form, different move type) */}
      <CreateInvoiceModal
        open={showCreateBill}
        kind="bill"
        companyId={operatingCompanyId}
        onClose={() => setShowCreateBill(false)}
        organizationId={organizationId}
        journalOptions={manualInvoiceOptions.bill.journals}
        currencyOptions={invoiceCurrencyOptions}
        partnerOptions={manualInvoiceOptions.bill.partners}
        counterpartAccountOptions={manualInvoiceOptions.bill.counterpart}
        lineAccountOptions={manualInvoiceOptions.bill.commercial}
        taxOptions={manualInvoiceOptions.bill.taxes}
        productOptions={manualInvoiceOptions.bill.products}
        paymentTermOptions={paymentTermSelectOptions.filter((option) => option.value !== "")}
        onSave={async (params: CreateManualAccountInvoiceParams) => {
          const outcome = await createManualInvoice.mutateAsync(params)
          if (outcome.kind === "converged" || outcome.kind === "already-applied") {
            await persistAccountMoveCustomFieldsExact(params.metadata, outcome.ref.id, params.companyId)
          }
          return outcome
        }}
        onCheckStatus={async (params) => {
          const ref = await readManualAccountInvoiceEffect(params.companyId, params.idempotencyKey)
          if (ref) await persistAccountMoveCustomFieldsExact(params.metadata, ref.id, params.companyId)
          return ref
        }}
        onResolved={(ref) => ref.href && router.push(ref.href)}
      />

      {/* Dashboard quick-action form modal */}
      <RuntimeFormModal
        open={quickActionForm !== null && quickActionUsable}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        staticConfig={quickActionForm?.form ?? journalEntryFormConfig}
        renderPreview={(values) => renderAccountingAuthoringPreview(values, quickActionForm?.form ?? journalEntryFormConfig)}
        closeOnSubmit={false}
        showSubmitSuccessToast={false}
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
        renderPreview={(values) => renderAccountingAuthoringPreview(values, paymentTermLineEditFormConfig)}
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
          if (!open && !bankLinkLockRef.current) {
            setBankStatementDetail(null)
            setBankLineCreateOpen(false)
            setBankLineMatchFocus(null)
          }
        }}
      >
        <DialogContent className="max-h-[94dvh] max-w-[calc(100%-1rem)] overflow-y-auto sm:max-w-6xl [&_button]:min-h-11 [&_button]:min-w-11">
          <DialogHeader>
            <DialogTitle>
              {t("accounting.bankStatementDetail.title")}
              {bankLinkSource.state.status === "ready" && currentBankStatement
                ? ` — ${currentBankStatement.name || `Statement #${currentBankStatement.id}`}`
                  : ""}
            </DialogTitle>
          </DialogHeader>
          {currentBankStatement && bankLinkSource.state.status === "ready" ? (
            <fieldset disabled={bankLinkLocked} className="min-w-0 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div>
                  <span className="text-muted-foreground">{t("accounting.entities.bankStatements.columns.state")}</span>
                  <div className="font-medium">{enumTag(currentBankStatement.state)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("accounting.entities.bankStatements.columns.balanceStart")}</span>
                  <div className="font-medium">{bankStatementMoney(currentBankStatement.balanceStart)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("accounting.entities.bankStatements.columns.balanceEndReal")}</span>
                  <div className="font-medium">{bankStatementMoney(currentBankStatement.balanceEndReal)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("accounting.entities.bankStatements.columns.balanceEnd")}</span>
                  <div className="font-medium">{bankStatementMoney(currentBankStatement.balanceEnd)}</div>
                </div>
              </div>
              {enumTag(currentBankStatement.state) === "Open" && !statementBalancesMatch ? (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-900 dark:text-amber-100">
                  {t("accounting.bankStatementDetail.balanceMismatch")}
                </p>
              ) : null}
              {enumTag(currentBankStatement.state) === "Posted" ? (
                <p className="text-muted-foreground">{t("accounting.bankStatementDetail.postedHint")}</p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    enumTag(currentBankStatement.state) !== "Open" ||
                    !statementBalancesMatch ||
                    detailStatementLines.some((line) => Array.isArray(line.paymentIds) && line.paymentIds.length > 0 && !line.isReconciled) ||
                    postBankStatement.isPending
                  }
                  onClick={async () => {
                    if (!currentBankStatement.id) return
                    await postBankStatement.mutateAsync(BigInt(String(currentBankStatement.id)))
                    setBankStatementDetail(null)
                  }}
                >
                  {t("accounting.actions.postStatement")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={enumTag(currentBankStatement.state) === "Posted" || deleteBankStatement.isPending
                    || detailStatementLines.some((line) => Array.isArray(line.paymentIds) && line.paymentIds.length > 0)}
                  onClick={async () => {
                    if (!currentBankStatement.id) return
                    if (!(await confirmDialog({ description: t("accounting.bankStatementDetail.deleteStatementConfirm") }))) return
                    void runMutation(() => deleteBankStatement.mutateAsync(BigInt(String(currentBankStatement.id)))).then(
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
                  disabled={enumTag(currentBankStatement.state) === "Posted"}
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
                          const linkedPaymentIds = lineRow.paymentIds ?? lineRow.payment_ids
                          const settlementLinked = Array.isArray(linkedPaymentIds) && linkedPaymentIds.length > 0
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
                                  {line.isReconciled && !settlementLinked ? (
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
                                {settlementLinked ? <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                                  {line.isReconciled
                                    ? t("accounting.bankStatementDetail.settlementLocked", { defaultValue: "Settlement confirmed. Editing, unlinking and reversal are unavailable in this alpha." })
                                    : t("accounting.bankStatementDetail.settlementPending", { defaultValue: "Payment awaiting approval or settlement completion. Use Focus line to continue." })}
                                </p> : null}
                              </td>
                              <td className="p-2">
                                <div className="flex flex-wrap gap-1">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2"
                                    disabled={enumTag(currentBankStatement.state) === "Posted" || settlementLinked}
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
                                      enumTag(currentBankStatement.state) === "Posted" ||
                                      settlementLinked ||
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

            </fieldset>
          ) : null}
          <ReconciliationWorkbench
            actorKey={currentUser?.id ?? null}
            source={bankLinkSource}
            canReconcile={canLinkBankRecords}
            canRecover={(action: BankSettlementRecoveryAction) => bankRecoveryPermissions[action]}
            onConfirm={confirmBankLink}
            onRecover={recoverReviewedBankSettlement}
            onCheckStatus={checkBankLink}
            onOperationLockChange={handleBankLinkLock}
          />
          <DialogFooter className="sm:justify-end">
            <Button type="button" variant="outline" disabled={bankLinkLocked} onClick={() => { if (!bankLinkLockRef.current) setBankStatementDetail(null) }}>
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
    </ReconciliationMoveLineProvider>
  )
}

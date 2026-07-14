import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * Accounting mutations via Next.js BFF `POST /api/call/:reducer`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` accounting hooks.
 */
export const ACCOUNTING_BFF_REDUCERS = [
  "add_account_move_line",
  "apply_reconciliation_rules",
  "approve_intercompany_transaction",
  "approve_bank_statement_import",
  "cancel_account_move",
  "cancel_budget",
  "cancel_consolidation",
  "cancel_intercompany_transaction",
  "cancel_payment",
  "close_account_asset",
  "close_account_period",
  "close_fiscal_year",
  "complete_intercompany_transaction",
  "complete_tax_deadline",
  "compute_depreciation_board",
  "compute_invoice_totals",
  "confirm_account_asset",
  "confirm_budget",
  "create_account_account",
  "create_account_account_type",
  "create_account_asset",
  "create_account_bank_statement",
  "create_account_bank_statement_line",
  "create_account_group",
  "create_account_journal",
  "create_account_move",
  "create_account_period",
  "create_account_reconciliation_widget",
  "create_account_tax",
  "create_account_tax_group",
  "create_analytic_account",
  "create_analytic_distribution_model",
  "create_analytic_line",
  "create_budget_line",
  "create_budget_post",
  "create_consolidation_account",
  "create_consolidation_journal",
  "create_credit_note_from_invoice",
  "create_crossovered_budget",
  "create_currency_rate",
  "create_depreciation_line",
  "create_elimination_entry",
  "create_fiscal_year",
  "create_intercompany_rule",
  "create_intercompany_transaction",
  "create_payment",
  "create_payment_account",
  "create_payment_fee",
  "create_payment_transaction",
  "create_payment_term",
  "create_payment_term_line",
  "create_tax_deadline",
  "create_tax_jurisdiction",
  "create_tax_schedule",
  "delete_account_asset",
  "delete_account_bank_statement",
  "delete_account_bank_statement_line",
  "delete_account_move_line",
  "delete_account_period",
  "delete_account_reconciliation_widget",
  "delete_analytic_line",
  "delete_budget_line",
  "delete_fiscal_year",
  "delete_intercompany_rule",
  "delete_payment_term",
  "delete_payment_term_line",
  "delete_tax_deadline",
  "deprecate_account_account",
  "dispose_account_asset",
  "done_budget",
  "error_intercompany_transaction",
  "import_account_csv",
  "import_account_move_csv",
  "import_account_move_line_csv",
  "import_analytic_account_csv",
  "import_budget_csv",
  "import_budget_line_csv",
  "import_tax_rate_csv",
  "match_bank_line",
  "match_elimination_entries",
  "open_account_period",
  "open_fiscal_year",
  "post_account_bank_statement",
  "post_account_move",
  "post_invoice",
  "post_payment",
  "post_payment_transaction",
  "process_consolidation",
  "process_intercompany_transaction",
  "reconcile_account_bank_statement_line",
  "reconcile_payment_with_invoice",
  "allocate_payment_transaction",
  "archive_payment_account",
  "reverse_payment_transaction",
  "refresh_tax_deadline_statuses",
  "register_payment_on_invoice",
  "retry_intercompany_transaction",
  "schedule_tax_deadline_updates",
  "setup_fiscal_calendar",
  "set_analytic_account_active",
  "set_asset_active",
  "set_consolidation_company_rate",
  "stage_bank_statement_import",
  "set_intercompany_rule_active",
  "unmatch_elimination_entry",
  "unreconcile_account_bank_statement_line",
  "unreconciled_account_bank_statement_line",
  "update_account_account",
  "update_account_account_type",
  "update_account_asset",
  "update_account_bank_statement",
  "update_account_bank_statement_line",
  "update_account_group",
  "update_account_journal",
  "update_account_move_line",
  "update_account_period",
  "update_account_reconciliation_widget",
  "update_account_tax",
  "update_account_tax_group",
  "update_analytic_account",
  "update_analytic_distribution_model",
  "update_analytic_line",
  "update_budget_line",
  "update_budget_line_actuals",
  "update_budget_post",
  "update_consolidation_account",
  "update_crossovered_budget",
  "update_fiscal_year",
  "update_intercompany_rule",
  "update_payment_term",
  "update_payment_account",
  "update_payment_transaction",
  "update_payment_term_line",
  "update_tax_deadline",
  "update_tax_jurisdiction",
  "update_tax_schedule",
  "validate_budget",
  "validate_consolidation",
  "void_payment_transaction",
  "waive_tax_deadline",
] as const;

export type AccountingBffReducerKey = (typeof ACCOUNTING_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<AccountingBffReducerKey>([
  "post_account_bank_statement",
  "delete_account_bank_statement",
  "create_account_bank_statement_line",
  "update_account_bank_statement_line",
  "delete_account_bank_statement_line",
  "reconcile_account_bank_statement_line",
  "unreconciled_account_bank_statement_line",
  "create_account_reconciliation_widget",
  "update_account_reconciliation_widget",
  "delete_account_reconciliation_widget",
]);

/** Same-origin path used by `apiFetch` in the web app. */
export function accountingBffCallUrl(reducer: AccountingBffReducerKey): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

export function accountingBffPost(
  reducer: AccountingBffReducerKey,
  args: unknown[],
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: accountingBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCallBody(args),
    },
  };
}

function accountingReducerHints(): Record<AccountingBffReducerKey, readonly string[]> {
  const o = {} as Record<AccountingBffReducerKey, readonly string[]>
  o["add_account_move_line"] = ["account-moves","account-move-lines"] as const
  o["apply_reconciliation_rules"] = []
  o["approve_intercompany_transaction"] = []
  o["approve_bank_statement_import"] = ["bank-statements","bank-statement-lines","bank-match-candidates","account-reconciliation-widgets"] as const
  o["cancel_account_move"] = ["account-moves","account-move-lines"] as const
  o["cancel_budget"] = []
  o["cancel_consolidation"] = []
  o["cancel_intercompany_transaction"] = []
  o["cancel_payment"] = []
  o["close_account_asset"] = []
  o["close_account_period"] = []
  o["close_fiscal_year"] = []
  o["complete_intercompany_transaction"] = []
  o["complete_tax_deadline"] = []
  o["compute_depreciation_board"] = []
  o["compute_invoice_totals"] = []
  o["confirm_account_asset"] = []
  o["confirm_budget"] = []
  o["create_account_account"] = ["account-accounts"] as const
  o["create_account_account_type"] = []
  o["create_account_asset"] = ["fixed-assets","depreciation-lines"] as const
  o["create_account_bank_statement"] = ["bank-statements","bank-statement-lines","bank-match-candidates","account-reconciliation-widgets"] as const
  o["create_account_bank_statement_line"] = []
  o["create_account_group"] = []
  o["create_account_journal"] = ["account-journals"] as const
  o["create_account_move"] = ["account-moves","account-move-lines"] as const
  o["create_account_period"] = []
  o["create_account_reconciliation_widget"] = []
  o["create_account_tax"] = ["account-taxes","tax-groups","tax-jurisdictions","tax-schedules","tax-deadlines"] as const
  o["create_account_tax_group"] = []
  o["create_analytic_account"] = []
  o["create_analytic_distribution_model"] = []
  o["create_analytic_line"] = []
  o["create_budget_line"] = ["budgets","budget-lines","budget-posts"] as const
  o["create_budget_post"] = []
  o["create_consolidation_account"] = []
  o["create_consolidation_journal"] = []
  o["create_credit_note_from_invoice"] = ["account-moves","account-move-lines"] as const
  o["create_crossovered_budget"] = []
  o["create_currency_rate"] = []
  o["create_depreciation_line"] = []
  o["create_elimination_entry"] = []
  o["create_fiscal_year"] = []
  o["create_intercompany_rule"] = []
  o["create_intercompany_transaction"] = []
  o["create_payment"] = []
  o["create_payment_account"] = ["payment-accounts"] as const
  o["create_payment_fee"] = ["payment-fees","payment-transactions"] as const
  o["create_payment_transaction"] = ["payment-transactions"] as const
  o["create_payment_term"] = []
  o["create_payment_term_line"] = []
  o["create_tax_deadline"] = []
  o["create_tax_jurisdiction"] = []
  o["create_tax_schedule"] = []
  o["delete_account_asset"] = []
  o["delete_account_bank_statement"] = []
  o["delete_account_bank_statement_line"] = []
  o["delete_account_move_line"] = ["account-moves","account-move-lines"] as const
  o["delete_account_period"] = []
  o["delete_account_reconciliation_widget"] = []
  o["delete_analytic_line"] = []
  o["delete_budget_line"] = []
  o["delete_fiscal_year"] = []
  o["delete_intercompany_rule"] = []
  o["delete_payment_term"] = []
  o["delete_payment_term_line"] = []
  o["delete_tax_deadline"] = []
  o["deprecate_account_account"] = ["account-accounts"] as const
  o["dispose_account_asset"] = ["fixed-assets","depreciation-lines"] as const
  o["done_budget"] = []
  o["error_intercompany_transaction"] = []
  o["import_account_csv"] = []
  o["import_account_move_csv"] = []
  o["import_account_move_line_csv"] = []
  o["import_analytic_account_csv"] = []
  o["import_budget_csv"] = []
  o["import_budget_line_csv"] = []
  o["import_tax_rate_csv"] = []
  o["match_bank_line"] = []
  o["match_elimination_entries"] = []
  o["open_account_period"] = []
  o["open_fiscal_year"] = []
  o["post_account_bank_statement"] = []
  o["post_account_move"] = ["account-moves","account-move-lines"] as const
  o["post_invoice"] = ["account-moves","account-move-lines"] as const
  o["post_payment"] = []
  o["post_payment_transaction"] = ["payment-transactions","account-payments","account-moves"] as const
  o["process_consolidation"] = []
  o["process_intercompany_transaction"] = []
  o["reconcile_account_bank_statement_line"] = []
  o["reconcile_payment_with_invoice"] = []
  o["allocate_payment_transaction"] = ["payment-reconciliations","payment-transactions","account-move-lines"] as const
  o["archive_payment_account"] = ["payment-accounts"] as const
  o["reverse_payment_transaction"] = ["payment-reversals","payment-reconciliations","payment-transactions","account-payments"] as const
  o["refresh_tax_deadline_statuses"] = []
  o["register_payment_on_invoice"] = []
  o["retry_intercompany_transaction"] = []
  o["schedule_tax_deadline_updates"] = []
  o["set_analytic_account_active"] = []
  o["set_asset_active"] = []
  o["set_consolidation_company_rate"] = []
  o["stage_bank_statement_import"] = []
  o["set_intercompany_rule_active"] = []
  o["unmatch_elimination_entry"] = []
  o["unreconcile_account_bank_statement_line"] = ["bank-statements","bank-statement-lines","bank-match-candidates","account-reconciliation-widgets"] as const
  o["unreconciled_account_bank_statement_line"] = []
  o["update_account_account"] = ["account-accounts"] as const
  o["update_account_account_type"] = []
  o["update_account_asset"] = ["fixed-assets","depreciation-lines"] as const
  o["update_account_bank_statement"] = ["bank-statements","bank-statement-lines","bank-match-candidates","account-reconciliation-widgets"] as const
  o["update_account_bank_statement_line"] = []
  o["update_account_group"] = []
  o["update_account_journal"] = ["account-journals"] as const
  o["update_account_move_line"] = []
  o["update_account_period"] = []
  o["update_account_reconciliation_widget"] = []
  o["update_account_tax"] = ["account-taxes","tax-groups","tax-jurisdictions","tax-schedules","tax-deadlines"] as const
  o["update_account_tax_group"] = []
  o["update_analytic_account"] = []
  o["update_analytic_distribution_model"] = []
  o["update_analytic_line"] = []
  o["update_budget_line"] = ["budgets","budget-lines","budget-posts"] as const
  o["update_budget_line_actuals"] = []
  o["update_budget_post"] = []
  o["update_consolidation_account"] = []
  o["update_crossovered_budget"] = ["budgets","budget-lines","budget-posts"] as const
  o["update_fiscal_year"] = []
  o["update_intercompany_rule"] = []
  o["update_payment_term"] = []
  o["update_payment_account"] = ["payment-accounts"] as const
  o["update_payment_transaction"] = ["payment-transactions"] as const
  o["update_payment_term_line"] = []
  o["update_tax_deadline"] = []
  o["update_tax_jurisdiction"] = []
  o["update_tax_schedule"] = []
  o["validate_budget"] = []
  o["validate_consolidation"] = []
  o["void_payment_transaction"] = ["payment-transactions"] as const
  o["waive_tax_deadline"] = []
  return o
}

export const ACCOUNTING_COMMAND_SUBSCRIPTION_HINTS: Record<
  AccountingBffReducerKey,
  readonly string[]
> = accountingReducerHints();

export function accountingCommandContract(
  reducer: AccountingBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Accounting reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: ACCOUNTING_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}

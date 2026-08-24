
import type { ReducerCommandContractMeta } from "./types";

/**
 * Expenses mutations via Next.js BFF `POST /api/call/:reducer`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` expenses hooks.
 */
export const EXPENSES_BFF_REDUCERS = [
  "apply_expense_advance_to_sheet",
  "apply_expense_integration_intent",
  "apply_pending_expense_integration_intents",
  "approve_expense_policy_exception",
  "approve_expense_sheet",
  "create_expense",
  "create_expense_advance",
  "create_expense_card_statement_line",
  "create_expense_integration_intent",
  "create_expense_project_rebill",
  "create_expense_receipt",
  "create_expense_reimbursement_payment",
  "create_expense_sheet",
  "fail_expense_integration_intent",
  "import_expense_csv",
  "import_expense_sheet_csv",
  "match_expense_card_statement_line",
  "post_expense_sheet",
  "refuse_expense_sheet",
  "reject_expense_policy_exception",
  "request_expense_policy_exception",
  "seed_statutory_expense_mileage_rates",
  "set_expense_allocations",
  "set_expense_fraud_hold",
  "submit_expense",
  "submit_expense_sheet",
  "unmatch_expense_card_statement_line",
  "update_expense",
  "upsert_expense_mileage_rate",
  "upsert_expense_per_diem_rate",
  "upsert_expense_policy",
] as const;

export type ExpensesBffReducerKey = (typeof EXPENSES_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<ExpensesBffReducerKey>();

/** Same-origin path used by `apiFetch` in the web app. */
export function expensesBffCallUrl(reducer: ExpensesBffReducerKey): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

const EXPENSES_HINT_OVERRIDES: Partial<
  Record<ExpensesBffReducerKey, readonly string[]>
> = {
  apply_expense_advance_to_sheet: ["expense-sheets", "expenses", "expense-advances"],
  apply_expense_integration_intent: ["expenses"],
  apply_pending_expense_integration_intents: ["expenses"],
  approve_expense_policy_exception: ["expenses", "expense-policy-exceptions"],
  approve_expense_sheet: [
    "expense-sheets",
    "expenses",
    "expense-sheets-to-approve",
  ],
  create_expense: ["expenses", "expenses-missing-receipt"],
  create_expense_advance: ["expenses", "expense-advances"],
  create_expense_card_statement_line: [
    "expenses",
    "expense-card-statement-unmatched",
  ],
  create_expense_integration_intent: ["expenses"],
  create_expense_project_rebill: ["expense-sheets", "expenses"],
  create_expense_receipt: ["expense-receipts", "expenses-missing-receipt"],
  create_expense_reimbursement_payment: ["expense-sheets", "expenses"],
  create_expense_sheet: ["expense-sheets"],
  fail_expense_integration_intent: ["expenses"],
  import_expense_csv: ["expenses", "expenses-missing-receipt"],
  import_expense_sheet_csv: ["expense-sheets"],
  match_expense_card_statement_line: [
    "expenses",
    "expense-card-statement-unmatched",
  ],
  post_expense_sheet: ["expenses", "expense-sheets"],
  refuse_expense_sheet: [
    "expense-sheets",
    "expenses",
    "expense-sheets-to-approve",
  ],
  reject_expense_policy_exception: ["expenses", "expense-policy-exceptions"],
  request_expense_policy_exception: ["expenses", "expense-policy-exceptions"],
  seed_statutory_expense_mileage_rates: [
    "expense-mileage-rates",
    "expenses",
  ],
  set_expense_allocations: ["expenses"],
  set_expense_fraud_hold: ["expenses", "expenses-missing-receipt"],
  submit_expense: ["expenses", "expense-sheets"],
  submit_expense_sheet: [
    "expense-sheets",
    "expenses",
    "expense-sheets-to-approve",
  ],
  unmatch_expense_card_statement_line: [
    "expenses",
    "expense-card-statement-unmatched",
  ],
  update_expense: ["expenses", "expenses-missing-receipt"],
  upsert_expense_mileage_rate: ["expense-mileage-rates", "expenses"],
  upsert_expense_per_diem_rate: ["expense-per-diem-rates", "expenses"],
  upsert_expense_policy: ["expense-sheets", "expenses"],
};

function expensesReducerHints(): Record<ExpensesBffReducerKey, readonly string[]> {
  const o = {} as Record<ExpensesBffReducerKey, readonly string[]>;
  for (const k of EXPENSES_BFF_REDUCERS) {
    o[k] = EXPENSES_HINT_OVERRIDES[k] ?? [];
  }
  return o;
}

export const EXPENSES_COMMAND_SUBSCRIPTION_HINTS: Record<
  ExpensesBffReducerKey,
  readonly string[]
> = expensesReducerHints();

export function expensesCommandContract(
  reducer: ExpensesBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Expenses reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: EXPENSES_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}

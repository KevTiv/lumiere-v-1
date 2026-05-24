import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * Expenses mutations via Next.js BFF `POST /api/call/:reducer`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` expenses hooks.
 */
export const EXPENSES_BFF_REDUCERS = [
  "approve_expense_sheet",
  "create_expense",
  "create_expense_sheet",
  "import_expense_csv",
  "import_expense_sheet_csv",
  "post_expense_sheet",
  "refuse_expense_sheet",
  "submit_expense",
  "submit_expense_sheet",
  "update_expense",
] as const;

export type ExpensesBffReducerKey = (typeof EXPENSES_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<ExpensesBffReducerKey>();

/** Same-origin path used by `apiFetch` in the web app. */
export function expensesBffCallUrl(reducer: ExpensesBffReducerKey): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

export function expensesBffPost(
  reducer: ExpensesBffReducerKey,
  args: unknown[],
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: expensesBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCallBody(args),
    },
  };
}

const EXPENSES_HINT_OVERRIDES: Partial<
  Record<ExpensesBffReducerKey, readonly string[]>
> = {
  approve_expense_sheet: ["expense-sheets", "expenses"],
  create_expense: ["expenses"],
  create_expense_sheet: ["expense-sheets"],
  import_expense_csv: ["expenses"],
  import_expense_sheet_csv: ["expense-sheets"],
  post_expense_sheet: ["expenses", "expense-sheets"],
  refuse_expense_sheet: ["expense-sheets", "expenses"],
  submit_expense: ["expenses", "expense-sheets"],
  submit_expense_sheet: ["expense-sheets", "expenses"],
  update_expense: ["expenses"],
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

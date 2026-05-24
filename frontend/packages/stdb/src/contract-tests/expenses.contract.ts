/**
 * Compile-only — Expenses BFF reducer keys stay aligned with `expensesBffCallUrl`.
 */
import {
  EXPENSES_BFF_REDUCERS,
  expensesBffCallUrl,
  expensesCommandContract,
} from "../commands/expenses-http";

for (const k of EXPENSES_BFF_REDUCERS) {
  void expensesBffCallUrl(k);
  void expensesCommandContract(k);
}

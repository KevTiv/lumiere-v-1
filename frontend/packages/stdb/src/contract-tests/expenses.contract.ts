/**
 * Compile-only — Expenses BFF reducer keys stay aligned with command metadata.
 */
import {
  EXPENSES_BFF_REDUCERS,
  expensesCommandContract,
} from "../commands/expenses-http";

for (const k of EXPENSES_BFF_REDUCERS) {
  void expensesCommandContract(k);
}

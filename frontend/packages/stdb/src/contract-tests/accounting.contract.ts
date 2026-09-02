/**
 * Compile-only — Accounting BFF reducer keys stay aligned with command metadata.
 */
import {
  ACCOUNTING_BFF_REDUCERS,
  accountingCommandContract,
} from "../commands/accounting-http";

for (const k of ACCOUNTING_BFF_REDUCERS) {
  void accountingCommandContract(k);
}

/**
 * Compile-only — Accounting BFF reducer keys stay aligned with `accountingBffCallUrl`.
 */
import {
  ACCOUNTING_BFF_REDUCERS,
  accountingBffCallUrl,
  accountingCommandContract,
} from "../commands/accounting-http";

for (const k of ACCOUNTING_BFF_REDUCERS) {
  void accountingBffCallUrl(k);
  void accountingCommandContract(k);
}

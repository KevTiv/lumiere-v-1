/**
 * Compile-only — Helpdesk BFF reducer keys stay aligned with `helpdeskBffCallUrl`.
 */
import {
  HELPDESK_BFF_REDUCERS,
  helpdeskBffCallUrl,
  helpdeskCommandContract,
} from "../commands/helpdesk-http";

for (const k of HELPDESK_BFF_REDUCERS) {
  void helpdeskBffCallUrl(k);
  void helpdeskCommandContract(k);
}

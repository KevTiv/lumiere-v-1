/**
 * Compile-only — Helpdesk BFF reducer keys stay aligned with command metadata.
 */
import {
  HELPDESK_BFF_REDUCERS,
  helpdeskCommandContract,
} from "../commands/helpdesk-http";

for (const k of HELPDESK_BFF_REDUCERS) {
  void helpdeskCommandContract(k);
}

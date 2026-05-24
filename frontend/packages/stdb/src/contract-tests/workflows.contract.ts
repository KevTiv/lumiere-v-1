/**
 * Compile-only — Workflows BFF reducer keys stay aligned with `workflowsBffCallUrl`.
 */
import {
  WORKFLOWS_BFF_REDUCERS,
  workflowsBffCallUrl,
  workflowsCommandContract,
} from "../commands/workflows-http";

for (const k of WORKFLOWS_BFF_REDUCERS) {
  void workflowsBffCallUrl(k);
  void workflowsCommandContract(k);
}

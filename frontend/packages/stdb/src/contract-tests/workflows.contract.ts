/**
 * Compile-only — Workflows BFF reducer keys stay aligned with command metadata.
 */
import {
  WORKFLOWS_BFF_REDUCERS,
  workflowsCommandContract,
} from "../commands/workflows-http";

for (const k of WORKFLOWS_BFF_REDUCERS) {
  void workflowsCommandContract(k);
}

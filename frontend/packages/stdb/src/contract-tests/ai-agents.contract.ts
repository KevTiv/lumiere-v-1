/**
 * Compile-only — AI agents BFF reducer keys stay aligned with command metadata.
 */
import {
  AI_AGENTS_BFF_REDUCERS,
  aiAgentsCommandContract,
} from "../commands/ai-agents-http";

for (const k of AI_AGENTS_BFF_REDUCERS) {
  void aiAgentsCommandContract(k);
}

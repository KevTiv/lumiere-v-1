/**
 * Compile-only — AI agents BFF reducer keys stay aligned with `aiAgentsBffCallUrl`.
 */
import {
  AI_AGENTS_BFF_REDUCERS,
  aiAgentsBffCallUrl,
  aiAgentsCommandContract,
} from "../commands/ai-agents-http";

for (const k of AI_AGENTS_BFF_REDUCERS) {
  void aiAgentsBffCallUrl(k);
  void aiAgentsCommandContract(k);
}

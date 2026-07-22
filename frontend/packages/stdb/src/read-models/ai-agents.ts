/** Loose row shape from `/api/query/ai-agents`. */
export type AiAgentQueryRow = Record<string, unknown>;

/** Primary label for AI agent rows in pickers and lists. */
export function aiAgentPrimaryLabel(row: AiAgentQueryRow): string {
  return primaryLabel([row.name, row.displayName, row.agentName], row.id);
}
import { primaryLabel } from "./primary-label";

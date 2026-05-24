/** Loose row shape from `/api/query/ai-agents`. */
export type AiAgentQueryRow = Record<string, unknown>;

/** Primary label for AI agent rows in pickers and lists. */
export function aiAgentPrimaryLabel(row: AiAgentQueryRow): string {
  const candidates = [row.name, row.displayName, row.agentName];
  for (const c of candidates) {
    if (typeof c === "string") {
      const t = c.trim();
      if (t.length > 0) return t;
    }
  }
  const id = row.id;
  if (typeof id === "number" || typeof id === "bigint") return `#${id}`;
  if (typeof id === "string" && id.trim() !== "") return `#${id.trim()}`;
  return "";
}

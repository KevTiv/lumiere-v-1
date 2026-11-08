import type { AiAgent } from "@lumiere/stdb/types"

export type ChatAgentRow = Partial<
  Pick<
    AiAgent,
    "id" | "isActive" | "allowedActions" | "allowedModels" | "model" | "name"
  >
> & { companyId?: bigint | number | string | null }

/** HTTP field policies may return only part of an agent. Missing scope or policy
 * fields never imply an organization-wide binding or an unrestricted model. */
export function chatAgentOptions(
  agents: readonly ChatAgentRow[],
  companyId: number | null,
) {
  if (companyId == null) return []
  return agents.flatMap((agent) => {
    const id = Number(agent.id)
    if (!Number.isSafeInteger(id) || id <= 0 || agent.isActive !== true)
      return []
    if (agent.companyId === undefined) return []
    if (agent.companyId !== null && Number(agent.companyId) !== companyId)
      return []
    if (
      !Array.isArray(agent.allowedActions) ||
      !agent.allowedActions.includes("chat")
    )
      return []
    if (
      !Array.isArray(agent.allowedModels) ||
      typeof agent.model !== "string" ||
      !agent.model
    )
      return []
    if (
      agent.allowedModels.length > 0 &&
      !agent.allowedModels.includes(agent.model)
    )
      return []
    return [{ value: String(id), label: agent.name || agent.model }]
  })
}

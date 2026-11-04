/** Explicit selection is intent only; the gateway checks current agent scope. */
export interface RagAgentSelection {
  agent_id?: number
  team_member_id?: number
}

function identifier(body: Record<string, unknown>, camel: string, snake: string): number | undefined {
  const supplied = [body[camel], body[snake]].filter((value) => value !== undefined)
  if (supplied.length === 0) return undefined
  const ids = supplied.map((value) => {
    if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) value = Number(value)
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${snake} must be a positive safe integer`)
    }
    return value
  })
  if (ids.some((id) => id !== ids[0])) throw new Error(`${snake} aliases disagree`)
  return ids[0]
}

export function parseRagAgentSelection(body: Record<string, unknown>): RagAgentSelection {
  const agent_id = identifier(body, 'agentId', 'agent_id')
  const team_member_id = identifier(body, 'teamMemberId', 'team_member_id')
  if (agent_id !== undefined && team_member_id !== undefined) {
    throw new Error('Select either an agent or a team member')
  }
  return {
    ...(agent_id !== undefined ? { agent_id } : {}),
    ...(team_member_id !== undefined ? { team_member_id } : {}),
  }
}

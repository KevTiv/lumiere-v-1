/** Query projection is discovery only; the gateway still checks current skill bindings. */
interface ScopedAgent {
  id: unknown
  organizationId: unknown
  companyId?: unknown
  isActive: unknown
}

function idKey(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null
  }
  if (typeof value !== "bigint" && typeof value !== "string") return null
  const text = String(value)
  if (!/^[1-9]\d*$/.test(text)) return null
  return BigInt(text) <= 18446744073709551615n ? text : null
}

/** Missing/redacted scope is unavailable. Only explicit null denotes an org-wide agent. */
export function isAgentAvailableForCompany(agent: ScopedAgent, organizationId: bigint, companyId: string): boolean {
  const organization = idKey(organizationId)
  const company = idKey(companyId)
  // The current submit contract sends Number IDs; discovery must not offer
  // values that the form would round during dispatch.
  const agentId = idKey(agent.id)
  if (!organization || !company || !agentId || agent.isActive !== true) return false
  if (BigInt(company) > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(agentId) > BigInt(Number.MAX_SAFE_INTEGER)) return false
  if (idKey(agent.organizationId) !== organization) return false
  return agent.companyId === null || idKey(agent.companyId) === company
}

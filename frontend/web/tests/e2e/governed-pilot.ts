/** Required live-AI acceptance must fail before making a provider request. */
export function governedPilotAgentId(env: {
  E2E_GOV00_AGENT_ID?: string
  E2E_REQUIRE_AI?: string
}): number | null {
  const raw = env.E2E_GOV00_AGENT_ID?.trim() ?? ""
  const agentId = /^[1-9][0-9]*$/.test(raw) ? Number(raw) : 0
  if (Number.isSafeInteger(agentId) && agentId > 0) return agentId
  if (env.E2E_REQUIRE_AI === "1") {
    throw new Error("E2E_REQUIRE_AI=1 requires a provisioned governed report-analysis runtime (set a positive E2E_GOV00_AGENT_ID)")
  }
  return null
}

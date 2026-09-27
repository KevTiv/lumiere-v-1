import type { AiPrivacyPolicy } from '../_lib/ai-privacy-policy'

type JsonObject = Record<string, unknown>

export interface TrustedGovernedLlmAuthority {
  organizationId: number
  companyId: number
  actorIdentity: string
  stdbToken: string
}

export interface TrustedGovernedLlmInput {
  inputs: JsonObject
  agentId: number | null
  teamMemberId: number | null
  maxSteps: number | null
  resumeRunId: number | null
  orgPrivacyPolicy: AiPrivacyPolicy
}

/** Build the internal request without placing tenant or actor authority in JSON. */
export function buildTrustedGovernedLlmRequest(
  input: TrustedGovernedLlmInput,
  authority: TrustedGovernedLlmAuthority,
) {
  return {
    headers: {
      'x-lumiere-organization-id': String(authority.organizationId),
      'x-lumiere-company-id': String(authority.companyId),
      'x-lumiere-actor-identity': authority.actorIdentity,
      'x-lumiere-actor-token': authority.stdbToken,
    },
    body: {
      inputs: input.inputs,
      agentId: input.agentId,
      teamMemberId: input.teamMemberId,
      maxSteps: input.maxSteps,
      resumeRunId: input.resumeRunId,
      orgPrivacyPolicy: input.orgPrivacyPolicy,
    },
  }
}

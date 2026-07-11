"use client"

import { useMutation } from "@tanstack/react-query"

import type { AiUiContext } from "../ai-ui-context"
import type {
  PolicyControlledRequest,
  PolicyResult,
} from "@lumiere/erp-shared/ai-policy-schemas"
import { apiFetch } from "../http"
import type { GatewayActionDraft } from "./ai-action-drafts"

export type { AiUiContext } from "../ai-ui-context"

async function parseAiError(r: Response): Promise<string> {
  const j = (await r.json().catch(() => ({}))) as { error?: string; detail?: string }
  return j.error ?? j.detail ?? `Request failed (${r.status})`
}

export function useAiActionDraft() {
  return useMutation({
    mutationFn: async (args: {
      companyId: number
      query: string
      ui_context?: AiUiContext
      allowed_reducers?: string[]
      allowed_entity_types?: string[]
      agent_id?: number
      team_member_id?: number
    }) => {
      const r = await apiFetch("/api/ai/actions/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: args.companyId,
          query: args.query,
          ...(args.ui_context ? { ui_context: args.ui_context } : {}),
          ...(args.allowed_reducers?.length ? { allowed_reducers: args.allowed_reducers } : {}),
          ...(args.allowed_entity_types?.length
            ? { allowed_entity_types: args.allowed_entity_types }
            : {}),
          ...(args.agent_id != null ? { agent_id: args.agent_id } : {}),
          ...(args.team_member_id != null ? { team_member_id: args.team_member_id } : {}),
        }),
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as { drafts: GatewayActionDraft[] }
    },
  })
}

export type { GatewayActionDraft } from "./ai-action-drafts"
export type { PolicyControlledRequest, PolicyResult }

export interface AiActionDraftBridgeResponse {
  decision: PolicyResult["decision"]
  draftId?: number
  error?: string
}

export function useAiActionDraftBridge() {
  return useMutation({
    mutationFn: async (args: { companyId: number; input: Record<string, unknown> }) => {
      const correlationId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `action-draft-${Date.now()}`
      const r = await apiFetch("/api/ai/action-draft/bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          execution: {
            skill: { skill_key: "create_sale_order_draft", version: 1 },
            company_id: args.companyId,
            correlation_id: correlationId,
            input: args.input,
            plan: {
              named_resources: [],
              tool_calls: [
                {
                  tool_name: "create_sale_order",
                  capability: "action_draft",
                },
              ],
              steps: 1,
              expected_rows: 0,
              output_type: "action_draft.create_sale_order.v1",
            },
          },
          candidate_output: null,
        }),
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as AiActionDraftBridgeResponse
    },
  })
}

export interface AiPolicyEvaluationInput {
  companyId: number
  skill: PolicyControlledRequest["execution"]["skill"]
  correlationId: string
  input: unknown
  plan: PolicyControlledRequest["execution"]["plan"]
  candidateOutput: unknown
}

export function useAiPolicyEvaluation() {
  return useMutation({
    mutationFn: async (args: AiPolicyEvaluationInput) => {
      const r = await apiFetch("/api/ai/policy/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: args.companyId,
          skill: args.skill,
          correlationId: args.correlationId,
          input: args.input,
          plan: args.plan,
          candidateOutput: args.candidateOutput,
        }),
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as PolicyResult
    },
  })
}

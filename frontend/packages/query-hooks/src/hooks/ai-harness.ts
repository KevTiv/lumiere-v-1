"use client"

import { useMutation } from "@tanstack/react-query"

import type { AiUiContext } from "../ai-ui-context"
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

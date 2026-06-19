"use client"

import { useMutation, useQuery } from "@tanstack/react-query"

import { apiFetch } from "../http"

export type AiSkillListItem = {
  id: number
  skill_key: string
  name: string
  description?: string
  category: string
  is_system: boolean
}

export type AiSkillCitation = {
  kind: string
  trust: string
  content_type?: string
  entity_id?: string
  score?: number
  text_snippet?: string
  label?: string
  snapshot_at?: string
  url?: string
  title?: string
  fetched_at?: string
}

export type AiSkillArtifact = {
  kind: string
  title: string
  content: unknown
}

export type AiSkillRunStep = {
  step_no: number
  tool: string
  duration_ms: number
  summary: string
}

export type AiSkillRunResponse = {
  run_id: number
  run_key: string
  status: string
  summary: string
  artifacts: AiSkillArtifact[]
  citations: AiSkillCitation[]
  steps: AiSkillRunStep[]
  agent_id: number
  skill_key: string
}

async function parseAiError(r: Response): Promise<string> {
  const j = (await r.json().catch(() => ({}))) as { error?: string; detail?: string }
  return j.error ?? j.detail ?? `Request failed (${r.status})`
}

export function useAiSkills() {
  return useQuery({
    queryKey: ["ai-skills"],
    queryFn: async () => {
      const r = await apiFetch("/api/ai/skills")
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as AiSkillListItem[]
    },
    staleTime: 60_000,
  })
}

export function useRunAiSkill() {
  return useMutation({
    mutationFn: async (args: {
      companyId: number
      skillKey: string
      inputs?: Record<string, unknown>
      agentId?: number
      teamMemberId?: number
      overrides?: { max_steps?: number }
    }) => {
      const r = await apiFetch("/api/ai/skills/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: args.companyId,
          skillKey: args.skillKey,
          ...(args.inputs ? { inputs: args.inputs } : {}),
          ...(args.agentId != null ? { agentId: args.agentId } : {}),
          ...(args.teamMemberId != null ? { teamMemberId: args.teamMemberId } : {}),
          ...(args.overrides ? { overrides: args.overrides } : {}),
        }),
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as AiSkillRunResponse
    },
  })
}

export function useUpsertAiSkillConfig() {
  return useMutation({
    mutationFn: async (args: {
      companyId?: number
      skillId: number
      isEnabled?: boolean
      configJson: Record<string, unknown> | string
      customInstructions?: string
    }) => {
      const r = await apiFetch("/api/ai/skills/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(args.companyId != null ? { companyId: args.companyId } : {}),
          skillId: args.skillId,
          isEnabled: args.isEnabled,
          configJson:
            typeof args.configJson === "string"
              ? args.configJson
              : JSON.stringify(args.configJson),
          ...(args.customInstructions ? { customInstructions: args.customInstructions } : {}),
        }),
      })
      if (!r.ok) throw new Error(await parseAiError(r))
      return (await r.json()) as { ok: boolean }
    },
  })
}

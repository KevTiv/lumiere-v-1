/**
 * Maps AI module form / gateway payloads to SpacetimeDB Create*Params types.
 */

import type {
  CreateAiActionDraftParams,
  CreateAiAgentParams,
  CreateAiAgentRunParams,
  CreateAiChatSessionParams,
  CreateAiInsightParams,
  CreateAiSkillParams,
  CreateAiTeamMemberParams,
  InsightSeverity,
} from "@lumiere/stdb/types"

import { optionalBigIntU64 } from "./form-coercion"
import { stbTimestampFromDate } from "./stb-timestamp"

function field(formData: Record<string, unknown>, camel: string, snake: string): unknown {
  return formData[camel] ?? formData[snake]
}

function optionalTrimmedString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === "" ? undefined : s
}

function requiredTrimmedString(v: unknown): string | null {
  const s = optionalTrimmedString(v)
  return s ?? null
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function stringArrayFromForm(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean)
  const s = String(raw ?? "").trim()
  if (!s) return []
  return s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)
}

function unitVariant<T extends string>(tag: T): { tag: T } {
  return { tag }
}

function insightSeverityFromForm(raw: unknown): InsightSeverity {
  const tag = String(raw ?? "Info")
  switch (tag) {
    case "Low":
    case "Medium":
    case "High":
    case "Critical":
      return unitVariant(tag)
    default:
      return unitVariant("Info")
  }
}

export type AiActionDraftGatewayInput = {
  reducer_name: string
  params_json: unknown
  summary: string
  confidence: number
  elevated?: boolean
  warnings?: string[]
}

export function toCreateAiActionDraftParams(
  formData: Record<string, unknown> | AiActionDraftGatewayInput,
  extras?: { sourceQuery?: string | null; uiContextJson?: string | null },
): CreateAiActionDraftParams | null {
  const reducerName = requiredTrimmedString(
    field(formData as Record<string, unknown>, "reducerName", "reducer_name"),
  )
  const summary = requiredTrimmedString(field(formData as Record<string, unknown>, "summary", "summary"))
  if (!reducerName || !summary) return null

  const paramsRaw =
    field(formData as Record<string, unknown>, "paramsJson", "params_json") ??
    (formData as AiActionDraftGatewayInput).params_json
  const paramsJson =
    typeof paramsRaw === "string" ? paramsRaw : JSON.stringify(paramsRaw ?? {})

  const warningsRaw =
    field(formData as Record<string, unknown>, "warningsJson", "warnings_json") ??
    (formData as AiActionDraftGatewayInput).warnings
  let warningsJson: string | undefined
  if (typeof warningsRaw === "string") {
    warningsJson = warningsRaw.trim() === "" ? undefined : warningsRaw
  } else if (Array.isArray(warningsRaw) && warningsRaw.length > 0) {
    warningsJson = JSON.stringify(warningsRaw)
  }

  const confidence = num(field(formData as Record<string, unknown>, "confidence", "confidence"), 0)

  return {
    reducerName,
    paramsJson,
    summary,
    confidence,
    elevated:
      (formData as AiActionDraftGatewayInput).elevated === true ||
      field(formData as Record<string, unknown>, "elevated", "elevated") === true,
    warningsJson,
    sourceQuery:
      optionalTrimmedString(extras?.sourceQuery) ??
      optionalTrimmedString(field(formData as Record<string, unknown>, "sourceQuery", "source_query")),
    uiContextJson:
      optionalTrimmedString(extras?.uiContextJson) ??
      optionalTrimmedString(field(formData as Record<string, unknown>, "uiContextJson", "ui_context_json")),
    expiresAt: (() => {
      const raw = field(formData as Record<string, unknown>, "expiresAt", "expires_at")
      if (raw == null || String(raw).trim() === "") return undefined
      const d = new Date(String(raw))
      return Number.isNaN(d.getTime()) ? undefined : stbTimestampFromDate(d)
    })(),
    metadata: optionalTrimmedString(field(formData as Record<string, unknown>, "metadata", "metadata")),
  }
}

export function toCreateAiAgentParams(
  formData: Record<string, unknown>,
): CreateAiAgentParams | null {
  const name = requiredTrimmedString(field(formData, "name", "name"))
  const model = requiredTrimmedString(field(formData, "model", "model"))
  const provider = requiredTrimmedString(field(formData, "provider", "provider"))
  if (!name || !model || !provider) return null

  return {
    name,
    model,
    provider,
    temperature: num(field(formData, "temperature", "temperature"), 0.7),
    maxTokens: Math.trunc(num(field(formData, "maxTokens", "max_tokens"), 4096)),
    rateLimitPerMinute: Math.trunc(num(field(formData, "rateLimitPerMinute", "rate_limit_per_minute"), 60)),
    costPer1KTokens: num(field(formData, "costPer1KTokens", "cost_per_1k_tokens"), 0),
    contextWindow: Math.trunc(num(field(formData, "contextWindow", "context_window"), 128000)),
    topP: num(field(formData, "topP", "top_p"), 1),
    frequencyPenalty: num(field(formData, "frequencyPenalty", "frequency_penalty"), 0),
    presencePenalty: num(field(formData, "presencePenalty", "presence_penalty"), 0),
    isActive: field(formData, "isActive", "is_active") !== false,
    isDefault: field(formData, "isDefault", "is_default") === true,
    allowedModels: stringArrayFromForm(field(formData, "allowedModels", "allowed_models")),
    allowedActions: stringArrayFromForm(field(formData, "allowedActions", "allowed_actions")),
    description: optionalTrimmedString(field(formData, "description", "description")),
    apiKeyReference: optionalTrimmedString(field(formData, "apiKeyReference", "api_key_reference")),
    systemPrompt: optionalTrimmedString(field(formData, "systemPrompt", "system_prompt")),
    monthlyBudget: (() => {
      const v = field(formData, "monthlyBudget", "monthly_budget")
      return v == null || v === "" ? undefined : num(v)
    })(),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export type AiAgentRunMapperContext = {
  companyId: bigint
  skillId: bigint
  agentId: bigint
  runKey: string
  triggeredByHex: string
  skillConfigId?: bigint
  teamMemberId?: bigint
}

export function toCreateAiAgentRunParams(
  formData: Record<string, unknown>,
  context: AiAgentRunMapperContext,
): CreateAiAgentRunParams {
  const inputsRaw = field(formData, "inputsJson", "inputs_json") ?? field(formData, "inputs", "inputs")
  const inputsJson =
    typeof inputsRaw === "string" ? inputsRaw : JSON.stringify(inputsRaw ?? {})

  return {
    companyId: context.companyId,
    skillId: context.skillId,
    skillConfigId:
      optionalBigIntU64(field(formData, "skillConfigId", "skill_config_id")) ?? context.skillConfigId,
    agentId: context.agentId,
    teamMemberId:
      optionalBigIntU64(field(formData, "teamMemberId", "team_member_id")) ?? context.teamMemberId,
    runKey: String(field(formData, "runKey", "run_key") ?? context.runKey),
    inputsJson,
    triggeredByHex: String(field(formData, "triggeredByHex", "triggered_by_hex") ?? context.triggeredByHex),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateAiChatSessionParams(
  formData: Record<string, unknown>,
): CreateAiChatSessionParams | null {
  const sessionKey = requiredTrimmedString(field(formData, "sessionKey", "session_key"))
  if (!sessionKey) return null
  return {
    sessionKey,
    title: optionalTrimmedString(field(formData, "title", "title")),
    route: optionalTrimmedString(field(formData, "route", "route")),
    module: optionalTrimmedString(field(formData, "module", "module")),
    activeTab: optionalTrimmedString(field(formData, "activeTab", "active_tab")),
    archived: field(formData, "archived", "archived") === true,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateAiInsightParams(
  formData: Record<string, unknown>,
): CreateAiInsightParams | null {
  const title = requiredTrimmedString(field(formData, "title", "title"))
  const description = requiredTrimmedString(field(formData, "description", "description"))
  const relatedModel = requiredTrimmedString(field(formData, "relatedModel", "related_model"))
  if (!title || !description || !relatedModel) return null

  return {
    severity: insightSeverityFromForm(field(formData, "severity", "severity")),
    title,
    description,
    recommendations: stringArrayFromForm(field(formData, "recommendations", "recommendations")),
    relatedModel,
    confidence: num(field(formData, "confidence", "confidence"), 0),
    tags: stringArrayFromForm(field(formData, "tags", "tags")),
    relatedId: optionalBigIntU64(field(formData, "relatedId", "related_id")),
    generatedBy: optionalBigIntU64(field(formData, "generatedBy", "generated_by")),
    impactScore: (() => {
      const v = field(formData, "impactScore", "impact_score")
      return v == null || v === "" ? undefined : num(v)
    })(),
    priority: (() => {
      const v = field(formData, "priority", "priority")
      if (v == null || v === "") return undefined
      return Math.min(255, Math.max(0, Math.trunc(num(v))))
    })(),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateAiSkillParams(
  formData: Record<string, unknown>,
): CreateAiSkillParams | null {
  const skillKey = requiredTrimmedString(field(formData, "skillKey", "skill_key"))
  const name = requiredTrimmedString(field(formData, "name", "name"))
  if (!skillKey || !name) return null

  return {
    skillKey,
    name,
    description: optionalTrimmedString(field(formData, "description", "description")),
    category: String(field(formData, "category", "category") ?? "custom"),
    promptTemplate: String(field(formData, "promptTemplate", "prompt_template") ?? ""),
    requiredTools: stringArrayFromForm(field(formData, "requiredTools", "required_tools")),
    optionalTools: stringArrayFromForm(field(formData, "optionalTools", "optional_tools")),
    defaultMaxSteps: Math.trunc(num(field(formData, "defaultMaxSteps", "default_max_steps"), 8)),
    defaultMaxToolCalls: Math.trunc(num(field(formData, "defaultMaxToolCalls", "default_max_tool_calls"), 16)),
    outputSchema: optionalTrimmedString(field(formData, "outputSchema", "output_schema")),
    configSchema: optionalTrimmedString(field(formData, "configSchema", "config_schema")),
    datasetSpecs: optionalTrimmedString(field(formData, "datasetSpecs", "dataset_specs")),
    allowedActionDrafts: stringArrayFromForm(
      field(formData, "allowedActionDrafts", "allowed_action_drafts"),
    ),
    isActive: field(formData, "isActive", "is_active") !== false,
    isSystem: field(formData, "isSystem", "is_system") === true,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateAiTeamMemberParams(
  formData: Record<string, unknown>,
): CreateAiTeamMemberParams | null {
  const name = requiredTrimmedString(field(formData, "name", "name"))
  const aiAgentId = optionalBigIntU64(field(formData, "aiAgentId", "ai_agent_id"))
  if (!name || aiAgentId === undefined) return null

  return {
    name,
    aiAgentId,
    role: String(field(formData, "role", "role") ?? "assistant"),
    responseStyle: String(field(formData, "responseStyle", "response_style") ?? "professional"),
    isActive: field(formData, "isActive", "is_active") !== false,
    responsibilities: stringArrayFromForm(field(formData, "responsibilities", "responsibilities")),
    expertiseAreas: stringArrayFromForm(field(formData, "expertiseAreas", "expertise_areas")),
    avatarUrl: optionalTrimmedString(field(formData, "avatarUrl", "avatar_url")),
    greetingMessage: optionalTrimmedString(field(formData, "greetingMessage", "greeting_message")),
    personality: optionalTrimmedString(field(formData, "personality", "personality")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

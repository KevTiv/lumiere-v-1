"use client"

import { useMemo, useState } from "react"
import { DashboardHeader, FormModal, MissingOrganization, type FormConfig } from "@lumiere/ui"
import {
  useAiActionDraft,
  useAiBriefing,
  useAiImportAnalyze,
  useAiImportPreview,
  useAiSearch,
} from "@lumiere/query-hooks/hooks/ai-harness"
import { useRunAiSkill } from "@lumiere/query-hooks/hooks/ai-skills"
import { AiResultPanel } from "@/lib/ai-result-panel"
import { hasValidOrganizationId } from "@/lib/org-scoped"
import { useDefaultOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"

type AiHarnessAction =
  | "search"
  | "actionDraft"
  | "briefing"
  | "importAnalyze"
  | "importPreview"
  | "runSkill"

const aiHarnessForms: Record<AiHarnessAction, FormConfig> = {
  search: {
    id: "ai-harness-search",
    title: "AI Search",
    submitLabel: "Search",
    sections: [
      {
        id: "query",
        fields: [
          { id: "query", type: "textarea", name: "query", label: "Query", required: true, rows: 3, width: "full" },
          { id: "content-type", type: "text", name: "contentType", label: "Content type", width: "1/2" },
          { id: "limit", type: "number", name: "limit", label: "Limit", defaultValue: 10, width: "1/4" },
          { id: "threshold", type: "number", name: "scoreThreshold", label: "Score threshold", width: "1/4" },
        ],
      },
    ],
  },
  actionDraft: {
    id: "ai-harness-action-draft",
    title: "Draft Action",
    submitLabel: "Draft action",
    sections: [
      {
        id: "prompt",
        fields: [
          { id: "query", type: "textarea", name: "query", label: "Request", required: true, rows: 4, width: "full" },
          { id: "allowed-reducers", type: "textarea", name: "allowedReducers", label: "Allowed reducers, one per line", rows: 3, width: "full" },
          { id: "ui-context", type: "textarea", name: "uiContextJson", label: "UI context JSON", rows: 4, width: "full" },
        ],
      },
    ],
  },
  briefing: {
    id: "ai-harness-briefing",
    title: "Generate Briefing",
    submitLabel: "Generate briefing",
    sections: [
      {
        id: "briefing",
        fields: [
          { id: "window", type: "text", name: "window", label: "Window", defaultValue: "24h", width: "1/2" },
          { id: "since", type: "number", name: "sinceMicros", label: "Since micros", width: "1/2" },
          { id: "resources", type: "textarea", name: "resources", label: "Resources, one per line", rows: 3, width: "full" },
          { id: "filters", type: "textarea", name: "resourceFiltersJson", label: "Resource filters JSON", rows: 4, width: "full" },
        ],
      },
    ],
  },
  importAnalyze: {
    id: "ai-harness-import-analyze",
    title: "Analyze Import Mapping",
    submitLabel: "Analyze import",
    sections: [
      {
        id: "import",
        fields: [
          { id: "target", type: "text", name: "targetEntity", label: "Target entity", required: true, width: "full" },
          { id: "header", type: "textarea", name: "header", label: "Header, one column per line", required: true, rows: 4, width: "full" },
          { id: "sample", type: "textarea", name: "sampleRowsJson", label: "Sample rows JSON", rows: 5, width: "full" },
          { id: "prior", type: "textarea", name: "priorMappingsJson", label: "Prior mappings JSON", rows: 4, width: "full" },
          { id: "instructions", type: "textarea", name: "instructions", label: "Instructions", rows: 3, width: "full" },
        ],
      },
    ],
  },
  importPreview: {
    id: "ai-harness-import-preview",
    title: "Preview Import Mapping",
    submitLabel: "Preview import",
    sections: [
      {
        id: "preview",
        fields: [
          { id: "target", type: "text", name: "targetEntity", label: "Target entity", required: true, width: "full" },
          { id: "header", type: "textarea", name: "header", label: "Header, one column per line", required: true, rows: 4, width: "full" },
          { id: "sample", type: "textarea", name: "sampleRowsJson", label: "Sample rows JSON", required: true, rows: 5, width: "full" },
          { id: "mapping", type: "textarea", name: "mappingJson", label: "Mapping JSON", required: true, rows: 5, width: "full" },
          { id: "transforms", type: "textarea", name: "transformsJson", label: "Transforms JSON", rows: 4, width: "full" },
        ],
      },
    ],
  },
  runSkill: {
    id: "ai-harness-run-skill",
    title: "Run AI Skill",
    submitLabel: "Run skill",
    sections: [
      {
        id: "skill",
        fields: [
          {
            id: "skill-key",
            type: "text",
            name: "skillKey",
            label: "Skill key",
            defaultValue: "report_analysis",
            required: true,
            width: "full",
          },
          {
            id: "query",
            type: "textarea",
            name: "query",
            label: "Query / goal",
            required: true,
            rows: 3,
            width: "full",
          },
          {
            id: "entity-type",
            type: "text",
            name: "entityType",
            label: "Entity type (optional)",
            width: "1/2",
          },
          {
            id: "entity-id",
            type: "number",
            name: "entityId",
            label: "Entity id (optional)",
            width: "1/2",
          },
          {
            id: "inputs-json",
            type: "textarea",
            name: "inputsJson",
            label: "Extra inputs JSON",
            rows: 4,
            width: "full",
          },
        ],
      },
    ],
  },
}

function optionalJsonObject(value: unknown, label: string): Record<string, unknown> | undefined {
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw) return undefined
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return parsed as Record<string, unknown>
}

function requiredJsonObject(value: unknown, label: string): Record<string, unknown> {
  const parsed = optionalJsonObject(value, label)
  if (!parsed) throw new Error(`${label} is required`)
  return parsed
}

function optionalJsonArray(value: unknown, label: string): unknown[] | undefined {
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw) return undefined
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array`)
  return parsed
}

function requiredJsonArray(value: unknown, label: string): unknown[] {
  const parsed = optionalJsonArray(value, label)
  if (!parsed) throw new Error(`${label} is required`)
  return parsed
}

function lines(value: unknown): string[] {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function AiHarnessClient({ organizationId }: { organizationId?: number }) {
  if (!hasValidOrganizationId(organizationId)) return <MissingOrganization />
  return <AiHarnessLoaded organizationId={organizationId} />
}

function AiHarnessLoaded({ organizationId }: { organizationId: number }) {
  const operatingCompanyId = useDefaultOperatingCompanyId(organizationId)
  const [activeAction, setActiveAction] = useState<AiHarnessAction | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)

  const search = useAiSearch()
  const actionDraft = useAiActionDraft()
  const briefing = useAiBriefing()
  const importAnalyze = useAiImportAnalyze()
  const importPreview = useAiImportPreview()
  const runSkill = useRunAiSkill()

  const isPending =
    search.isPending ||
    actionDraft.isPending ||
    briefing.isPending ||
    importAnalyze.isPending ||
    importPreview.isPending ||
    runSkill.isPending

  const actions = useMemo(
    () => [
      { id: "search" as const, title: "Search", description: "Semantic search over indexed company context." },
      { id: "runSkill" as const, title: "Run Skill", description: "Execute a configured AI skill with ERP tools and citations." },
      { id: "actionDraft" as const, title: "Action Draft", description: "Draft a reducer-backed action from natural language." },
      { id: "briefing" as const, title: "Briefing", description: "Summarize recent activity and notable records." },
      { id: "importAnalyze" as const, title: "Import Analyze", description: "Suggest field mappings for CSV-style imports." },
      { id: "importPreview" as const, title: "Import Preview", description: "Preview mapped rows before executing an import." },
    ],
    [],
  )

  const handleSubmit = async (formData: Record<string, unknown>) => {
    if (!activeAction) return
    setSubmitError(null)
    try {
      let next: Record<string, unknown>
      if (activeAction === "search") {
        next = await search.mutateAsync({
          companyId: operatingCompanyId ?? 0,
          query: String(formData.query ?? ""),
          contentType: String(formData.contentType ?? "").trim() || undefined,
          limit: formData.limit != null && formData.limit !== "" ? Number(formData.limit) : undefined,
          scoreThreshold:
            formData.scoreThreshold != null && formData.scoreThreshold !== ""
              ? Number(formData.scoreThreshold)
              : undefined,
        })
      } else if (activeAction === "actionDraft") {
        next = await actionDraft.mutateAsync({
          companyId: operatingCompanyId ?? 0,
          query: String(formData.query ?? ""),
          allowed_reducers: lines(formData.allowedReducers),
          ui_context: optionalJsonObject(formData.uiContextJson, "UI context"),
        })
      } else if (activeAction === "briefing") {
        next = await briefing.mutateAsync({
          companyId: operatingCompanyId ?? 0,
          window: String(formData.window ?? "").trim() || undefined,
          since_micros:
            formData.sinceMicros != null && formData.sinceMicros !== ""
              ? Number(formData.sinceMicros)
              : undefined,
          resources: lines(formData.resources),
          resource_filters: optionalJsonObject(formData.resourceFiltersJson, "Resource filters"),
        })
      } else if (activeAction === "importAnalyze") {
        next = await importAnalyze.mutateAsync({
          companyId: operatingCompanyId ?? 0,
          target_entity: String(formData.targetEntity ?? ""),
          header: lines(formData.header),
          sample_rows: optionalJsonArray(formData.sampleRowsJson, "Sample rows"),
          prior_mappings: optionalJsonObject(formData.priorMappingsJson, "Prior mappings"),
          instructions: String(formData.instructions ?? "").trim() || undefined,
        })
      } else if (activeAction === "runSkill") {
        const inputs: Record<string, unknown> = {
          query: String(formData.query ?? ""),
          ...(optionalJsonObject(formData.inputsJson, "Extra inputs") ?? {}),
        }
        const entityType = String(formData.entityType ?? "").trim()
        const entityIdRaw = formData.entityId
        if (entityType) inputs.entity_type = entityType
        if (entityIdRaw != null && entityIdRaw !== "") {
          inputs.entity_id = Number(entityIdRaw)
        }
        next = await runSkill.mutateAsync({
          companyId: operatingCompanyId ?? 0,
          skillKey: String(formData.skillKey ?? "report_analysis"),
          inputs,
        })
      } else {
        next = await importPreview.mutateAsync({
          companyId: operatingCompanyId ?? 0,
          target_entity: String(formData.targetEntity ?? ""),
          header: lines(formData.header),
          sample_rows: requiredJsonArray(formData.sampleRowsJson, "Sample rows"),
          mapping: requiredJsonObject(formData.mappingJson, "Mapping"),
          transforms: optionalJsonObject(formData.transformsJson, "Transforms"),
        })
      }
      setResult(next)
      setActiveAction(null)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-6">
      <DashboardHeader
        title="AI Harness"
        description="Run AI search, skills, action drafting, briefings, and import mapping tools."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className="rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/50"
            onClick={() => {
              setSubmitError(null)
              setActiveAction(action.id)
            }}
          >
            <p className="text-sm font-semibold">{action.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{action.description}</p>
          </button>
        ))}
      </div>

      {result ? (
        <AiResultPanel
          title="AI harness result"
          result={result}
          onDismiss={() => setResult(null)}
        />
      ) : null}

      {activeAction ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setActiveAction(null)
              setSubmitError(null)
            }
          }}
          config={aiHarnessForms[activeAction]}
          isPending={isPending}
          closeOnSubmit={false}
          submitError={submitError}
          onSubmit={handleSubmit}
        />
      ) : null}
    </div>
  )
}

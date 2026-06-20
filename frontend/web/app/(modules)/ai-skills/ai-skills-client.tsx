"use client"

import { useMemo, useState } from "react"
import { DashboardHeader, FormModal, MissingOrganization, type FormConfig } from "@lumiere/ui"
import {
  useAiSkills,
  useRunAiSkill,
  useSyncAiSkills,
  type AiSkillListItem,
} from "@lumiere/query-hooks/hooks/ai-skills"
import { AiResultPanel } from "@/lib/ai-result-panel"
import { hasValidOrganizationId } from "@/lib/org-scoped"
import { useDefaultOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"

const runSkillForm = (skillKey: string): FormConfig => ({
  id: "ai-skills-run",
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
          defaultValue: skillKey,
          required: true,
          width: "full",
        },
        {
          id: "query",
          type: "textarea",
          name: "query",
          label: "Query / goal",
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
})

function optionalJsonObject(value: unknown, label: string): Record<string, unknown> | undefined {
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw) return undefined
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return parsed as Record<string, unknown>
}

function skillSourceLabel(skill: AiSkillListItem): string {
  if (skill.source === "bundled_md") return "Local MD"
  if (skill.is_system) return "System (STDB)"
  return "Organization"
}

export function AiSkillsClient({ organizationId }: { organizationId?: number }) {
  if (!hasValidOrganizationId(organizationId)) return <MissingOrganization />
  return <AiSkillsLoaded organizationId={organizationId} />
}

function AiSkillsLoaded({ organizationId }: { organizationId: number }) {
  const operatingCompanyId = useDefaultOperatingCompanyId(organizationId)
  const { data: skills = [], isLoading, error } = useAiSkills()
  const runSkill = useRunAiSkill()
  const syncSkills = useSyncAiSkills()

  const [activeSkillKey, setActiveSkillKey] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)

  const sortedSkills = useMemo(
    () => [...skills].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    [skills],
  )

  const handleSync = async () => {
    setSyncMessage(null)
    try {
      const response = await syncSkills.mutateAsync()
      setSyncMessage(`Synced ${response.synced.length} bundled skill(s) to SpacetimeDB.`)
    } catch (e) {
      setSyncMessage(e instanceof Error ? e.message : String(e))
    }
  }

  const handleSubmit = async (formData: Record<string, unknown>) => {
    setSubmitError(null)
    const inputs: Record<string, unknown> = {
      ...(optionalJsonObject(formData.inputsJson, "Extra inputs") ?? {}),
    }
    const query = String(formData.query ?? "").trim()
    if (query) inputs.query = query
    const entityType = String(formData.entityType ?? "").trim()
    const entityIdRaw = formData.entityId
    if (entityType) inputs.entity_type = entityType
    if (entityIdRaw != null && entityIdRaw !== "") {
      inputs.entity_id = Number(entityIdRaw)
    }

    try {
      const next = await runSkill.mutateAsync({
        companyId: operatingCompanyId ?? 0,
        skillKey: String(formData.skillKey ?? activeSkillKey ?? "report_analysis"),
        inputs,
      })
      setResult(next as unknown as Record<string, unknown>)
      setActiveSkillKey(null)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-6">
      <DashboardHeader
        title="AI Skills"
        description="Run configurable ERP skills backed by local markdown playbooks and SpacetimeDB."
        actions={[
          {
            label: syncSkills.isPending ? "Syncing…" : "Sync bundled skills → STDB",
            onClick: () => void handleSync(),
            variant: "outline",
          },
        ]}
      />

      {syncMessage ? (
        <p className="text-sm text-muted-foreground" role="status">
          {syncMessage}
        </p>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error instanceof Error ? error.message : String(error)}
        </p>
      ) : null}

      {isLoading ? <p className="text-sm text-muted-foreground">Loading skills…</p> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sortedSkills.map((skill) => (
          <button
            key={`${skill.skill_key}-${skill.id}`}
            type="button"
            className="rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/50"
            onClick={() => {
              setSubmitError(null)
              setActiveSkillKey(skill.skill_key)
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold">{skill.name}</p>
              <span className="rounded bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {skillSourceLabel(skill)}
              </span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">{skill.skill_key}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {skill.description ?? `${skill.category} skill`}
            </p>
          </button>
        ))}
      </div>

      {result ? (
        <AiResultPanel title="Skill run result" result={result} onDismiss={() => setResult(null)} />
      ) : null}

      {activeSkillKey ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setActiveSkillKey(null)
              setSubmitError(null)
            }
          }}
          config={runSkillForm(activeSkillKey)}
          isPending={runSkill.isPending}
          closeOnSubmit={false}
          submitError={submitError}
          onSubmit={handleSubmit}
        />
      ) : null}
    </div>
  )
}

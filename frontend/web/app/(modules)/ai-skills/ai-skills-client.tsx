"use client"

import { useMemo, useState } from "react"
import { DashboardHeader, FormModal, MissingOrganization, type FormConfig } from "@lumiere/ui"
import {
  useAiSkills,
  useAiTeamMemberSkills,
  useAiTeamMembers,
  useAssignTeamMemberSkill,
  useCreateAiSkill,
  useRunAiSkill,
  useSetAiSkillActive,
  useSyncAiSkills,
  useUnassignTeamMemberSkill,
  useUpsertAiSkillConfig,
  type AiSkillListItem,
} from "@lumiere/query-hooks/hooks/ai-skills"
import { AiResultPanel } from "@/lib/ai-result-panel"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useDefaultOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"

export { AI_SKILLS_UI_REDUCERS } from "@/lib/ai-skills-ui-reducers"

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

const createSkillForm: FormConfig = {
  id: "ai-skills-create",
  title: "Create AI Skill",
  submitLabel: "Create skill",
  sections: [
    {
      id: "skill",
      fields: [
        { id: "skill-key", type: "text", name: "skillKey", label: "Skill key", required: true, width: "1/2" },
        { id: "name", type: "text", name: "name", label: "Name", required: true, width: "1/2" },
        { id: "category", type: "text", name: "category", label: "Category", defaultValue: "custom", width: "1/2" },
        {
          id: "description",
          type: "textarea",
          name: "description",
          label: "Description",
          rows: 2,
          width: "full",
        },
        {
          id: "prompt-template",
          type: "textarea",
          name: "promptTemplate",
          label: "Prompt template",
          required: true,
          rows: 4,
          width: "full",
        },
        {
          id: "required-tools",
          type: "text",
          name: "requiredTools",
          label: "Required tools (CSV)",
          width: "1/2",
        },
        {
          id: "optional-tools",
          type: "text",
          name: "optionalTools",
          label: "Optional tools (CSV)",
          width: "1/2",
        },
        {
          id: "default-max-steps",
          type: "number",
          name: "defaultMaxSteps",
          label: "Max steps",
          defaultValue: 8,
          width: "1/3",
        },
        {
          id: "default-max-tool-calls",
          type: "number",
          name: "defaultMaxToolCalls",
          label: "Max tool calls",
          defaultValue: 16,
          width: "1/3",
        },
        { id: "is-active", type: "switch", name: "isActive", label: "Active", defaultValue: true, width: "1/3" },
      ],
    },
  ],
}

const skillConfigForm = (skillId: number, skillName: string): FormConfig => ({
  id: "ai-skills-config",
  title: `Configure ${skillName}`,
  submitLabel: "Save config",
  sections: [
    {
      id: "config",
      fields: [
        {
          id: "skill-id",
          type: "number",
          name: "skillId",
          label: "Skill ID",
          defaultValue: skillId,
          required: true,
          width: "1/2",
        },
        { id: "is-enabled", type: "switch", name: "isEnabled", label: "Enabled", defaultValue: true, width: "1/2" },
        {
          id: "config-json",
          type: "textarea",
          name: "configJson",
          label: "Config JSON",
          defaultValue: "{}",
          rows: 4,
          width: "full",
        },
        {
          id: "custom-instructions",
          type: "textarea",
          name: "customInstructions",
          label: "Custom instructions",
          rows: 3,
          width: "full",
        },
      ],
    },
  ],
})

const setActiveSkillForm = (skillId: number, skillName: string): FormConfig => ({
  id: "ai-skills-set-active",
  title: `Set active — ${skillName}`,
  submitLabel: "Update",
  sections: [
    {
      id: "active",
      fields: [
        {
          id: "skill-id",
          type: "number",
          name: "skillId",
          label: "Skill ID",
          defaultValue: skillId,
          required: true,
          width: "1/2",
        },
        { id: "active", type: "switch", name: "active", label: "Active", defaultValue: true, width: "1/2" },
      ],
    },
  ],
})

const assignSkillForm: FormConfig = {
  id: "ai-skills-assign",
  title: "Assign Skill to Team Member",
  submitLabel: "Assign skill",
  sections: [
    {
      id: "assignment",
      fields: [
        {
          id: "team-member-id",
          type: "number",
          name: "teamMemberId",
          label: "Team member ID",
          required: true,
          width: "1/2",
        },
        { id: "skill-id", type: "number", name: "skillId", label: "Skill ID", required: true, width: "1/2" },
        {
          id: "module-hint",
          type: "text",
          name: "moduleHint",
          label: "Module hint (optional)",
          width: "1/2",
        },
        { id: "is-default", type: "switch", name: "isDefault", label: "Default skill", width: "1/2" },
      ],
    },
  ],
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

function csvList(value: unknown): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
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
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useDefaultOperatingCompanyId(organizationId)
  const { data: skills = [], isLoading, error } = useAiSkills()
  const { data: teamMembers = [] } = useAiTeamMembers(orgId)
  const { data: memberSkills = [] } = useAiTeamMemberSkills(orgId)
  const runSkill = useRunAiSkill()
  const syncSkills = useSyncAiSkills()
  const createSkill = useCreateAiSkill(organizationId)
  const setSkillActive = useSetAiSkillActive(organizationId)
  const upsertConfig = useUpsertAiSkillConfig()
  const assignSkill = useAssignTeamMemberSkill(organizationId)
  const unassignSkill = useUnassignTeamMemberSkill(organizationId)

  const [activeSkillKey, setActiveSkillKey] = useState<string | null>(null)
  const [modal, setModal] = useState<"create" | "assign" | "config" | "active" | null>(null)
  const [configSkill, setConfigSkill] = useState<{ id: number; name: string } | null>(null)
  const [activeSkillTarget, setActiveSkillTarget] = useState<{ id: number; name: string } | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)

  const sortedSkills = useMemo(
    () => [...skills].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    [skills],
  )

  const teamMemberNameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const row of teamMembers) {
      const id = Number(row.id)
      if (Number.isFinite(id) && id > 0) map.set(id, String(row.name ?? `Member #${id}`))
    }
    return map
  }, [teamMembers])

  const skillNameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const skill of skills) {
      if (skill.id > 0) map.set(skill.id, skill.name)
    }
    return map
  }, [skills])

  const handleSync = async () => {
    setSyncMessage(null)
    try {
      const response = await syncSkills.mutateAsync()
      setSyncMessage(`Synced ${response.synced.length} bundled skill(s) to SpacetimeDB.`)
    } catch (e) {
      setSyncMessage(e instanceof Error ? e.message : String(e))
    }
  }

  const handleRunSubmit = async (formData: Record<string, unknown>) => {
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

  const handleModalSubmit = async (formData: Record<string, unknown>) => {
    setSubmitError(null)
    try {
      if (modal === "create") {
        await createSkill.mutateAsync({
          skillKey: String(formData.skillKey ?? "").trim(),
          name: String(formData.name ?? "").trim(),
          description: String(formData.description ?? "").trim() || undefined,
          category: String(formData.category ?? "custom").trim(),
          promptTemplate: String(formData.promptTemplate ?? ""),
          requiredTools: csvList(formData.requiredTools),
          optionalTools: csvList(formData.optionalTools),
          defaultMaxSteps: Number(formData.defaultMaxSteps ?? 8),
          defaultMaxToolCalls: Number(formData.defaultMaxToolCalls ?? 16),
          outputSchema: undefined,
          configSchema: undefined,
          datasetSpecs: undefined,
          allowedActionDrafts: [],
          isActive: Boolean(formData.isActive),
          isSystem: false,
          metadata: undefined,
        })
        setModal(null)
      } else if (modal === "config" && configSkill) {
        const configRaw = String(formData.configJson ?? "{}").trim()
        JSON.parse(configRaw)
        await upsertConfig.mutateAsync({
          companyId: operatingCompanyId ?? undefined,
          skillId: configSkill.id,
          isEnabled: Boolean(formData.isEnabled),
          configJson: configRaw,
          customInstructions: String(formData.customInstructions ?? "").trim() || undefined,
        })
        setModal(null)
        setConfigSkill(null)
      } else if (modal === "assign") {
        await assignSkill.mutateAsync({
          teamMemberId: BigInt(Number(formData.teamMemberId)),
          skillId: BigInt(Number(formData.skillId)),
          isDefault: Boolean(formData.isDefault),
          moduleHint: String(formData.moduleHint ?? "").trim() || undefined,
        })
        setModal(null)
      } else if (modal === "active") {
        await setSkillActive.mutateAsync({
          skillId: Number(formData.skillId),
          active: Boolean(formData.active),
        })
        setModal(null)
        setActiveSkillTarget(null)
      }
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    }
  }

  const isPending =
    runSkill.isPending ||
    syncSkills.isPending ||
    createSkill.isPending ||
    setSkillActive.isPending ||
    upsertConfig.isPending ||
    assignSkill.isPending ||
    unassignSkill.isPending

  return (
    <div className="space-y-6">
      <DashboardHeader
        title="AI Skills"
        description="Run configurable ERP skills, manage org-specific playbooks, and assign skills to AI team members."
        actions={[
          {
            label: "Create skill",
            testId: "ai-skills-create",
            onClick: () => {
              setSubmitError(null)
              setModal("create")
            },
          },
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
          <div
            key={`${skill.skill_key}-${skill.id}`}
            className="rounded-xl border border-border bg-card p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <button
                type="button"
                className="text-left"
                onClick={() => {
                  setSubmitError(null)
                  setActiveSkillKey(skill.skill_key)
                }}
              >
                <p className="text-sm font-semibold hover:underline">{skill.name}</p>
              </button>
              <span className="rounded bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {skillSourceLabel(skill)}
              </span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">{skill.skill_key}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {skill.description ?? `${skill.category} skill`}
            </p>
            {skill.id > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="ai-skills-set-active"
                  className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted/50"
                  disabled={setSkillActive.isPending}
                  onClick={() => {
                    setSubmitError(null)
                    setActiveSkillTarget({ id: skill.id, name: skill.name })
                    setModal("active")
                  }}
                >
                  Set active
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted/50"
                  onClick={() => {
                    setSubmitError(null)
                    setConfigSkill({ id: skill.id, name: skill.name })
                    setModal("config")
                  }}
                >
                  Configure
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4">
          <div>
            <h2 className="text-base font-semibold">Team member skill assignments</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Link AI personas to skills they may run by default.
            </p>
          </div>
          <button
            type="button"
            data-testid="ai-skills-assign"
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/50"
            onClick={() => {
              setSubmitError(null)
              setModal("assign")
            }}
          >
            Assign skill
          </button>
        </div>
        <div className="divide-y divide-border">
          {memberSkills.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">No skill assignments yet.</p>
          ) : (
            memberSkills.map((row) => {
              const assignmentId = Number(row.id)
              const memberId = Number(row.teamMemberId ?? row.team_member_id)
              const skillId = Number(row.skillId ?? row.skill_id)
              return (
                <div
                  key={String(row.id)}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {teamMemberNameById.get(memberId) ?? `Member #${memberId}`} →{" "}
                      {skillNameById.get(skillId) ?? `Skill #${skillId}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Assignment #{assignmentId}
                      {row.isDefault === true || row.is_default === true ? " · default" : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-destructive hover:underline"
                    disabled={unassignSkill.isPending}
                    onClick={() => {
                      if (!window.confirm("Remove this skill assignment?")) return
                      void unassignSkill.mutateAsync(assignmentId)
                    }}
                  >
                    Unassign
                  </button>
                </div>
              )
            })
          )}
        </div>
      </section>

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
          onSubmit={handleRunSubmit}
        />
      ) : null}

      {modal === "create" ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setModal(null)
              setSubmitError(null)
            }
          }}
          config={createSkillForm}
          isPending={isPending}
          closeOnSubmit={false}
          submitError={submitError}
          onSubmit={handleModalSubmit}
        />
      ) : null}

      {modal === "config" && configSkill ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setModal(null)
              setConfigSkill(null)
              setSubmitError(null)
            }
          }}
          config={skillConfigForm(configSkill.id, configSkill.name)}
          isPending={isPending}
          closeOnSubmit={false}
          submitError={submitError}
          onSubmit={handleModalSubmit}
        />
      ) : null}

      {modal === "assign" ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setModal(null)
              setSubmitError(null)
            }
          }}
          config={assignSkillForm}
          isPending={isPending}
          closeOnSubmit={false}
          submitError={submitError}
          onSubmit={handleModalSubmit}
        />
      ) : null}

      {modal === "active" && activeSkillTarget ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setModal(null)
              setActiveSkillTarget(null)
              setSubmitError(null)
            }
          }}
          config={setActiveSkillForm(activeSkillTarget.id, activeSkillTarget.name)}
          isPending={isPending}
          closeOnSubmit={false}
          submitError={submitError}
          onSubmit={handleModalSubmit}
        />
      ) : null}
    </div>
  )
}

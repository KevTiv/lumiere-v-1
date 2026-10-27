"use client"

import { recordOptions, withLinkedPickers } from "@/lib/linked-options"
import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { useConfirmDialog } from "@lumiere/ui/hooks/use-confirm-dialog"
import { toCreateAiSkillParams } from "@lumiere/erp-shared/ai-create-params"
import { DashboardHeader, FormModal, MissingOrganization, type FormConfig } from "@lumiere/ui"
import {
  useRegisteredAiSkills,
  useAiTeamMemberSkills,
  useAiTeamMembers,
  useAssignTeamMemberSkill,
  useAiAgentRuns,
  useCancelAiAgentRun,
  useCreateAiSkill,
  useSetAiSkillActive,
  useSyncAiSkills,
  useUnassignTeamMemberSkill,
  useUpsertAiSkillConfig,
  type AiSkillListItem,
} from "@lumiere/query-hooks/hooks/ai-skills"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useDefaultOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"

import { SkillRegistryPanel } from "./skill-registry-panel"

export { AI_SKILLS_UI_REDUCERS } from "@/lib/ai-skills-ui-reducers"

type Translate = ReturnType<typeof useTranslation>["t"]

const createSkillForm = (t: Translate): FormConfig => ({
  id: "ai-skills-create",
  title: t("aiSkills.forms.create.title"),
  submitLabel: t("aiSkills.actions.createSkill"),
  sections: [
    {
      id: "skill",
      fields: [
        { id: "skill-key", type: "text", name: "skillKey", label: t("aiSkills.fields.skillKey"), required: true, width: "1/2" },
        { id: "name", type: "text", name: "name", label: t("aiSkills.fields.name"), required: true, width: "1/2" },
        { id: "category", type: "text", name: "category", label: t("aiSkills.fields.category"), defaultValue: "custom", width: "1/2" },
        {
          id: "description",
          type: "textarea",
          name: "description",
          label: t("aiSkills.fields.description"),
          rows: 2,
          width: "full",
        },
        {
          id: "prompt-template",
          type: "textarea",
          name: "promptTemplate",
          label: t("aiSkills.fields.promptTemplate"),
          required: true,
          rows: 4,
          width: "full",
        },
        {
          id: "required-tools",
          type: "text",
          name: "requiredTools",
          label: t("aiSkills.fields.requiredToolsCsv"),
          width: "1/2",
        },
        {
          id: "optional-tools",
          type: "text",
          name: "optionalTools",
          label: t("aiSkills.fields.optionalToolsCsv"),
          width: "1/2",
        },
        {
          id: "default-max-steps",
          type: "number",
          name: "defaultMaxSteps",
          label: t("aiSkills.fields.maxSteps"),
          defaultValue: 8,
          width: "1/3",
        },
        {
          id: "default-max-tool-calls",
          type: "number",
          name: "defaultMaxToolCalls",
          label: t("aiSkills.fields.maxToolCalls"),
          defaultValue: 16,
          width: "1/3",
        },
        { id: "is-active", type: "switch", name: "isActive", label: t("aiSkills.fields.active"), defaultValue: true, width: "1/3" },
      ],
    },
  ],
})

const skillConfigForm = (t: Translate, skillId: number, skillName: string): FormConfig => ({
  id: "ai-skills-config",
  title: t("aiSkills.forms.configure.title", { skillName }),
  submitLabel: t("aiSkills.actions.saveConfig"),
  sections: [
    {
      id: "config",
      fields: [
        {
          id: "skill-id",
          type: "number",
          name: "skillId",
          label: t("aiSkills.fields.skillId"),
          defaultValue: skillId,
          required: true,
          width: "1/2",
        },
        { id: "is-enabled", type: "switch", name: "isEnabled", label: t("aiSkills.fields.enabled"), defaultValue: true, width: "1/2" },
        {
          id: "config-json",
          type: "textarea",
          name: "configJson",
          label: t("aiSkills.fields.configJson"),
          defaultValue: "{}",
          rows: 4,
          width: "full",
        },
        {
          id: "custom-instructions",
          type: "textarea",
          name: "customInstructions",
          label: t("aiSkills.fields.customInstructions"),
          rows: 3,
          width: "full",
        },
      ],
    },
  ],
})

const setActiveSkillForm = (t: Translate, skillId: number, skillName: string): FormConfig => ({
  id: "ai-skills-set-active",
  title: t("aiSkills.forms.setActive.title", { skillName }),
  submitLabel: t("aiSkills.actions.update"),
  sections: [
    {
      id: "active",
      fields: [
        {
          id: "skill-id",
          type: "number",
          name: "skillId",
          label: t("aiSkills.fields.skillId"),
          defaultValue: skillId,
          required: true,
          width: "1/2",
        },
        { id: "active", type: "switch", name: "active", label: t("aiSkills.fields.active"), defaultValue: true, width: "1/2" },
      ],
    },
  ],
})

const assignSkillForm = (t: Translate): FormConfig => ({
  id: "ai-skills-assign",
  title: t("aiSkills.forms.assign.title"),
  submitLabel: t("aiSkills.actions.assignSkill"),
  sections: [
    {
      id: "assignment",
      fields: [
        {
          id: "team-member-id",
          type: "number",
          name: "teamMemberId",
          label: t("aiSkills.fields.teamMemberId"),
          required: true,
          width: "1/2",
        },
        { id: "skill-id", type: "number", name: "skillId", label: t("aiSkills.fields.skillId"), required: true, width: "1/2" },
        {
          id: "module-hint",
          type: "text",
          name: "moduleHint",
          label: t("aiSkills.fields.moduleHintOptional"),
          width: "1/2",
        },
        { id: "is-default", type: "switch", name: "isDefault", label: t("aiSkills.fields.defaultSkill"), width: "1/2" },
      ],
    },
  ],
})

function skillSourceLabel(t: Translate, skill: AiSkillListItem): string {
  if (skill.source === "bundled_md") return t("aiSkills.sources.localMd")
  if (skill.is_system) return t("aiSkills.sources.systemStdb")
  return t("aiSkills.sources.organization")
}

function agentRunStatusLabel(t: Translate, status: string): string {
  if (status === "running") return t("aiSkills.agentRuns.status.running")
  if (status === "pending") return t("aiSkills.agentRuns.status.pending")
  if (status === "awaiting_approval") return t("aiSkills.agentRuns.status.awaitingApproval")
  if (status === "agent_settled") return t("aiSkills.agentRuns.status.agentSettled")
  if (status === "budget_parked") return t("aiSkills.agentRuns.status.budgetParked")
  if (status === "completed") return t("aiSkills.agentRuns.status.completed")
  if (status === "cancelled") return t("aiSkills.agentRuns.status.cancelled")
  if (status === "failed") return t("aiSkills.agentRuns.status.failed")
  return status
}

export function AiSkillsClient({ organizationId }: { organizationId?: number }) {
  if (!hasValidOrganizationId(organizationId)) return <MissingOrganization />
  return <AiSkillsLoaded organizationId={organizationId} />
}

function AiSkillsLoaded({ organizationId }: { organizationId: number }) {
  const { t } = useTranslation()
  const { confirm: confirmDialog, dialog: confirmDialogNode } = useConfirmDialog()
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useDefaultOperatingCompanyId(organizationId)
  const { data: skills = [], isLoading, error } = useRegisteredAiSkills(organizationId)
  const { data: teamMembers = [] } = useAiTeamMembers(orgId)
  const { data: memberSkills = [] } = useAiTeamMemberSkills(orgId)
  const syncSkills = useSyncAiSkills()
  const createSkill = useCreateAiSkill(organizationId)
  const setSkillActive = useSetAiSkillActive(organizationId)
  const upsertConfig = useUpsertAiSkillConfig()
  const assignSkill = useAssignTeamMemberSkill(organizationId)
  const unassignSkill = useUnassignTeamMemberSkill(organizationId)
  const { data: agentRuns = [] } = useAiAgentRuns(organizationId)
  const cancelRun = useCancelAiAgentRun(organizationId, operatingCompanyId ?? undefined)

  const [modal, setModal] = useState<"create" | "assign" | "config" | "active" | null>(null)
  const [configSkill, setConfigSkill] = useState<{ id: number; name: string } | null>(null)
  const [activeSkillTarget, setActiveSkillTarget] = useState<{ id: number; name: string } | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

  const closeModal = () => {
    setModal(null)
    setConfigSkill(null)
    setActiveSkillTarget(null)
    setSubmitError(null)
  }

  const sortedSkills = useMemo(
    () => [...skills].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    [skills],
  )

  const teamMemberNameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const row of teamMembers) {
      const id = Number(row.id)
      if (Number.isFinite(id) && id > 0) {
        map.set(id, String(row.name ?? t("aiSkills.labels.memberNumber", { id })))
      }
    }
    return map
  }, [teamMembers, t])

  const assignSkillPickerForm = useMemo(
    () =>
      withLinkedPickers(assignSkillForm(t), {
        teamMemberId: recordOptions(teamMembers as unknown as Record<string, unknown>[], (row) => row.name),
        skillId: recordOptions(skills as unknown as Record<string, unknown>[], (row) => row.name),
      }),
    [teamMembers, skills, t],
  )

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
      setSyncMessage(t("aiSkills.messages.syncSuccess", { count: response.synced.length }))
    } catch (e) {
      setSyncMessage(e instanceof Error ? e.message : String(e))
    }
  }

  const handleModalSubmit = async (formData: Record<string, unknown>) => {
    setSubmitError(null)
    try {
      if (modal === "create") {
        const params = toCreateAiSkillParams(formData)
        if (!params) throw new Error(t("common.paramsMapper.invalidSkill"))
        await createSkill.mutateAsync(params)
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
    syncSkills.isPending ||
    createSkill.isPending ||
    setSkillActive.isPending ||
    upsertConfig.isPending ||
    assignSkill.isPending ||
    unassignSkill.isPending

  return (
    <div className="space-y-6">
      <DashboardHeader
        title={t("aiSkills.title")}
        description={t("aiSkills.description")}
        actions={[
          {
            label: t("aiSkills.actions.createSkill"),
            testId: "ai-skills-create",
            onClick: () => {
              setSubmitError(null)
              setModal("create")
            },
          },
          {
            label: syncSkills.isPending
              ? t("aiSkills.actions.syncing")
              : t("aiSkills.actions.syncBundledSkills"),
            onClick: () => handleSync(),
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

      {isLoading ? <p className="text-sm text-muted-foreground">{t("aiSkills.states.loadingSkills")}</p> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sortedSkills.map((skill) => (
          <div
            key={`${skill.skill_key}-${skill.id}`}
            className="rounded-xl border border-border bg-card p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold">{skill.name}</p>
              <span className="rounded bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {skillSourceLabel(t, skill)}
              </span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">{skill.skill_key}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {skill.description ?? t("aiSkills.labels.categorySkill", { category: skill.category })}
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
                  {t("aiSkills.actions.setActive")}
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
                  {t("aiSkills.actions.configure")}
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <SkillRegistryPanel
        organizationId={orgId}
        companyId={operatingCompanyId}
        skills={sortedSkills.filter((skill) => skill.id > 0)}
      />

      <section className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4">
          <div>
            <h2 className="text-base font-semibold">{t("aiSkills.assignments.title")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("aiSkills.assignments.description")}
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
            {t("aiSkills.actions.assignSkill")}
          </button>
        </div>
        <div className="divide-y divide-border">
          {memberSkills.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">{t("aiSkills.assignments.empty")}</p>
          ) : (
            memberSkills.map((row) => {
              const assignmentId = Number(row.id)
              const memberId = Number(row.teamMemberId)
              const skillId = Number(row.skillId)
              return (
                <div
                  key={String(row.id)}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {teamMemberNameById.get(memberId) ?? t("aiSkills.labels.memberNumber", { id: memberId })} →{" "}
                      {skillNameById.get(skillId) ?? t("aiSkills.labels.skillNumber", { id: skillId })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("aiSkills.labels.assignmentNumber", { id: assignmentId })}
                      {row.isDefault ? t("aiSkills.labels.defaultSuffix") : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-destructive hover:underline"
                    disabled={unassignSkill.isPending}
                    onClick={async () => {
                      if (!(await confirmDialog({ description: t("aiSkills.confirm.removeAssignment") }))) return
                      unassignSkill.mutateAsync(assignmentId).catch((e) => setSubmitError(String(e)))
                    }}
                  >
                    {t("aiSkills.actions.unassign")}
                  </button>
                </div>
              )
            })
          )}
        </div>
      </section>

      {modal === "create" ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) closeModal()
          }}
          config={createSkillForm(t)}
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
            if (!open) closeModal()
          }}
          config={skillConfigForm(t, configSkill.id, configSkill.name)}
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
            if (!open) closeModal()
          }}
          config={assignSkillPickerForm}
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
            if (!open) closeModal()
          }}
          config={setActiveSkillForm(t, activeSkillTarget.id, activeSkillTarget.name)}
          isPending={isPending}
          closeOnSubmit={false}
          submitError={submitError}
          onSubmit={handleModalSubmit}
        />
      ) : null}

      <section className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid="ai-agent-runs-panel">
        <h2 className="text-base font-semibold">{t("aiSkills.agentRuns.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("aiSkills.agentRuns.description")}</p>
        {agentRuns.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("aiSkills.agentRuns.empty")}</p>
        ) : (
          <ul className="space-y-2">
            {agentRuns.map((run) => (
              <li key={run.id} className="flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{run.run_key || t("aiSkills.labels.number", { id: run.id })}</p>
                  <p className="text-xs text-muted-foreground">
                    {agentRunStatusLabel(t, run.status)}
                    {run.summary ? ` — ${run.summary}` : ""}
                    {run.step_count != null ? t("aiSkills.agentRuns.stepCount", { count: run.step_count }) : ""}
                  </p>
                </div>
                {["running", "pending", "awaiting_approval", "agent_settled"].includes(run.status) ? (
                  <button
                    type="button"
                    className="text-xs underline"
                    onClick={() =>
                      void cancelRun.mutateAsync(run.id).catch((e) => setSubmitError(String(e)))
                    }
                  >
                    {t("aiSkills.actions.cancel")}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      {confirmDialogNode}
    </div>
  )
}

"use client"

import { useMemo, useRef, useState } from "react"
import { useTranslation } from "@lumiere/i18n"

import {
  useAiKnowledgeSkillPromotions,
  useAiSkillCertificationRequests,
  useAiSkillFixtures,
  useAiSkillReleases,
  useAiSkillVersions,
  useCreateAiSkillFixture,
  useCreateAiSkillVersion,
  usePromoteAiSkillVersion,
  useProposeAiKnowledgeSkillPromotion,
  useRequestAiSkillCertification,
  useReviewAiKnowledgeSkillPromotion,
  useRollbackAiSkillRelease,
  useRunPublishedAiSkill,
  versionWorkflowStatus,
  type AiSkillCertificationRequestRow,
  type AiSkillReleaseRow,
  type AiSkillVersionRow,
} from "@lumiere/query-hooks/hooks/ai-skill-registry"
import type { AiSkillListItem } from "@lumiere/query-hooks/hooks/ai-skills"
import { Button, Input } from "@lumiere/ui"
import { Textarea } from "@lumiere/ui/components/textarea"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@lumiere/ui/components/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface SkillRegistryPanelProps {
  organizationId: bigint
  companyId: number | null
  skills: AiSkillListItem[]
}

function versionId(row: AiSkillVersionRow): number {
  return Number(row.id)
}

function releaseId(row: AiSkillReleaseRow): number {
  return Number(row.id)
}

type Translate = ReturnType<typeof useTranslation>["t"]

function workflowStatusLabel(t: Translate, status: ReturnType<typeof versionWorkflowStatus>): string {
  return t(`aiSkills.registry.status.${status}`)
}

function registryStatusLabel(t: Translate, status: string): string {
  if (status === "queued") return t("aiSkills.registry.status.queued")
  if (status === "running") return t("aiSkills.registry.status.running")
  if (status === "errored") return t("aiSkills.registry.status.errored")
  if (status === "completed") return t("aiSkills.registry.status.completed")
  if (status === "passed") return t("aiSkills.registry.status.passed")
  if (status === "proposed") return t("aiSkills.registry.status.proposed")
  if (status === "accepted") return t("aiSkills.registry.status.accepted")
  if (status === "rejected") return t("aiSkills.registry.status.rejected")
  if (status === "not_requested") return t("aiSkills.registry.status.notRequested")
  if (status === "unknown") return t("aiSkills.registry.status.unknown")
  return status
}

function canonicalExample(raw: string): string {
  const serialize = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`
    if (value === null || typeof value !== "object") return JSON.stringify(value)
    const entries = Object.entries(value)
      .sort(([left], [right]) => compareJsonKeys(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${serialize(entry)}`)
    return `{${entries.join(",")}}`
  }
  return serialize(JSON.parse(raw))
}

function compareJsonKeys(left: string, right: string): number {
  const leftChars = Array.from(left)
  const rightChars = Array.from(right)
  for (let index = 0; index < Math.min(leftChars.length, rightChars.length); index += 1) {
    const difference = leftChars[index].codePointAt(0)! - rightChars[index].codePointAt(0)!
    if (difference !== 0) return difference
  }
  return leftChars.length - rightChars.length
}

function hasProjectionExecutor(version: AiSkillVersionRow) {
  return (version.executor ?? null) === "json_projection_v1"
}

function latestDraftTest(
  versionId: number,
  fixtureId: number,
  requests: AiSkillCertificationRequestRow[],
) {
  return requests.reduce<AiSkillCertificationRequestRow | undefined>((latest, row) => {
    if (row.readiness?.code.startsWith("projection_")
      && Number(row.skillVersionId ?? row.skill_version_id) === versionId
      && Number(row.fixtureId ?? row.fixture_id) === fixtureId
      && (!latest || Number(row.id) > Number(latest.id))) return row
    return latest
  }, undefined)
}

function draftVersionFromFixture(metadata: string | undefined): number | undefined {
  try {
    return JSON.parse(metadata ?? "{}")?.draftVersionId
  } catch {
    return undefined
  }
}

function projectionStarter(skillKey: string) {
  return JSON.stringify({
    executor: "json_projection_v1",
    fields: { name: "/customer/name" },
    limits: { max_steps: 1, max_tool_calls: 1 },
    output_types: ["application/json"],
    permissions: [],
    resources: [],
    risk: "green",
    schema_version: 1,
    skill_key: skillKey,
    version: "1.0.0",
  }, null, 2)
}

async function versionManifest(rawManifest: string): Promise<string> {
  const manifest = JSON.parse(rawManifest)
  if (manifest?.executor !== "json_projection_v1") return rawManifest
  const source = canonicalExample(JSON.stringify(manifest.fields ?? {}))
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(source))
  manifest.source_hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")
  return canonicalExample(JSON.stringify(manifest))
}

export function SkillRegistryPanel({ organizationId, companyId, skills }: SkillRegistryPanelProps) {
  const { t } = useTranslation()
  const orgNumber = Number(organizationId)
  const versions = useAiSkillVersions(organizationId, skills.length > 0)
  const releases = useAiSkillReleases(organizationId, skills.length > 0)
  const knowledgePromotions = useAiKnowledgeSkillPromotions(organizationId, companyId)

  const createFixture = useCreateAiSkillFixture(orgNumber)
  const createVersion = useCreateAiSkillVersion(orgNumber)
  const requestDraftTest = useRequestAiSkillCertification(orgNumber)
  const runPublishedSkill = useRunPublishedAiSkill()
  const promoteVersion = usePromoteAiSkillVersion(orgNumber)
  const rollbackRelease = useRollbackAiSkillRelease(orgNumber)
  const proposeKnowledge = useProposeAiKnowledgeSkillPromotion(orgNumber, companyId)
  const reviewKnowledge = useReviewAiKnowledgeSkillPromotion(orgNumber, companyId)

  const [selectedSkillId, setSelectedSkillId] = useState<number>(() => skills[0]?.id ?? 0)
  const [manifestJson, setManifestJson] = useState("")
  const [draftTestVersionId, setDraftTestVersionId] = useState<number | null>(null)
  const [testingDraft, setTestingDraft] = useState(false)
  const [exampleName, setExampleName] = useState("")
  const [exampleInput, setExampleInput] = useState('{"customer":{"name":"Sample Customer"}}')
  const [exampleExpected, setExampleExpected] = useState('{"name":"Sample Customer"}')
  const [runInput, setRunInput] = useState('{"customer":{"name":"Sample Customer"}}')
  const [runResult, setRunResult] = useState<{ skillVersionId: number; output: unknown } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [knowledgeVersionId, setKnowledgeVersionId] = useState("")
  const [promotionReviewNote, setPromotionReviewNote] = useState("")
  const [activationVersionId, setActivationVersionId] = useState<number | null>(null)
  const [activationNote, setActivationNote] = useState("")
  const [activationConfirmed, setActivationConfirmed] = useState(false)
  const requestKeys = useRef(new Map<string, string>())

  const effectiveSkillId = skills.some((skill) => skill.id === selectedSkillId)
    ? selectedSkillId
    : (skills[0]?.id ?? 0)

  const skillVersions = useMemo(
    () =>
      (versions.data ?? []).filter(
        (row) => Number(row.skillId ?? row.skill_id) === effectiveSkillId,
      ),
    [versions.data, effectiveSkillId],
  )

  const skillReleases = useMemo(
    () =>
      (releases.data ?? []).filter(
        (row) => Number(row.skillId ?? row.skill_id) === effectiveSkillId,
      ),
    [releases.data, effectiveSkillId],
  )

  const fixtures = useAiSkillFixtures(organizationId, draftTestVersionId != null)
  const draftTests = useAiSkillCertificationRequests(
    organizationId,
    draftTestVersionId != null,
    draftTestVersionId,
  )
  const skillFixtures = (fixtures.data ?? []).filter((fixture) =>
    Number(fixture.skillId ?? fixture.skill_id) === effectiveSkillId
    && draftVersionFromFixture(fixture.metadata) === draftTestVersionId,
  )

  const activeRelease = skillReleases.find(
    (release) => release.isActive === true || release.is_active === true,
  )

  const selectedSkill = skills.find((skill) => skill.id === effectiveSkillId)
  const publishedVersionId = Number(activeRelease?.skillVersionId ?? activeRelease?.skill_version_id)
  const publishedProjection = skillVersions.some((version) =>
    versionId(version) === publishedVersionId && hasProjectionExecutor(version),
  )
  const activationVersion = skillVersions.find((version) => versionId(version) === activationVersionId)
  const activationTested = !activationVersion || !hasProjectionExecutor(activationVersion)
    || (draftTestVersionId === activationVersionId && skillFixtures.length > 0
      && skillFixtures.every((fixture) =>
        latestDraftTest(activationVersionId!, Number(fixture.id), draftTests.data ?? [])?.readiness?.ready,
      ))
  const registryLoading = versions.isLoading || releases.isLoading
  const registryError = versions.error ?? releases.error ?? null

  async function retryRegistry() {
    setActionError(null)
    await Promise.all([versions.refetch(), releases.refetch()])
  }

  async function runAction(action: () => Promise<void>) {
    setActionError(null)
    try {
      await action()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  async function saveExample() {
    if (draftTestVersionId == null) return
    await createFixture.mutateAsync({
      skillId: BigInt(effectiveSkillId),
      fixtureKey: globalThis.crypto.randomUUID(),
      name: exampleName.trim(),
      description: undefined,
      inputJson: canonicalExample(exampleInput),
      expectedOutputJson: canonicalExample(exampleExpected),
      metadata: JSON.stringify({ draftVersionId: draftTestVersionId }),
    })
    setExampleName("")
    await fixtures.refetch()
  }

  async function testDraft() {
    if (companyId == null || draftTestVersionId == null || !skillFixtures.length) return
    setTestingDraft(true)
    try {
      for (const fixture of skillFixtures) {
        await requestDraftTest.mutateAsync({
          companyId,
          skillVersionId: draftTestVersionId,
          fixtureId: Number(fixture.id),
          idempotencyKey: `projection:${companyId}:${draftTestVersionId}:${fixture.id}`,
        })
      }
    } finally {
      await draftTests.refetch()
      setTestingDraft(false)
    }
  }

  async function executePublishedSkill() {
    if (companyId == null) return
    setRunResult(null)
    setRunResult(await runPublishedSkill.mutateAsync({
      skillId: effectiveSkillId,
      companyId,
      input: JSON.parse(runInput),
    }))
  }

  async function proposeSelectedKnowledge() {
    const versionId = Number(knowledgeVersionId)
    if (!Number.isInteger(versionId) || versionId <= 0 || !selectedSkill) {
      throw new Error(t("aiSkills.registry.errors.invalidKnowledgeVersion"))
    }
    const tuple = `promotion:${organizationId}:${companyId ?? 0}:${versionId}:${selectedSkill.id}`
    const idempotencyKey = requestKeys.current.get(tuple) ?? globalThis.crypto.randomUUID()
    requestKeys.current.set(tuple, idempotencyKey)
    await proposeKnowledge.mutateAsync({
      knowledgeVersionId: versionId,
      skillId: selectedSkill.id,
      skillKey: selectedSkill.skill_key,
      skillName: selectedSkill.name,
      manifestJson,
      idempotencyKey,
    })
    requestKeys.current.delete(tuple)
    setKnowledgeVersionId("")
  }

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-4">
        <h2 className="text-base font-semibold">{t("aiSkills.registry.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("aiSkills.registry.description")}
        </p>
      </div>

      <div className="flex flex-col gap-6 p-4">
        {skills.length > 0 ? <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("aiSkills.registry.fields.skill")}</span>
            <Select value={String(effectiveSkillId)} onValueChange={(value) => {
              setSelectedSkillId(Number(value))
              setDraftTestVersionId(null)
              setRunInput('{"customer":{"name":"Sample Customer"}}')
              setRunResult(null)
              setActionError(null)
            }}>
              <SelectTrigger className="min-w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {skills.map((skill) => (
                  <SelectItem key={skill.id} value={String(skill.id)}>
                    {skill.name} ({skill.skill_key})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {activeRelease ? (
            <p className="text-sm text-muted-foreground">
              {t("aiSkills.registry.activeRelease", {
                releaseNumber: Number(activeRelease.releaseNumber ?? activeRelease.release_number),
                versionId: Number(activeRelease.skillVersionId ?? activeRelease.skill_version_id),
              })}
            </p>
          ) : (
            <p className="text-sm text-amber-600 dark:text-amber-400">{t("aiSkills.registry.noActiveRelease")}</p>
          )}
        </div> : null}

        {actionError ? (
          <p className="text-sm text-destructive" role="alert">
            {actionError}
          </p>
        ) : null}

        {registryLoading ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t("aiSkills.registry.states.loadingVersions")}
          </p>
        ) : null}

        {registryError ? (
          <div className="flex flex-wrap items-center gap-3" role="alert">
            <p className="text-sm text-destructive">
              {registryError instanceof Error
                ? registryError.message
                : t("aiSkills.registry.errors.loadVersions")}
            </p>
            <Button size="sm" variant="outline" onClick={() => void retryRegistry()}>
              {t("aiSkills.registry.actions.retry")}
            </Button>
          </div>
        ) : null}

        {!registryLoading && !registryError && skills.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("aiSkills.registry.empty.noSkillVersionsAvailable")}
          </p>
        ) : null}

        {!registryLoading && !registryError && skills.length > 0 ? (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <h3 className="text-sm font-medium">{t("aiSkills.registry.sections.versions")}</h3>
            {skillVersions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("aiSkills.registry.empty.noVersions")}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {skillVersions.map((version) => {
                  const id = versionId(version)
                  const status = versionWorkflowStatus(id, skillReleases)
                  return (
                    <li
                      key={id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-3 py-2"
                    >
                      <div>
                        <p className="font-medium">
                          v{version.version} · {String(version.risk ?? "").toLowerCase()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {workflowStatusLabel(t, status)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                      {hasProjectionExecutor(version) && status === "reviewed" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setDraftTestVersionId(id)
                            setActionError(null)
                          }}
                        >
                          {t("aiSkills.registry.draftTest.title", { defaultValue: "Test draft" })}
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={promoteVersion.isPending || status === "promoted"}
                        onClick={() => {
                          if (hasProjectionExecutor(version)) setDraftTestVersionId(id)
                          setActivationVersionId(id)
                          setActivationNote("")
                          setActivationConfirmed(false)
                          setActionError(null)
                        }}
                      >
                        {t("aiSkills.registry.validation.reviewActivate", { defaultValue: "Review and activate" })}
                      </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            {draftTestVersionId != null ? (
              <div className="space-y-3 rounded-md border border-border p-3">
                <h4 className="font-medium">{t("aiSkills.registry.draftTest.examples", { defaultValue: "Test examples" })} · v{skillVersions.find((version) => versionId(version) === draftTestVersionId)?.version}</h4>
                <p className="text-sm text-muted-foreground">{t("aiSkills.registry.draftTest.exampleHelp", { defaultValue: "Use sample data. Every saved example must pass before this skill version can be published." })}</p>
                <label className="grid gap-1 text-sm">
                  <span>{t("aiSkills.registry.draftTest.name", { defaultValue: "Example name" })}</span>
                  <Input value={exampleName} maxLength={120} onChange={(event) => setExampleName(event.target.value)} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>{t("aiSkills.registry.draftTest.input", { defaultValue: "Sample input JSON" })}</span>
                  <Textarea variant="plain" rows={3} value={exampleInput} onChange={(event) => setExampleInput(event.target.value)} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>{t("aiSkills.registry.draftTest.expected", { defaultValue: "Expected output JSON" })}</span>
                  <Textarea variant="plain" rows={3} value={exampleExpected} onChange={(event) => setExampleExpected(event.target.value)} />
                </label>
                <Button size="sm" variant="outline" disabled={!exampleName.trim() || createFixture.isPending} onClick={() => void runAction(saveExample)}>
                  {t("aiSkills.registry.draftTest.saveExample", { defaultValue: "Save example" })}
                </Button>
                {fixtures.isError || draftTests.isError ? (
                  <p className="text-sm text-destructive" role="alert">{t("aiSkills.registry.draftTest.loadError", { defaultValue: "Could not load test examples or results." })}</p>
                ) : null}
                {companyId == null ? (
                  <p className="text-sm text-muted-foreground">{t("aiSkills.registry.draftTest.companyRequired", { defaultValue: "Select a company to run draft tests." })}</p>
                ) : null}
                {skillFixtures.length > 0 ? (
                  <ul className="space-y-2" aria-label={t("aiSkills.registry.draftTest.results", { defaultValue: "Draft test results" })}>
                    {skillFixtures.map((fixture) => {
                      const latest = latestDraftTest(draftTestVersionId, Number(fixture.id), draftTests.data ?? [])
                      return (
                        <li key={String(fixture.id)} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span>{fixture.name}</span>
                          <span>
                            {latest?.readiness?.ready
                              ? t("aiSkills.registry.draftTest.pass", { defaultValue: "Passed" })
                              : latest
                                ? t(latest.readiness?.code === "projection_input_invalid"
                                  ? "aiSkills.registry.draftTest.badInput"
                                  : "aiSkills.registry.draftTest.mismatch",
                                { defaultValue: latest.readiness?.code === "projection_input_invalid" ? "Input could not be evaluated" : "Output differed from expected" })
                                : t("aiSkills.registry.draftTest.pending", { defaultValue: "Awaiting test" })}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
                <Button size="sm" disabled={!companyId || !skillFixtures.length || testingDraft} onClick={() => void runAction(testDraft)}>
                  {t("aiSkills.registry.draftTest.runAll", { defaultValue: "Run all examples" })}
                </Button>
              </div>
            ) : null}

            {publishedProjection && companyId != null ? (
              <details className="space-y-2 rounded-md border border-border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  {t("aiSkills.registry.draftTest.runPublished", { defaultValue: "Run published skill" })}
                </summary>
                <label className="grid gap-1 text-sm">
                  <span>{t("aiSkills.registry.draftTest.runInput", { defaultValue: "Input JSON" })}</span>
                  <Textarea variant="plain" rows={3} value={runInput} onChange={(event) => setRunInput(event.target.value)} />
                </label>
                <Button size="sm" disabled={runPublishedSkill.isPending} onClick={() => void runAction(executePublishedSkill)}>
                  {t("aiSkills.registry.draftTest.run", { defaultValue: "Run skill" })}
                </Button>
                {runResult && runResult.skillVersionId === publishedVersionId ? (
                  <pre className="overflow-auto rounded-md bg-muted p-3 text-xs" role="status">
                    {JSON.stringify(runResult.output, null, 2)}
                  </pre>
                ) : null}
              </details>
            ) : null}

            <details className="space-y-2 border-t border-border pt-3">
              <summary className="cursor-pointer text-sm text-muted-foreground">{t("aiSkills.registry.validation.advanced", { defaultValue: "Advanced manifest" })}</summary>
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("aiSkills.registry.sections.createVersion")}
              </h4>
              {selectedSkill?.is_system === false ? (
                <Button size="sm" variant="outline" onClick={() => setManifestJson(projectionStarter(selectedSkill.skill_key))}>
                  {t("aiSkills.registry.draftTest.starter", { defaultValue: "Use JSON projection template" })}
                </Button>
              ) : null}
              <Textarea
                aria-label={t("aiSkills.registry.validation.advanced")}
                variant="plain"
                rows={6}
                value={manifestJson}
                onChange={(event) => setManifestJson(event.target.value)}
                className="font-mono text-xs"
              />
              <Button
                size="sm"
                disabled={!selectedSkill || !manifestJson.trim() || createVersion.isPending}
                onClick={() =>
                  void runAction(async () => {
                    await createVersion.mutateAsync({
                      skillId: BigInt(effectiveSkillId),
                      manifestJson: await versionManifest(manifestJson),
                      reviewNotes: "Created from AI Skills admin",
                      metadata: undefined,
                    })
                  })
                }
              >
                {t("aiSkills.registry.actions.createReviewedVersion")}
              </Button>
            </details>
          </div>
        ) : null}

        {!registryLoading && !registryError && skills.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t("aiSkills.registry.sections.releaseHistory")}</h3>
          {skillReleases.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("aiSkills.registry.empty.noReleases")}</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {skillReleases.map((release) => {
                const id = releaseId(release)
                const isActive = release.isActive === true || release.is_active === true
                return (
                  <li key={id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <div>
                      <p className="font-medium">
                        #{Number(release.releaseNumber ?? release.release_number)} ·{" "}
                        {release.action}
                        {isActive ? t("aiSkills.registry.release.activeSuffix") : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("aiSkills.registry.release.version", { versionId: Number(release.skillVersionId ?? release.skill_version_id) })}
                        {release.reason ? ` · ${release.reason}` : ""}
                      </p>
                    </div>
                    {!isActive ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={rollbackRelease.isPending}
                        onClick={() =>
                          void runAction(() =>
                            rollbackRelease.mutateAsync({
                              skillId: effectiveSkillId,
                              targetReleaseId: id,
                              reason: "Rollback from AI Skills admin",
                            }),
                          )
                        }
                      >
                        {t("aiSkills.registry.actions.rollBackToThis")}
                      </Button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        ) : null}

        {skills.length > 0 ? <div className="space-y-3 rounded-lg border border-border p-4">
          <div>
            <h3 className="text-sm font-medium">{t("aiSkills.registry.knowledge.title")}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("aiSkills.registry.knowledge.description")}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-[220px] flex-col gap-1 text-xs">
              <span className="text-muted-foreground">{t("aiSkills.registry.fields.approvedKnowledgeVersionId")}</span>
              <Input
                inputMode="numeric"
                value={knowledgeVersionId}
                onChange={(event) => setKnowledgeVersionId(event.target.value)}
              />
            </label>
            <Button
              size="sm"
              disabled={!companyId || !selectedSkill || !manifestJson.trim() || proposeKnowledge.isPending}
              onClick={() => void runAction(proposeSelectedKnowledge)}
            >
              {proposeKnowledge.isPending
                ? t("aiSkills.registry.actions.proposing")
                : t("aiSkills.registry.actions.proposeForReview")}
            </Button>
          </div>
          {knowledgePromotions.isLoading ? (
            <p className="text-sm text-muted-foreground" role="status">{t("aiSkills.registry.states.loadingPromotions")}</p>
          ) : knowledgePromotions.error ? (
            <div className="flex items-center gap-2" role="alert">
              <p className="text-sm text-destructive">{t("aiSkills.registry.errors.loadPromotions")}</p>
              <Button size="sm" variant="outline" onClick={() => void knowledgePromotions.refetch()}>{t("aiSkills.registry.actions.retry")}</Button>
            </div>
          ) : (knowledgePromotions.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("aiSkills.registry.empty.noPromotions")}</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {(knowledgePromotions.data ?? []).map((promotion) => {
                const status = String(promotion.status ?? "unknown").toLowerCase()
                return (
                  <li key={Number(promotion.id)} className="space-y-2 px-3 py-3">
                    <p className="font-medium">
                      {t("aiSkills.registry.knowledge.promotionSummary", {
                        versionId: Number(promotion.knowledgeVersionId ?? promotion.knowledge_version_id),
                        skillName: String(promotion.skillName ?? promotion.skill_name ?? promotion.skillKey ?? promotion.skill_key),
                      })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("aiSkills.registry.knowledge.reviewStatus", {
                        status: registryStatusLabel(t, status),
                      })}
                    </p>
                    {status === "proposed" ? (
                      <div className="flex flex-wrap gap-2">
                        <Input value={promotionReviewNote} onChange={(event) => setPromotionReviewNote(event.target.value)} placeholder={t("aiSkills.registry.placeholders.reviewNote")} />
                        {(["accepted", "rejected"] as const).map((outcome) => (
                          <Button
                            key={outcome}
                            size="sm"
                            variant={outcome === "accepted" ? "default" : "outline"}
                            disabled={reviewKnowledge.isPending}
                            onClick={() => void runAction(() => reviewKnowledge.mutateAsync({ promotionId: Number(promotion.id), outcome, note: promotionReviewNote.trim() || undefined }))}
                          >
                            {outcome === "accepted"
                              ? t("aiSkills.registry.actions.accept")
                              : t("aiSkills.registry.actions.reject")}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </div> : null}
      </div>
      <Dialog open={activationVersionId != null} onOpenChange={(open) => { if (!open) setActivationVersionId(null) }}>
        <DialogContent size="form" layout="bounded">
          <DialogHeader>
            <DialogTitle>{t("aiSkills.registry.validation.reviewActivate", { defaultValue: "Review and activate" })}</DialogTitle>
            <DialogDescription>{t("aiSkills.registry.validation.releaseApprovalPolicy", { defaultValue: "Owners and organization administrators can approve their own skill versions. Other authors and reviewers need an independent approver. The decision and approval note are recorded." })}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <p className="text-sm">{selectedSkill?.name} · v{activationVersion?.version} · {activationVersion?.risk}</p>
            {!activationTested ? (
              <p className="text-sm text-muted-foreground">
                {t("aiSkills.registry.draftTest.required", { defaultValue: "Every saved example must pass before activation. Close this dialog to run the draft tests." })}
              </p>
            ) : null}
            <label className="grid gap-1 text-sm">
              <span>{t("aiSkills.registry.validation.approvalNote")}</span>
              <Textarea variant="plain" rows={3} value={activationNote} maxLength={8000} onChange={(event) => setActivationNote(event.target.value)} />
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={activationConfirmed} onChange={(event) => setActivationConfirmed(event.target.checked)} />
              {t("aiSkills.registry.validation.confirmRelease", { defaultValue: "I reviewed this skill version and approve activation for this organization." })}
            </label>
            {actionError ? <p role="alert" className="text-sm text-destructive">{actionError}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" disabled={promoteVersion.isPending} onClick={() => setActivationVersionId(null)}>{t("common.cancel")}</Button>
            <Button disabled={!activationVersion || !activationTested || !activationNote.trim() || !activationConfirmed || promoteVersion.isPending} onClick={() => void runAction(async () => {
              if (activationVersionId == null || !activationVersion) return
              await promoteVersion.mutateAsync({ skillVersionId: activationVersionId, reason: activationNote.trim() })
              setActivationVersionId(null)
              if (draftTestVersionId === activationVersionId) setDraftTestVersionId(null)
            })}>{t("aiSkills.registry.validation.activateVersion", { defaultValue: "Activate skill version" })}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

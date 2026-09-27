"use client"

import { useMemo, useRef, useState } from "react"

import {
  certificationHasPassingEvidence,
  latestCertificationFor,
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
  versionWorkflowStatus,
  type AiSkillFixtureRow,
  type AiSkillReleaseRow,
  type AiSkillVersionRow,
} from "@lumiere/query-hooks/hooks/ai-skill-registry"
import type { AiSkillListItem } from "@lumiere/query-hooks/hooks/ai-skills"
import { Button, Input } from "@lumiere/ui"
import { Textarea } from "@lumiere/ui/components/textarea"

const DEFAULT_MANIFEST = `{"limits":{"max_steps":8,"max_tool_calls":16},"output_types":["application/json"],"permissions":["report:read"],"resources":["reports.daily_business_summary.v1"],"risk":"green","schema_version":1,"skill_key":"report_composer","source_hash":"sha256:${"a".repeat(64)}","version":"1.0.1"}`

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

function fixtureRowId(row: AiSkillFixtureRow): number {
  return Number(row.id)
}

function certificationButtonLabel(passed: boolean, requestStatus: string): string {
  if (passed) return "Passed"
  if (requestStatus === "queued") return "Queued"
  if (requestStatus === "running") return "Running"
  if (requestStatus === "errored" || requestStatus === "completed") return "Retry certification"
  return "Run certification"
}

function versionCertificationHint(
  status: string,
  fixtureCount: number,
  certificationReady: boolean,
): string {
  if (status === "promoted") return ""
  if (fixtureCount === 0) return " · certification blocked: fixture required"
  if (certificationReady) return " · certification passed"
  return " · certification pending"
}

export function SkillRegistryPanel({ organizationId, companyId, skills }: SkillRegistryPanelProps) {
  const orgNumber = Number(organizationId)
  const versions = useAiSkillVersions(organizationId)
  const releases = useAiSkillReleases(organizationId)
  const fixtures = useAiSkillFixtures(organizationId)
  const certifications = useAiSkillCertificationRequests(organizationId)
  const knowledgePromotions = useAiKnowledgeSkillPromotions(organizationId, companyId)

  const createVersion = useCreateAiSkillVersion(orgNumber)
  const createFixture = useCreateAiSkillFixture(orgNumber)
  const requestCertification = useRequestAiSkillCertification(orgNumber)
  const promoteVersion = usePromoteAiSkillVersion(orgNumber)
  const rollbackRelease = useRollbackAiSkillRelease(orgNumber)
  const proposeKnowledge = useProposeAiKnowledgeSkillPromotion(orgNumber, companyId)
  const reviewKnowledge = useReviewAiKnowledgeSkillPromotion(orgNumber, companyId)

  const [selectedSkillId, setSelectedSkillId] = useState<number>(() => skills[0]?.id ?? 0)
  const [manifestJson, setManifestJson] = useState(DEFAULT_MANIFEST)
  const [fixtureKey, setFixtureKey] = useState("smoke-001")
  const [fixtureName, setFixtureName] = useState("Smoke fixture")
  const [fixtureInputJson, setFixtureInputJson] = useState(
    '{"reportKey":"daily_business_summary_v1","companyId":1,"date":"2026-07-10","timezone":"UTC"}',
  )
  const [fixtureExpectedJson, setFixtureExpectedJson] = useState(
    '{"items":[],"reportKey":"daily_business_summary_v1","title":"Daily Business Summary"}',
  )
  const [actionError, setActionError] = useState<string | null>(null)
  const [knowledgeVersionId, setKnowledgeVersionId] = useState("")
  const [promotionReviewNote, setPromotionReviewNote] = useState("")
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

  const skillFixtures = useMemo(
    () =>
      (fixtures.data ?? []).filter(
        (row) => Number(row.skillId ?? row.skill_id) === effectiveSkillId,
      ),
    [fixtures.data, effectiveSkillId],
  )

  const activeRelease = skillReleases.find(
    (release) => release.isActive === true || release.is_active === true,
  )

  const selectedSkill = skills.find((skill) => skill.id === effectiveSkillId)

  const registryLoading =
    versions.isLoading || releases.isLoading || fixtures.isLoading || certifications.isLoading
  const registryError =
    versions.error ?? releases.error ?? fixtures.error ?? certifications.error ?? null

  async function retryRegistry() {
    setActionError(null)
    await Promise.all([
      versions.refetch(),
      releases.refetch(),
      fixtures.refetch(),
      certifications.refetch(),
    ])
  }

  function certificationRequestKey(fixtureId: number, versionId: number): string {
    const tuple = `${organizationId}:${companyId ?? 0}:${versionId}:${fixtureId}`
    const existing = requestKeys.current.get(tuple)
    if (existing) return existing
    const created = globalThis.crypto.randomUUID()
    requestKeys.current.set(tuple, created)
    return created
  }

  function clearCertificationRequestKey(fixtureId: number, versionId: number) {
    requestKeys.current.delete(`${organizationId}:${companyId ?? 0}:${versionId}:${fixtureId}`)
  }

  async function runAction(action: () => Promise<void>) {
    setActionError(null)
    try {
      await action()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  async function proposeSelectedKnowledge() {
    const versionId = Number(knowledgeVersionId)
    if (!Number.isInteger(versionId) || versionId <= 0 || !selectedSkill) {
      throw new Error("Enter a positive approved knowledge version id and select a skill")
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
        <h2 className="text-base font-semibold">Skill registry</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Review immutable skill versions, run server-owned fixture certification, and manage
          release history.
        </p>
      </div>

      <div className="flex flex-col gap-6 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Skill</span>
            <select
              className="min-w-[220px] rounded-md border border-border bg-background px-3 py-2"
              value={effectiveSkillId}
              onChange={(event) => setSelectedSkillId(Number(event.target.value))}
            >
              {skills.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skill.name} ({skill.skill_key})
                </option>
              ))}
            </select>
          </label>
          {activeRelease ? (
            <p className="text-sm text-muted-foreground">
              Active release #{Number(activeRelease.releaseNumber ?? activeRelease.release_number)} ·
              version id {Number(activeRelease.skillVersionId ?? activeRelease.skill_version_id)}
            </p>
          ) : (
            <p className="text-sm text-amber-600 dark:text-amber-400">No active release</p>
          )}
        </div>

        {actionError ? (
          <p className="text-sm text-destructive" role="alert">
            {actionError}
          </p>
        ) : null}

        {registryLoading ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading persisted certification state…
          </p>
        ) : null}

        {registryError ? (
          <div className="flex flex-wrap items-center gap-3" role="alert">
            <p className="text-sm text-destructive">
              {registryError instanceof Error
                ? registryError.message
                : "Failed to load persisted certification state"}
            </p>
            <Button size="sm" variant="outline" onClick={() => void retryRegistry()}>
              Retry
            </Button>
          </div>
        ) : null}

        {!registryLoading && !registryError && skills.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No persisted skills are available for certification.
          </p>
        ) : null}

        {!registryLoading && !registryError && skills.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-lg border border-border p-4">
            <h3 className="text-sm font-medium">Versions</h3>
            {skillVersions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No versions for this skill yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {skillVersions.map((version) => {
                  const id = versionId(version)
                  const status = versionWorkflowStatus(id, skillReleases)
                  const certificationReady =
                    skillFixtures.length > 0 &&
                    skillFixtures.every((fixture) =>
                      certificationHasPassingEvidence(
                        fixtureRowId(fixture),
                        id,
                        certifications.data ?? [],
                        [],
                      ),
                    )
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
                          {status}
                          {versionCertificationHint(status, skillFixtures.length, certificationReady)}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          promoteVersion.isPending || status === "promoted" || !certificationReady
                        }
                        onClick={() =>
                          void runAction(() =>
                            promoteVersion.mutateAsync({
                              skillVersionId: id,
                              reason: "Promoted from AI Skills admin",
                            }),
                          )
                        }
                      >
                        Promote
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="space-y-2 border-t border-border pt-3">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Create version
              </h4>
              <Textarea
                rows={6}
                value={manifestJson}
                onChange={(event) => setManifestJson(event.target.value)}
                className="font-mono text-xs"
              />
              <Button
                size="sm"
                disabled={!effectiveSkillId || createVersion.isPending}
                onClick={() =>
                  void runAction(async () => {
                    const skillKey = selectedSkill?.skill_key ?? "report_composer"
                    const normalized = manifestJson.replace(
                      /"skill_key":"[^"]+"/,
                      `"skill_key":"${skillKey}"`,
                    )
                    await createVersion.mutateAsync({
                      skillId: BigInt(effectiveSkillId),
                      manifestJson: normalized,
                      reviewNotes: "Created from AI Skills admin",
                      metadata: undefined,
                    })
                  })
                }
              >
                Create reviewed version
              </Button>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-border p-4">
            <h3 className="text-sm font-medium">Fixtures & test runs</h3>
            {!companyId ? (
              <p className="text-sm text-amber-600 dark:text-amber-400" role="status">
                Select an operating company before requesting certification.
              </p>
            ) : null}
            {skillFixtures.length === 0 ? (
              <p className="text-sm text-muted-foreground">No fixtures yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {skillFixtures.map((fixture) => {
                  const fixtureId = fixtureRowId(fixture)
                  return (
                    <li key={fixtureId} className="rounded border border-border px-3 py-2">
                      <p className="font-medium">{fixture.name}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {skillVersions.map((version) => {
                          const vid = versionId(version)
                          const request = latestCertificationFor(
                            fixtureId,
                            vid,
                            certifications.data ?? [],
                          )
                          const requestStatus = String(request?.status ?? "").toLowerCase()
                          const passed = certificationHasPassingEvidence(
                            fixtureId,
                            vid,
                            certifications.data ?? [],
                            [],
                          )
                          const active = requestStatus === "queued" || requestStatus === "running"
                          const label = certificationButtonLabel(passed, requestStatus)
                          return (
                            <Button
                              key={`${fixtureId}-${vid}`}
                              size="sm"
                              variant={passed ? "secondary" : "outline"}
                              disabled={
                                !companyId ||
                                active ||
                                passed ||
                                requestCertification.isPending
                              }
                              onClick={() =>
                                void runAction(async () => {
                                  await requestCertification.mutateAsync({
                                    companyId: companyId ?? 0,
                                    skillVersionId: vid,
                                    fixtureId,
                                    idempotencyKey: certificationRequestKey(fixtureId, vid),
                                  })
                                  clearCertificationRequestKey(fixtureId, vid)
                                })
                              }
                            >
                              {label} · v{version.version}
                            </Button>
                          )
                        })}
                      </div>
                      {skillVersions.map((version) => {
                        const vid = versionId(version)
                        const request = latestCertificationFor(
                          fixtureId,
                          vid,
                          certifications.data ?? [],
                        )
                        if (!request) return null
                        const readinessCode = request.readiness?.code ?? "readiness_unknown"
                        const evidence = request.evidence
                        return (
                          <div
                            key={`evidence-${fixtureId}-${vid}`}
                            className="mt-2 rounded bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground"
                          >
                            <p>
                              v{version.version} · request #{Number(request.id)} · {String(request.status ?? "unknown")} · {readinessCode}
                            </p>
                            {evidence ? (
                              <p className="mt-1 font-mono text-[10px] break-all">
                                evidence #{Number(evidence.id)} · {String(evidence.status ?? "unknown")} · {String(evidence.executionEvidenceHash ?? evidence.execution_evidence_hash ?? "no execution hash")}
                              </p>
                            ) : (
                              <p className="mt-1">No terminal evidence has been persisted.</p>
                            )}
                          </div>
                        )
                      })}
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="space-y-2 border-t border-border pt-3">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Add fixture
              </h4>
              <Input value={fixtureKey} onChange={(event) => setFixtureKey(event.target.value)} placeholder="fixture key" />
              <Input value={fixtureName} onChange={(event) => setFixtureName(event.target.value)} placeholder="name" />
              <Textarea
                rows={3}
                className="font-mono text-xs"
                value={fixtureInputJson}
                onChange={(event) => setFixtureInputJson(event.target.value)}
              />
              <Textarea
                rows={3}
                className="font-mono text-xs"
                value={fixtureExpectedJson}
                onChange={(event) => setFixtureExpectedJson(event.target.value)}
              />
              <Button
                size="sm"
                disabled={!effectiveSkillId || createFixture.isPending}
                onClick={() =>
                  void runAction(() =>
                    createFixture.mutateAsync({
                      skillId: BigInt(effectiveSkillId),
                      fixtureKey,
                      name: fixtureName,
                      description: "Created from AI Skills admin",
                      inputJson: fixtureInputJson,
                      expectedOutputJson: fixtureExpectedJson,
                      metadata: undefined,
                    }),
                  )
                }
              >
                Create fixture
              </Button>
            </div>
          </div>
        </div>
        ) : null}

        {!registryLoading && !registryError && skills.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Release history</h3>
          {skillReleases.length === 0 ? (
            <p className="text-sm text-muted-foreground">No releases recorded.</p>
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
                        {isActive ? " · active" : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        version {Number(release.skillVersionId ?? release.skill_version_id)}
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
                        Roll back to this
                      </Button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        ) : null}

        <div className="space-y-3 rounded-lg border border-border p-4">
          <div>
            <h3 className="text-sm font-medium">Knowledge promotion</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Independent acceptance creates an unreleased skill version. The server binds the
              reviewed knowledge lineage; certification and release remain gated above.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-[220px] flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Approved knowledge version id</span>
              <Input
                inputMode="numeric"
                value={knowledgeVersionId}
                onChange={(event) => setKnowledgeVersionId(event.target.value)}
              />
            </label>
            <Button
              size="sm"
              disabled={!companyId || !selectedSkill || proposeKnowledge.isPending}
              onClick={() => void runAction(proposeSelectedKnowledge)}
            >
              {proposeKnowledge.isPending ? "Proposing…" : "Propose for review"}
            </Button>
          </div>
          {knowledgePromotions.isLoading ? (
            <p className="text-sm text-muted-foreground" role="status">Loading persisted promotions…</p>
          ) : knowledgePromotions.error ? (
            <div className="flex items-center gap-2" role="alert">
              <p className="text-sm text-destructive">Failed to load knowledge promotions.</p>
              <Button size="sm" variant="outline" onClick={() => void knowledgePromotions.refetch()}>Retry</Button>
            </div>
          ) : (knowledgePromotions.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No persisted knowledge promotions.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {(knowledgePromotions.data ?? []).map((promotion) => {
                const status = String(promotion.status ?? "unknown").toLowerCase()
                return (
                  <li key={Number(promotion.id)} className="space-y-2 px-3 py-3">
                    <p className="font-medium">
                      Knowledge version {Number(promotion.knowledgeVersionId ?? promotion.knowledge_version_id)} → {String(promotion.skillName ?? promotion.skill_name ?? promotion.skillKey ?? promotion.skill_key)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {status} · certification {String(promotion.certificationState ?? promotion.certification_state ?? "not_requested")}
                    </p>
                    {status === "proposed" ? (
                      <div className="flex flex-wrap gap-2">
                        <Input value={promotionReviewNote} onChange={(event) => setPromotionReviewNote(event.target.value)} placeholder="Independent review note" />
                        {(["accepted", "rejected"] as const).map((outcome) => (
                          <Button
                            key={outcome}
                            size="sm"
                            variant={outcome === "accepted" ? "default" : "outline"}
                            disabled={reviewKnowledge.isPending}
                            onClick={() => void runAction(() => reviewKnowledge.mutateAsync({ promotionId: Number(promotion.id), outcome, note: promotionReviewNote.trim() || undefined }))}
                          >
                            {outcome === "accepted" ? "Accept" : "Reject"}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

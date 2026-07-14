"use client"

import { useMemo, useState } from "react"

import {
  fixtureHasPassingRun,
  useAiSkillFixtures,
  useAiSkillReleases,
  useAiSkillTestRuns,
  useAiSkillVersions,
  useCreateAiSkillFixture,
  useCreateAiSkillVersion,
  usePromoteAiSkillVersion,
  useRecordAiSkillTestRun,
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

export function SkillRegistryPanel({ organizationId, skills }: SkillRegistryPanelProps) {
  const orgNumber = Number(organizationId)
  const versions = useAiSkillVersions(organizationId)
  const releases = useAiSkillReleases(organizationId)
  const fixtures = useAiSkillFixtures(organizationId)
  const testRuns = useAiSkillTestRuns(organizationId)

  const createVersion = useCreateAiSkillVersion(orgNumber)
  const createFixture = useCreateAiSkillFixture(orgNumber)
  const recordTestRun = useRecordAiSkillTestRun(orgNumber)
  const promoteVersion = usePromoteAiSkillVersion(orgNumber)
  const rollbackRelease = useRollbackAiSkillRelease(orgNumber)

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

  const skillVersions = useMemo(
    () =>
      (versions.data ?? []).filter(
        (row) => Number(row.skillId ?? row.skill_id) === selectedSkillId,
      ),
    [versions.data, selectedSkillId],
  )

  const skillReleases = useMemo(
    () =>
      (releases.data ?? []).filter(
        (row) => Number(row.skillId ?? row.skill_id) === selectedSkillId,
      ),
    [releases.data, selectedSkillId],
  )

  const skillFixtures = useMemo(
    () =>
      (fixtures.data ?? []).filter(
        (row) => Number(row.skillId ?? row.skill_id) === selectedSkillId,
      ),
    [fixtures.data, selectedSkillId],
  )

  const activeRelease = skillReleases.find(
    (release) => release.isActive === true || release.is_active === true,
  )

  const selectedSkill = skills.find((skill) => skill.id === selectedSkillId)

  async function runAction(action: () => Promise<void>) {
    setActionError(null)
    try {
      await action()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-4">
        <h2 className="text-base font-semibold">Skill registry</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Review immutable skill versions, record fixture test runs, and promote or roll back active
          releases.
        </p>
      </div>

      <div className="flex flex-col gap-6 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Skill</span>
            <select
              className="min-w-[220px] rounded-md border border-border bg-background px-3 py-2"
              value={selectedSkillId}
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
                  const fixturesReady =
                    skillFixtures.length === 0 ||
                    skillFixtures.every((fixture) =>
                      fixtureHasPassingRun(fixtureRowId(fixture), id, testRuns.data ?? []),
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
                          {skillFixtures.length > 0
                            ? fixturesReady
                              ? " · fixtures passed"
                              : " · fixtures pending"
                            : ""}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          promoteVersion.isPending || status === "promoted" || !fixturesReady
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
                disabled={!selectedSkillId || createVersion.isPending}
                onClick={() =>
                  void runAction(async () => {
                    const skillKey = selectedSkill?.skill_key ?? "report_composer"
                    const normalized = manifestJson.replace(
                      /"skill_key":"[^"]+"/,
                      `"skill_key":"${skillKey}"`,
                    )
                    await createVersion.mutateAsync({
                      skillId: BigInt(selectedSkillId),
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
                          const passed = fixtureHasPassingRun(
                            fixtureId,
                            vid,
                            testRuns.data ?? [],
                          )
                          return (
                            <Button
                              key={`${fixtureId}-${vid}`}
                              size="sm"
                              variant={passed ? "secondary" : "outline"}
                              disabled={recordTestRun.isPending}
                              onClick={() =>
                                void runAction(() =>
                                  recordTestRun.mutateAsync({
                                    skillVersionId: BigInt(vid),
                                    fixtureId: BigInt(fixtureId),
                                    actualOutputJson:
                                      fixture.expectedOutputJson ??
                                      fixture.expected_output_json ??
                                      "{}",
                                    failureReason: undefined,
                                    metadata: undefined,
                                  }),
                                )
                              }
                            >
                              {passed ? "Passed" : "Record pass"} v{version.version}
                            </Button>
                          )
                        })}
                      </div>
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
                disabled={!selectedSkillId || createFixture.isPending}
                onClick={() =>
                  void runAction(() =>
                    createFixture.mutateAsync({
                      skillId: BigInt(selectedSkillId),
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
                              skillId: selectedSkillId,
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
      </div>
    </section>
  )
}

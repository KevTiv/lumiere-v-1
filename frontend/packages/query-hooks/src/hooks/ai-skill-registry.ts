"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { aiSkillsBffPost } from "@lumiere/stdb/commands"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import type {
  CreateAiSkillFixtureParams,
  CreateAiSkillVersionParams,
} from "@lumiere/stdb/types"

import { apiFetch, fetchQueryList, rqBigIntKey, type QueryRows } from "../http"

export type AiSkillVersionRow = {
  id: number
  skillId?: number
  skill_id?: number
  skillKey?: string
  skill_key?: string
  version?: string
  risk?: string
  sourceHash?: string
  source_hash?: string
  reviewNotes?: string
  review_notes?: string
  createdAt?: string
  created_at?: string
}

export type AiSkillReleaseRow = {
  id: number
  skillId?: number
  skill_id?: number
  skillVersionId?: number
  skill_version_id?: number
  releaseNumber?: number
  release_number?: number
  isActive?: boolean
  is_active?: boolean
  action?: string
  releasedAt?: string
  released_at?: string
  reason?: string
}

export type AiSkillFixtureRow = {
  id: number
  skillId?: number
  skill_id?: number
  name?: string
  fixtureKey?: string
  fixture_key?: string
  inputJson?: string
  input_json?: string
  expectedOutputJson?: string
  expected_output_json?: string
}

export type AiSkillTestRunRow = {
  id: number
  certificationRequestId?: number
  certification_request_id?: number
  skillVersionId?: number
  skill_version_id?: number
  fixtureId?: number
  fixture_id?: number
  status?: string
  executedAt?: string
  executed_at?: string
  failureReason?: string
  failure_reason?: string
}

export type AiSkillCertificationRequestRow = {
  id: number
  companyId?: number
  company_id?: number
  skillId?: number
  skill_id?: number
  skillVersionId?: number
  skill_version_id?: number
  fixtureId?: number
  fixture_id?: number
  status?: string
  requestedAt?: string
  requested_at?: string
  claimedAt?: string
  claimed_at?: string
  terminalAt?: string
  terminal_at?: string
  errorCode?: string
  error_code?: string
  hasCurrentPassingEvidence?: boolean
}

function registryQueryKey(organizationId: bigint, resource: string) {
  return ["ai-skill-registry", resource, rqBigIntKey(organizationId)] as const
}

function rowId(row: QueryRows[number]): number {
  const raw = row.id
  return typeof raw === "bigint" ? Number(raw) : Number(raw ?? 0)
}

function rowSkillId(row: AiSkillVersionRow | AiSkillReleaseRow | AiSkillFixtureRow): number {
  return Number(row.skillId ?? row.skill_id ?? 0)
}

export function useAiSkillVersions(organizationId: bigint, enabled = true) {
  return useQuery({
    queryKey: registryQueryKey(organizationId, "versions"),
    enabled: enabled && organizationId > 0n,
    queryFn: async () => {
      const rows = await fetchQueryList(
        "/api/query/ai-skill-versions",
        "Failed to fetch AI skill versions",
      )
      return rows as AiSkillVersionRow[]
    },
    staleTime: 15_000,
  })
}

export function useAiSkillReleases(organizationId: bigint, enabled = true) {
  return useQuery({
    queryKey: registryQueryKey(organizationId, "releases"),
    enabled: enabled && organizationId > 0n,
    queryFn: async () => {
      const rows = await fetchQueryList(
        "/api/query/ai-skill-releases",
        "Failed to fetch AI skill releases",
      )
      return rows as AiSkillReleaseRow[]
    },
    staleTime: 15_000,
  })
}

export function useAiSkillFixtures(organizationId: bigint, enabled = true) {
  return useQuery({
    queryKey: registryQueryKey(organizationId, "fixtures"),
    enabled: enabled && organizationId > 0n,
    queryFn: async () => {
      const rows = await fetchQueryList(
        "/api/query/ai-skill-fixtures",
        "Failed to fetch AI skill fixtures",
      )
      return rows as AiSkillFixtureRow[]
    },
    staleTime: 15_000,
  })
}

export function useAiSkillTestRuns(organizationId: bigint, enabled = true) {
  return useQuery({
    queryKey: registryQueryKey(organizationId, "test-runs"),
    enabled: enabled && organizationId > 0n,
    queryFn: async () => {
      const rows = await fetchQueryList(
        "/api/query/ai-skill-test-runs",
        "Failed to fetch AI skill test runs",
      )
      return rows as AiSkillTestRunRow[]
    },
    staleTime: 15_000,
  })
}

export function useAiSkillCertificationRequests(organizationId: bigint, enabled = true) {
  return useQuery({
    queryKey: registryQueryKey(organizationId, "certifications"),
    enabled: enabled && organizationId > 0n,
    queryFn: async () => {
      const rows = await fetchQueryList(
        "/api/ai/skills/certifications",
        "Failed to fetch AI skill certifications",
      )
      return rows as AiSkillCertificationRequestRow[]
    },
    staleTime: 2_000,
    refetchInterval: (query) => {
      const rows = (query.state.data ?? []) as AiSkillCertificationRequestRow[]
      return rows.some((row) => {
        const status = String(row.status ?? "").toLowerCase()
        return status === "queued" || status === "running"
      })
        ? 2_000
        : false
    },
  })
}

export function versionWorkflowStatus(
  versionId: number,
  releases: AiSkillReleaseRow[],
): "reviewed" | "promoted" | "superseded" {
  const related = releases.filter(
    (release) => Number(release.skillVersionId ?? release.skill_version_id) === versionId,
  )
  if (related.some((release) => release.isActive === true || release.is_active === true)) {
    return "promoted"
  }
  if (related.length > 0) return "superseded"
  return "reviewed"
}

export function latestCertificationFor(
  fixtureId: number,
  versionId: number,
  requests: AiSkillCertificationRequestRow[],
): AiSkillCertificationRequestRow | undefined {
  return requests
    .filter(
      (request) =>
        Number(request.fixtureId ?? request.fixture_id) === fixtureId &&
        Number(request.skillVersionId ?? request.skill_version_id) === versionId,
    )
    .sort((left, right) => Number(right.id) - Number(left.id))[0]
}

export function certificationHasPassingEvidence(
  fixtureId: number,
  versionId: number,
  requests: AiSkillCertificationRequestRow[],
  runs: AiSkillTestRunRow[],
): boolean {
  const request = latestCertificationFor(fixtureId, versionId, requests)
  if (
    !request ||
    request.hasCurrentPassingEvidence !== true ||
    String(request.status ?? "").toLowerCase() !== "completed"
  ) {
    return false
  }
  return runs.some(
    (run) =>
      Number(run.certificationRequestId ?? run.certification_request_id) === Number(request.id) &&
      Number(run.fixtureId ?? run.fixture_id) === fixtureId &&
      Number(run.skillVersionId ?? run.skill_version_id) === versionId &&
      String(run.status ?? "").toLowerCase() === "passed",
  )
}

import { responseErrorMessage as parseCallError } from "@lumiere/api-client/response-error"

function invalidateRegistry(qc: ReturnType<typeof useQueryClient>, organizationId: number) {
  const org = BigInt(organizationId)
  void qc.invalidateQueries({ queryKey: ["ai-skill-registry", "versions", rqBigIntKey(org)] })
  void qc.invalidateQueries({ queryKey: ["ai-skill-registry", "releases", rqBigIntKey(org)] })
  void qc.invalidateQueries({ queryKey: ["ai-skill-registry", "fixtures", rqBigIntKey(org)] })
  void qc.invalidateQueries({ queryKey: ["ai-skill-registry", "test-runs", rqBigIntKey(org)] })
  void qc.invalidateQueries({ queryKey: ["ai-skill-registry", "certifications", rqBigIntKey(org)] })
}

export function useCreateAiSkillVersion(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: CreateAiSkillVersionParams) => {
      const { urlPath, init } = aiSkillsBffPost("create_ai_skill_version", [
        organizationId,
        stdbParamsToJson(params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateRegistry(qc, organizationId),
  })
}

export function useCreateAiSkillFixture(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: CreateAiSkillFixtureParams) => {
      const { urlPath, init } = aiSkillsBffPost("create_ai_skill_fixture", [
        organizationId,
        stdbParamsToJson(params as object),
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateRegistry(qc, organizationId),
  })
}

export function useRequestAiSkillCertification(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      companyId: number
      skillVersionId: number
      fixtureId: number
      idempotencyKey: string
    }) => {
      const response = await apiFetch("/api/ai/skills/certifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      })
      if (!response.ok) throw new Error(await parseCallError(response))
    },
    onSuccess: () => invalidateRegistry(qc, organizationId),
  })
}

export function usePromoteAiSkillVersion(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { skillVersionId: number; reason?: string }) => {
      const { urlPath, init } = aiSkillsBffPost("promote_ai_skill_version", [
        organizationId,
        args.skillVersionId,
        args.reason ?? null,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateRegistry(qc, organizationId),
  })
}

export function useRollbackAiSkillRelease(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { skillId: number; targetReleaseId: number; reason: string }) => {
      const { urlPath, init } = aiSkillsBffPost("rollback_ai_skill_release", [
        organizationId,
        args.skillId,
        args.targetReleaseId,
        args.reason,
      ])
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateRegistry(qc, organizationId),
  })
}

export { rowId, rowSkillId }

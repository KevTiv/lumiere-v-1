"use client"

import { useQuery } from "@tanstack/react-query"
import { z } from "zod"
import { apiFetch } from "./api-fetch"

type Scope = { identity: string; organizationId: number; companyId: number }
const id = z.string().regex(/^[1-9]\d{0,19}$/)
const revision = z.number().int().min(1).max(2_147_483_647)
const positionSchema = z.object({
  reviewId: id,
  group: z.string().min(1).max(512),
  itemId: id.nullable(),
  itemRevision: revision.nullable(),
  revision,
}).refine((value) => (value.itemId == null) === (value.itemRevision == null))
const task = z.string().regex(/^[a-f0-9]{32}$/)
const envelopeSchema = z.object({
  organizationId: id,
  companyId: id,
  taskId: task,
  status: z.enum(["empty", "saved", "stale"]),
  checkpoint: positionSchema.nullable(),
}).refine((value) => (value.status === "empty") === (value.checkpoint == null))

export type ReviewCheckpoint = z.infer<typeof positionSchema>
export type ReviewCheckpointDraft = Omit<ReviewCheckpoint, "revision"> & { expectedRevision: number }

function endpoint(taskId: string) {
  return "/api/import-tasks/" + task.parse(taskId) + "/review-checkpoint"
}

export function importReviewCheckpointKey(scope: Scope, taskId: string) {
  return ["import-review-checkpoint", scope.identity.replace(/^0x/i, "").toLowerCase(), scope.organizationId, scope.companyId, taskId] as const
}

async function readEnvelope(response: Response, scope: Scope, taskId: string) {
  if (!response.ok) throw Object.assign(new Error("The review checkpoint could not be verified."), { status: response.status })
  const envelope = envelopeSchema.parse(await response.json())
  if (envelope.organizationId !== String(scope.organizationId) || envelope.companyId !== String(scope.companyId) || envelope.taskId !== taskId)
    throw new Error("Review checkpoint belongs to another workspace.")
  return envelope
}

export function useImportReviewCheckpoint(scope: Scope, taskId: string, enabled = true) {
  return useQuery({
    queryKey: importReviewCheckpointKey(scope, taskId),
    queryFn: async ({ signal }) => readEnvelope(await apiFetch(
      endpoint(taskId) + "?companyId=" + scope.companyId, { signal, cache: "no-store" },
    ), scope, taskId),
    retry: false,
    enabled: enabled && task.safeParse(taskId).success,
  })
}

export async function saveImportReviewCheckpoint(scope: Scope, taskId: string, position: ReviewCheckpointDraft) {
  return readEnvelope(await apiFetch(endpoint(taskId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId: scope.companyId, ...position }),
  }), scope, taskId)
}

/** Resolve the exact current question without putting stale values into an editor. */
export function resolveImportReviewCheckpoint<Row extends { id: string; revision: number; state: string }>(
  saved: ReviewCheckpoint,
  reviewId: string,
  rows: readonly Row[],
  groups: readonly { key: string; itemIds: readonly string[] }[],
): { group: string; item: Row | null } | null {
  if (saved.reviewId !== reviewId) return null
  const group = groups.find((candidate) => candidate.key === saved.group)
  if (saved.group !== "all" && !group) return null
  const item = saved.itemId == null ? null : rows.find((row) => row.id === saved.itemId)
  if (saved.itemId != null && (!item || item.revision !== saved.itemRevision || item.state !== "needs_review"
    || (group && !group.itemIds.includes(item.id)))) return null
  if (!rows.some((row) => row.state === "needs_review")) return null
  return { group: saved.group, item: item ?? null }
}

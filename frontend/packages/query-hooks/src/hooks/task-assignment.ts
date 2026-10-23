import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { encodeIdentity } from "@lumiere/erp-shared/stdb-params-json"
import { parseStrictU64, scalarToU64, type ScalarId } from "@lumiere/erp-shared/u64"

import { resolveUniqueRow, type CanonicalRecordRef } from "./operation-effect"

interface IdentityWire {
  toHex?: unknown
  __identity__?: unknown
  hex?: unknown
  Hex?: unknown
  some?: unknown
}
interface TaskAssigneeWire { id?: unknown; name?: unknown }

/** Accept canonical HTTP identities and SDK values without treating numeric user ids as identities. */
export function taskIdentityHex(value: unknown, depth = 0): string | undefined {
  if (depth > 4) return undefined
  if (typeof value === "string") {
    const hex = value.trim().replace(/^0x/i, "").toLowerCase()
    return /^[0-9a-f]{64}$/.test(hex) ? hex : undefined
  }
  if (value && typeof value === "object") {
    const record = value as IdentityWire
    if (typeof record.toHex === "function") {
      return taskIdentityHex(record.toHex.call(value), depth + 1)
    }
    return taskIdentityHex(record.__identity__ ?? record.hex ?? record.Hex ?? record.some, depth + 1)
  }
  return undefined
}

export function taskAssigneeIds(values: readonly unknown[]): string[] {
  const ids = values.map((value) => {
    const id = taskIdentityHex(value)
    if (!id) throw new Error("Select a valid task assignee")
    return id
  })
  if (new Set(ids).size !== ids.length) throw new Error("Task assignees contain duplicates")
  return ids
}

export function buildTaskAssignmentCommand(taskId: ScalarId, userIds: readonly string[]) {
  const id = scalarToU64(taskId)
  if (id === 0n) throw new Error("Select a task")
  return stdbBffCommandPost("assign_task_users", {
    taskId: id.toString(),
    userIds: taskAssigneeIds(userIds).map(encodeIdentity),
  })
}

export type TaskAssigneeOption = { id: string; name: string }

/** Decode only the dedicated, server-authorized assignment directory. */
export function taskAssigneeOptions(rows: readonly unknown[]): TaskAssigneeOption[] {
  const options = new Map<string, TaskAssigneeOption>()
  for (const value of rows) {
    if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid task assignment directory")
    const row = value as TaskAssigneeWire
    const identity = taskIdentityHex(row.id)
    if (!identity || options.has(identity)) throw new Error("Invalid task assignment directory")
    const name = typeof row.name === "string" ? row.name.trim() : ""
    options.set(identity, { id: identity, name: name || `${identity.slice(0, 8)}…` })
  }
  return [...options.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

export type TaskAssignmentProjection = {
  id?: unknown
  organizationId?: unknown
  organization_id?: unknown
  companyId?: unknown
  company_id?: unknown
  userIds?: readonly unknown[]
  user_ids?: readonly unknown[]
}

/** Match the same task, scope and complete assignment set, including an intentional clear. */
export function resolveTaskAssignmentEffect(
  rows: readonly TaskAssignmentProjection[],
  organizationId: bigint,
  companyId: bigint,
  taskId: bigint,
  expectedUserIds: readonly string[],
): CanonicalRecordRef | null {
  const row = resolveUniqueRow(rows, (candidate) => parseStrictU64(candidate.id) === taskId)
  if (!row || parseStrictU64(row.organizationId ?? row.organization_id) !== organizationId ||
      parseStrictU64(row.companyId ?? row.company_id) !== companyId) return null
  const assigned = row.userIds ?? row.user_ids
  if (!Array.isArray(assigned)) return null
  const actual = assigned.map((value) => taskIdentityHex(value))
  const expected = new Set(taskAssigneeIds(expectedUserIds))
  if (actual.length !== expected.size || new Set(actual).size !== actual.length ||
      actual.some((identity) => !identity || !expected.has(identity))) return null
  return { resource: "tasks", id: taskId.toString() }
}

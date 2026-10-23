import type { HumanTaskRow } from "./approvals"
import { approvalTaskStatus, resolveApprovalActor } from "./approval-controls"

/** Supported canonical workflow subjects in the Finance alpha. */
export const WORK_MODULES = [
  "purchasing",
  "sales",
  "accounting",
  "expenses",
] as const
export type WorkModule = (typeof WORK_MODULES)[number]
export type WorkScope = WorkModule | "finance"
export type WorkView = "eligible" | "mine" | "available"
export type WorkAction = "claim" | "approve" | "reject" | "complete" | "resubmit"
export type WorkTeamRef = {
  kind: "workflow-group" | "department"
  id: string
  label?: string
}

export const WORK_STATUSES = [
  "Open",
  "Claimed",
  "Approved",
  "Completed",
  "Rejected",
  "Invalidated",
  "Cancelled",
] as const
export type WorkStatus = (typeof WORK_STATUSES)[number]

export interface WorkTaskRow extends HumanTaskRow {
  workModule: WorkModule
  workAssignedToMe: boolean
  workActions: WorkAction[]
  workTeamRefs: WorkTeamRef[]
  workSourceTitle?: string
  actingForOptions?: Array<{
    identityHex: string
    label: string
    workActions: WorkAction[]
  }>
}

export interface WorkBoardPage {
  data: WorkTaskRow[]
  nextCursor: string | null
}

export interface WorkBoardScope {
  organizationId: number
  companyId: number
  actorIdentity: string
  authorizationKey: string
  scope: WorkScope
  view: WorkView
  team?: string
}

const WORK_ACTIONS: readonly WorkAction[] = [
  "claim",
  "approve",
  "reject",
  "complete",
  "resubmit",
]
const object = (value: unknown): value is object =>
  value != null && typeof value === "object" && !Array.isArray(value)

type WorkTaskWire = { [K in keyof WorkTaskRow]?: unknown }
type WorkBoardWire = { [K in keyof WorkBoardPage]?: unknown }

function validTeam(value: unknown): value is WorkTeamRef {
  if (!object(value)) return false
  const team = value as { [K in keyof WorkTeamRef]?: unknown }
  return (
    (team.kind === "department" || team.kind === "workflow-group") &&
    typeof team.id === "string" &&
    safeId(team.id) &&
    (team.label == null || typeof team.label === "string")
  )
}

function validPrincipal(value: unknown): boolean {
  if (!object(value)) return false
  const option = value as {
    identityHex?: unknown
    label?: unknown
    workActions?: unknown
  }
  return (
    typeof option.identityHex === "string" &&
    /^[0-9a-f]{64}$/i.test(option.identityHex) &&
    typeof option.label === "string" &&
    validActions(option.workActions)
  )
}

export function isWorkScope(value: unknown): value is WorkScope {
  return value === "finance" || WORK_MODULES.some((module) => module === value)
}

export function isWorkView(value: unknown): value is WorkView {
  return value === "eligible" || value === "mine" || value === "available"
}

export function workStatus(row: { status?: unknown }): WorkStatus | null {
  const tag = approvalTaskStatus(row)
  return WORK_STATUSES.find((status) => status === tag) ?? null
}

export function workTeamKey(team: WorkTeamRef): string {
  return `${team.kind}:${team.id}`
}

export function isWorkTeamKey(value: string): boolean {
  const match = /^(department|workflow-group):([1-9][0-9]*)$/.exec(value)
  return match != null && safeId(match[2])
}

/** Keep actor, authorization snapshot, company and presentation scope in every cache key. */
export function workBoardQueryKey(scope: WorkBoardScope) {
  return [
    "workflow-human-tasks",
    "work-board",
    String(scope.organizationId),
    scope.actorIdentity,
    scope.authorizationKey,
    String(scope.companyId),
    scope.scope,
    scope.view,
    scope.team ?? "",
  ] as const
}

export function workBoardQueryPath(
  scope: WorkBoardScope,
  cursor?: string | null,
): string {
  if (
    !Number.isSafeInteger(scope.companyId) ||
    scope.companyId <= 0 ||
    !Number.isSafeInteger(scope.organizationId) ||
    scope.organizationId <= 0 ||
    !scope.actorIdentity.trim() ||
    !scope.authorizationKey.trim() ||
    !isWorkScope(scope.scope) ||
    !isWorkView(scope.view) ||
    (scope.team != null && !isWorkTeamKey(scope.team))
  ) {
    throw new Error("Invalid work board scope")
  }
  const query = new URLSearchParams({
    companyId: String(scope.companyId),
    workScope: scope.scope,
    workView: scope.view,
    limit: "50",
  })
  if (scope.team) query.set("workTeam", scope.team)
  if (cursor) query.set("cursor", cursor)
  return `/api/query/workflow-human-tasks?${query}`
}

function validActions(value: unknown): value is WorkAction[] {
  return (
    Array.isArray(value) &&
    value.every((action) => WORK_ACTIONS.includes(action as WorkAction))
  )
}

function safeId(value: unknown): boolean {
  return (
    (typeof value === "number" && Number.isSafeInteger(value) && value > 0) ||
    (typeof value === "string" &&
      value.length <= 20 &&
      /^[1-9][0-9]*$/.test(value) &&
      BigInt(value) <= 18446744073709551615n)
  )
}

/** Reject malformed or mismatched pages before they can populate a board or its counts. */
export function parseWorkBoardPage(
  value: unknown,
  scope: WorkBoardScope,
): WorkBoardPage {
  const page: WorkBoardWire = object(value) ? value : {}
  if (
    !object(value) ||
    !Array.isArray(page.data) ||
    !(page.nextCursor === null || typeof page.nextCursor === "string")
  ) {
    throw new Error("Invalid work board response")
  }
  for (const raw of page.data) {
    const row: WorkTaskWire = object(raw) ? raw : {}
    if (
      !object(raw) ||
      !safeId(row.id) ||
      String(row.companyId ?? row.company_id) !== String(scope.companyId) ||
      String(row.organizationId ?? row.organization_id) !==
        String(scope.organizationId) ||
      !WORK_MODULES.some((module) => module === row.workModule) ||
      (scope.scope !== "finance" && row.workModule !== scope.scope) ||
      typeof row.workAssignedToMe !== "boolean" ||
      (scope.view === "mine" && row.workAssignedToMe !== true) ||
      (scope.view === "available" &&
        (workStatus(row) !== "Open" ||
          (row.claimedBy ?? row.claimed_by) != null)) ||
      (row.workSourceTitle != null &&
        typeof row.workSourceTitle !== "string") ||
      (row.nodeKey != null && typeof row.nodeKey !== "string") ||
      (row.node_key != null && typeof row.node_key !== "string") ||
      !validActions(row.workActions) ||
      !Array.isArray(row.workTeamRefs) ||
      !row.workTeamRefs.every(validTeam) ||
      (scope.team != null &&
        !row.workTeamRefs.some((team) => workTeamKey(team) === scope.team)) ||
      (row.actingForOptions != null &&
        (!Array.isArray(row.actingForOptions) ||
          !row.actingForOptions.every(validPrincipal))) ||
      workStatus(row) == null
    ) {
      throw new Error(
        "Work board returned an invalid or out-of-scope assignment",
      )
    }
  }
  return value as unknown as WorkBoardPage
}

/** Delegated principals keep separate capabilities; never union their permissions. */
export function workActionsForActor(
  row: WorkTaskRow,
  requested?: string | null,
): readonly WorkAction[] {
  const status = workStatus(row)
  if (status === "Cancelled") {
    // Recovery uses the current actor's management grants, never a delegate's
    // principal. A historical claimant can be visible without direct eligibility.
    return requested == null || requested === ""
      ? row.workActions.filter((action) => action === "resubmit")
      : []
  }
  if (status !== "Open" && status !== "Claimed") return []
  const actor = resolveApprovalActor(row, requested)
  if (actor == null) return []
  if (actor === "") return row.workActions.filter((action) => action !== "resubmit")
  return (
    row.actingForOptions?.find(
      (option) => option.identityHex.toLowerCase() === actor,
    )?.workActions.filter((action) => action !== "resubmit") ?? []
  )
}

export function workActionForColumn(columnId: string): WorkAction | null {
  switch (columnId) {
    case "Claimed":
      return "claim"
    case "Approved":
      return "approve"
    case "Rejected":
      return "reject"
    case "Completed":
      return "complete"
    default:
      return null
  }
}

export function canMoveWorkTask(
  row: WorkTaskRow,
  columnId: string,
  actor?: string | null,
): boolean {
  if (workStatus(row) === columnId) return false
  const action = workActionForColumn(columnId)
  return action != null && workActionsForActor(row, actor).includes(action)
}

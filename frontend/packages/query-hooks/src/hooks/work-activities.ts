"use client"

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { decodeOperationDispatch } from "@lumiere/api-client"
import { responseErrorMessage } from "@lumiere/api-client/response-error"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { apiFetch } from "../http"
import { executeOperationWithCanonicalReadback, requireResolvedOperationEffect } from "./operation-effect"
import { taskIdentityHex } from "./task-assignment"
import { workBoardQueryKey, workBoardQueryPath, type WorkBoardScope } from "./work-board-model"

const SOURCE_MODULES = { purchase_order: "purchasing", sale_order: "sales", account_move: "accounting" } as const
export type WorkActivityModel = keyof typeof SOURCE_MODULES
export interface WorkActivityRow {
  id: number
  organizationId: number
  companyId: number
  workModule: "purchasing" | "sales" | "accounting"
  summary: string
  resModel: WorkActivityModel
  resId: number
  state: "open" | "done"
  isDone: boolean
  assignedTo?: string | null
  dateDeadline?: string | null
  updatedAt?: string
  workAssignedToMe: boolean
  workIsAssigned: boolean
  workTeamRefs: Array<{ kind: "department"; id: string; label?: string }>
  workActions: Array<"complete">
  workSourceTitle?: string
}
export interface WorkActivitiesPage { data: WorkActivityRow[]; nextCursor: string | null }

interface WorkActivitiesWirePage { data?: unknown; nextCursor?: unknown }
interface WorkActivityWire {
  id?: unknown; organizationId?: unknown; companyId?: unknown; workModule?: unknown
  summary?: unknown; resModel?: unknown; resId?: unknown; state?: unknown; isDone?: unknown
  assignedTo?: unknown; dateDeadline?: unknown; updatedAt?: unknown
  workAssignedToMe?: unknown; workIsAssigned?: unknown; workTeamRefs?: unknown
  workActions?: unknown; workSourceTitle?: unknown
}
interface WorkTeamWire { kind?: unknown; id?: unknown; label?: unknown }
function object(value: unknown): value is object { return value != null && typeof value === "object" && !Array.isArray(value) }
function safeId(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value))) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function workActivitiesQueryKey(scope: WorkBoardScope) {
  return ["activities", "work-board", ...workBoardQueryKey(scope).slice(2)] as const
}
export function workActivitiesQueryPath(scope: WorkBoardScope, cursor?: string | null, activityId?: number): string {
  if (scope.team && !scope.team.startsWith("department:")) throw new Error("Record follow-ups support department teams only")
  const path = workBoardQueryPath(scope, cursor).replace("/api/query/workflow-human-tasks?", "/api/query/activities?")
  if (activityId == null) return path
  if (safeId(activityId) == null || cursor) throw new Error("Invalid follow-up identity")
  return `${path}&activityId=${activityId}`
}

/** Fail the page if a row contradicts its authenticated company, module, or lifecycle. */
export function parseWorkActivitiesPage(value: unknown, scope: WorkBoardScope): WorkActivitiesPage {
  if (!object(value)) throw new Error("Invalid follow-up response")
  const envelope = value as WorkActivitiesWirePage
  if (!Array.isArray(envelope.data) || (envelope.nextCursor != null && typeof envelope.nextCursor !== "string")) throw new Error("Invalid follow-up response")
  const seen = new Set<number>()
  const data = envelope.data.map((input: unknown): WorkActivityRow => {
    if (!object(input)) throw new Error("Invalid follow-up row")
    const value = input as WorkActivityWire
    const id = safeId(value.id)
    const org = safeId(value.organizationId)
    const company = safeId(value.companyId)
    const sourceId = safeId(value.resId)
    const model = typeof value.resModel === "string" && Object.hasOwn(SOURCE_MODULES, value.resModel) ? value.resModel as WorkActivityModel : null
    if (id == null || seen.has(id) || org !== scope.organizationId || company !== scope.companyId || sourceId == null || model == null ||
        value.workModule !== SOURCE_MODULES[model] || (scope.scope !== "finance" && value.workModule !== scope.scope) ||
        typeof value.summary !== "string" || typeof value.workAssignedToMe !== "boolean" || typeof value.workIsAssigned !== "boolean" ||
        (value.workAssignedToMe && !value.workIsAssigned) ||
        (scope.view === "mine" && !value.workAssignedToMe) ||
        (scope.view === "available" && (value.workIsAssigned || value.isDone)) ||
        typeof value.isDone !== "boolean" || value.state !== (value.isDone ? "done" : "open") ||
        !Array.isArray(value.workActions) || value.workActions.some((action) => action !== "complete") || value.workActions.length > 1 ||
        (value.isDone && value.workActions.length > 0) || !Array.isArray(value.workTeamRefs)) throw new Error("Follow-up does not match the authorized board")
    const teams = value.workTeamRefs.map((input: unknown) => {
      if (!object(input)) throw new Error("Invalid follow-up department")
      const team = input as WorkTeamWire
      if (team.kind !== "department" || safeId(team.id) == null || (team.label != null && typeof team.label !== "string")) throw new Error("Invalid follow-up department")
      return { kind: "department" as const, id: String(team.id), ...(typeof team.label === "string" ? { label: team.label } : {}) }
    })
    if (scope.team && !teams.some((team) => `department:${team.id}` === scope.team)) throw new Error("Follow-up does not match the selected department")
    let assignedTo: string | null | undefined
    if (value.assignedTo === null) {
      if (value.workIsAssigned) throw new Error("Invalid follow-up assignee")
      assignedTo = null
    } else if (value.assignedTo !== undefined) {
      assignedTo = taskIdentityHex(value.assignedTo)
      if (!assignedTo || !value.workIsAssigned || value.workAssignedToMe !== (assignedTo === taskIdentityHex(scope.actorIdentity))) throw new Error("Invalid follow-up assignee")
    }
    if (value.dateDeadline !== undefined && value.dateDeadline !== null && (typeof value.dateDeadline !== "string" || Number.isNaN(Date.parse(value.dateDeadline)))) throw new Error("Invalid follow-up deadline")
    if (value.updatedAt !== undefined && typeof value.updatedAt !== "string") throw new Error("Invalid follow-up timestamp")
    if (value.workSourceTitle !== undefined && typeof value.workSourceTitle !== "string") throw new Error("Invalid follow-up source title")
    seen.add(id)
    return {
      id, organizationId: org, companyId: company, resId: sourceId, resModel: model,
      workModule: SOURCE_MODULES[model], summary: value.summary,
      state: value.isDone ? "done" : "open", isDone: value.isDone,
      workAssignedToMe: value.workAssignedToMe, workIsAssigned: value.workIsAssigned,
      workTeamRefs: teams, workActions: value.workActions.map(() => "complete" as const),
      ...(assignedTo !== undefined ? { assignedTo } : {}),
      ...(value.dateDeadline === null || typeof value.dateDeadline === "string" ? { dateDeadline: value.dateDeadline } : {}),
      ...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt } : {}),
      ...(typeof value.workSourceTitle === "string" ? { workSourceTitle: value.workSourceTitle } : {}),
    }
  })
  return { data, nextCursor: typeof envelope.nextCursor === "string" ? envelope.nextCursor : null }
}

export function sameWorkActivity(current: WorkActivityRow, expected: WorkActivityRow): boolean {
  return current.id === expected.id && current.organizationId === expected.organizationId && current.companyId === expected.companyId && current.resModel === expected.resModel && current.resId === expected.resId && current.workModule === expected.workModule
}

export function requireCurrentWorkActivity(rows: readonly WorkActivityRow[], expected: WorkActivityRow): WorkActivityRow {
  const current = rows.length === 1 ? rows[0] : undefined
  if (!current || !sameWorkActivity(current, expected)) throw new Error("This follow-up is no longer available in the selected scope. Refresh the board.")
  if (current.isDone || !current.workActions.includes("complete")) throw new Error("This follow-up can no longer be completed. Refresh the board.")
  if (expected.updatedAt && current.updatedAt && expected.updatedAt !== current.updatedAt) throw new Error("This follow-up changed. Refresh the board before completing it.")
  return current
}

async function readPage(scope: WorkBoardScope, cursor?: string | null, activityId?: number, signal?: AbortSignal) {
  const response = await apiFetch(workActivitiesQueryPath(scope, cursor, activityId), { signal })
  if (!response.ok) throw new Error(await responseErrorMessage(response))
  return parseWorkActivitiesPage(await response.json(), scope)
}

export function useWorkActivities(scope: WorkBoardScope, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: workActivitiesQueryKey(scope),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => readPage(scope, pageParam, undefined, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: enabled && scope.organizationId > 0 && scope.companyId > 0 && !!scope.actorIdentity,
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: "always",
    retry: false,
  })
}

export function useCompleteWorkActivity(scope: WorkBoardScope) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["activities"] })
  return useMutation({
    mutationFn: async ({ activity }: { activity: WorkActivityRow }) => {
      const exactScope = { ...scope, view: "eligible" as const }
      const preflight = await readPage(exactScope, null, activity.id)
      requireCurrentWorkActivity(preflight.data, activity)
      return requireResolvedOperationEffect(await executeOperationWithCanonicalReadback({
        resolveBeforeDispatch: false,
        dispatch: async () => {
          const command = stdbBffCommandPost("complete_activity", { activityId: String(activity.id) })
          return decodeOperationDispatch(await apiFetch(command.urlPath, command.init))
        },
        resolveEffect: async () => {
          const page = await readPage(exactScope, null, activity.id)
          const saved = page.data.length === 1 ? page.data[0] : undefined
          return saved && sameWorkActivity(saved, activity) && saved.isDone && saved.state === "done" ? { resource: "activities", id: String(saved.id) } : null
        },
        afterDispatch: refresh,
      }))
    },
    onSettled: refresh,
  })
}

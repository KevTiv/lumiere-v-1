import type { EntityAction, EntitySurfacePermission, EntityTableConfig, EntityViewConfig } from "./entity-view-types"

/**
 * - `none`: the list has rows to show (or is still loading).
 * - `first-time`: nothing exists yet and nothing narrows the list: onboard the user.
 * - `no-results`: search, filters or a KPI tile hide every row: offer to clear them.
 */
export type ListEmptyKind = "none" | "first-time" | "no-results"

export interface ListEmptyInput {
  isLoading?: boolean
  /** Rows handed to the list, before the list's own search and filters. */
  totalRows: number
  /** Rows left after search and filters. */
  visibleRows: number
  search?: string
  filters?: Record<string, string | undefined>
  /** Narrowing applied above the list (a KPI tile): it hides rows or leaves none to hand over. */
  externalFilterActive?: boolean
}

const ALL = "__all__"

/** Number of filter values that actually narrow the list (empty and "all" do not). */
export function countActiveFilters(filters: Record<string, string | undefined> | undefined): number {
  if (!filters) return 0
  return Object.values(filters).filter((value) => value != null && value !== "" && value !== ALL).length
}

export function hasActiveNarrowing(input: Pick<ListEmptyInput, "search" | "filters" | "externalFilterActive">): boolean {
  return (
    Boolean(input.externalFilterActive) ||
    (input.search ?? "").trim() !== "" ||
    countActiveFilters(input.filters) > 0
  )
}

export function decideListEmptyState(input: ListEmptyInput): ListEmptyKind {
  if (input.isLoading || input.visibleRows > 0) return "none"
  if (input.totalRows === 0 && !hasActiveNarrowing(input)) return "first-time"
  return "no-results"
}

export type ListEmptyStateConfig = NonNullable<EntityTableConfig["emptyState"]>

export interface ResolvedEmptyCta {
  label: string
  /** Set when the CTA runs a table action (it keeps its own pending state and confirmation). */
  actionId?: string
  /** Set when the CTA runs a plain handler. */
  onClick?: () => void
  testId?: string
}

export interface ResolvedEmptyCtas {
  primary: ResolvedEmptyCta | null
  secondary: ResolvedEmptyCta | null
  /** The list has a create CTA the user may not use: show a read-only message instead. */
  readOnly: boolean
}

/**
 * Chooses the CTAs of the first-time state. Action ids reference the table's own (already
 * permission-filtered) actions, so a user without the action's permission gets no button.
 * A legacy `actionLabel` + `onAction` pair is used when no action id is configured, gated by
 * `emptyState.permission`.
 */
export function resolveEmptyCtas(
  emptyState: ListEmptyStateConfig | undefined,
  permittedActions: readonly EntityAction[],
  checkPermission: (permission: EntitySurfacePermission) => boolean,
): ResolvedEmptyCtas {
  if (!emptyState) return { primary: null, secondary: null, readOnly: false }
  const byId = (id: string | undefined) => (id ? permittedActions.find((a) => a.id === id) : undefined)

  let primary: ResolvedEmptyCta | null = null
  let wantsPrimary = false
  if (emptyState.primaryActionId) {
    wantsPrimary = true
    const action = byId(emptyState.primaryActionId)
    if (action) primary = { label: action.label, actionId: action.id }
  } else if (emptyState.actionLabel && emptyState.onAction) {
    wantsPrimary = true
    if (!emptyState.permission || checkPermission(emptyState.permission)) {
      primary = { label: emptyState.actionLabel, onClick: emptyState.onAction }
    }
  }

  const secondaryAction = byId(emptyState.secondaryActionId)
  const secondary: ResolvedEmptyCta | null = secondaryAction
    ? { label: secondaryAction.label, actionId: secondaryAction.id }
    : null

  return { primary, secondary, readOnly: wantsPrimary && primary == null }
}

export interface TabCreateCta {
  label: string
  onClick: () => void
  permission?: EntitySurfacePermission
}

type ViewWithEmptyState = EntityViewConfig["view"]

/**
 * Lets a list that opted into an `emptyState` (it has a title) use its module tab's "New" form as
 * the first-time CTA, gated by the tab's create permission. A list that already names an action
 * id or its own handler keeps it; it only picks up the permission gate.
 */
export function withTabCreateCta(view: ViewWithEmptyState, cta: TabCreateCta): ViewWithEmptyState {
  const patch = (state: ListEmptyStateConfig | undefined): ListEmptyStateConfig | undefined => {
    if (!state?.title) return state
    if (state.primaryActionId) return state
    if (state.onAction) {
      return state.permission || !cta.permission ? state : { ...state, permission: cta.permission }
    }
    return {
      ...state,
      actionLabel: state.actionLabel ?? cta.label,
      onAction: cta.onClick,
      permission: state.permission ?? cta.permission,
    }
  }
  if (view.mode === "table") {
    const emptyState = patch(view.emptyState)
    return emptyState === view.emptyState ? view : { ...view, emptyState }
  }
  if (view.mode === "table-or-board") {
    const emptyState = patch(view.table.emptyState)
    return emptyState === view.table.emptyState ? view : { ...view, table: { ...view.table, emptyState } }
  }
  return view
}

export type CreateGate = "allowed" | "denied" | "loading"

/**
 * Whether a create control may be offered. While permissions are still loading the answer is
 * "loading" (callers keep the control visible: hiding it would flash for users who are allowed),
 * and the server's own check stays authoritative.
 */
export function decideCreateGate(
  permission: EntitySurfacePermission | undefined,
  checkPermission: (permission: EntitySurfacePermission) => boolean,
  permissionsReady = true,
): CreateGate {
  if (!permission) return "allowed"
  if (!permissionsReady) return "loading"
  return checkPermission(permission) ? "allowed" : "denied"
}

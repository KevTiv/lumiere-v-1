import {
  WORK_STATUSES,
  type WorkScope,
  type WorkStatus,
} from "@lumiere/query-hooks/hooks/work-board-model"
import type { ModuleWorkSource } from "@lumiere/ui/lib/module-types"

const DEFAULT_SOURCES: readonly ModuleWorkSource[] = ["workflow", "activities"]

/** Reorder a board without hiding any canonical state or inventing transitions. */
export function workBoardStatuses(
  order: readonly WorkStatus[] = [],
): WorkStatus[] {
  return Array.from(new Set([...order, ...WORK_STATUSES])).filter(
    (status) => WORK_STATUSES.includes(status),
  )
}

/** Configuration can narrow the supported sources; it cannot create a new adapter. */
export function workBoardSources(
  scope: WorkScope,
  configured: readonly ModuleWorkSource[] = DEFAULT_SOURCES,
): ModuleWorkSource[] {
  return Array.from(new Set(configured)).filter(
    (source) => scope !== "expenses" || source === "workflow",
  )
}

export function resolveWorkBoardSource(
  requested: string | null,
  sources: readonly ModuleWorkSource[],
  readable: Readonly<Record<ModuleWorkSource, boolean>>,
): ModuleWorkSource | undefined {
  // An explicit supported choice remains selected after revocation, so the
  // workspace shows its denial and unmounts the previous sensitive content.
  const selected = sources.find((source) => source === requested)
  return selected ?? sources.find((source) => readable[source]) ?? sources[0]
}

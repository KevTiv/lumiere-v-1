import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * Projects mutations via Next.js BFF `POST /api/call/:reducer`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` projects hooks.
 */
export const PROJECTS_BFF_REDUCERS = [
  "assign_task_users",
  "bill_timesheets",
  "create_project",
  "create_task",
  "import_project_csv",
  "import_task_csv",
  "import_timesheet_csv",
  "log_timesheet",
  "set_project_active",
  "set_task_parent",
  "start_timesheet_timer",
  "stop_timesheet_timer",
  "toggle_project_favorite",
  "update_project",
  "update_task",
  "update_task_state",
  "validate_timesheets",
] as const;

export type ProjectsBffReducerKey = (typeof PROJECTS_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<ProjectsBffReducerKey>();

/** Same-origin path used by `apiFetch` in the web app. */
export function projectsBffCallUrl(reducer: ProjectsBffReducerKey): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

export function projectsBffPost(
  reducer: ProjectsBffReducerKey,
  args: unknown[],
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: projectsBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCallBody(args),
    },
  };
}

const PROJECTS_HINT_OVERRIDES: Partial<
  Record<ProjectsBffReducerKey, readonly string[]>
> = {
  assign_task_users: ["tasks"],
  bill_timesheets: ["timesheets"],
  create_project: ["projects"],
  create_task: ["tasks"],
  import_project_csv: ["projects"],
  import_task_csv: ["tasks"],
  import_timesheet_csv: ["timesheets"],
  log_timesheet: ["timesheets"],
  set_project_active: ["projects"],
  set_task_parent: ["tasks"],
  start_timesheet_timer: ["timesheets"],
  stop_timesheet_timer: ["timesheets"],
  toggle_project_favorite: ["projects"],
  update_project: ["projects"],
  update_task: ["tasks"],
  update_task_state: ["tasks"],
  validate_timesheets: ["timesheets"],
};

function projectsReducerHints(): Record<
  ProjectsBffReducerKey,
  readonly string[]
> {
  const o = {} as Record<ProjectsBffReducerKey, readonly string[]>;
  for (const k of PROJECTS_BFF_REDUCERS) {
    o[k] = PROJECTS_HINT_OVERRIDES[k] ?? [];
  }
  return o;
}

export const PROJECTS_COMMAND_SUBSCRIPTION_HINTS: Record<
  ProjectsBffReducerKey,
  readonly string[]
> = projectsReducerHints();

export function projectsCommandContract(
  reducer: ProjectsBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Projects reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: PROJECTS_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}

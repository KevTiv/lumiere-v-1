
import type { ReducerCommandContractMeta } from "./types";

/**
 * Projects mutations via Next.js BFF `POST /api/operations/:operation`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` projects hooks.
 */
export const PROJECTS_BFF_REDUCERS = [
  "assign_task_users",
  "bill_project_milestone",
  "bill_timesheets",
  "apply_project_change_order",
  "create_project",
  "create_project_change_order",
  "create_project_integration_intent",
  "create_project_milestone",
  "create_project_rate_card",
  "create_project_rate_card_line",
  "create_project_revenue_line",
  "create_project_revenue_schedule",
  "create_public_holiday",
  "create_resource_allocation",
  "create_task",
  "create_working_calendar",
  "delete_project_milestone",
  "delete_resource_allocation",
  "import_project_csv",
  "import_task_csv",
  "import_timesheet_csv",
  "link_subcontractor_cost_to_project",
  "log_timesheet",
  "recognize_project_revenue",
  "refresh_capacity_forecast",
  "refresh_project_earned_value",
  "refresh_project_margin",
  "refresh_resource_capacity",
  "refresh_resource_utilisation",
  "reject_timesheets",
  "reopen_timesheets",
  "seed_pack_holidays",
  "set_project_active",
  "set_task_parent",
  "start_timesheet_timer",
  "stop_timesheet_timer",
  "toggle_project_favorite",
  "update_project",
  "update_project_milestone",
  "update_project_rate_card",
  "update_project_rate_card_line",
  "update_public_holiday",
  "update_resource_allocation",
  "update_task",
  "update_task_state",
  "update_working_calendar",
  "validate_timesheets",
] as const;

export type ProjectsBffReducerKey = (typeof PROJECTS_BFF_REDUCERS)[number];

const PROJECTS_HINT_OVERRIDES: Partial<
  Record<ProjectsBffReducerKey, readonly string[]>
> = {
  assign_task_users: ["tasks"],
  bill_project_milestone: [
    "project-milestones",
    "project-margin-by-project",
    "account-moves",
  ],
  bill_timesheets: [
    "timesheets",
    "timesheets-to-validate",
    "timesheets-unbilled",
    "project-margin-by-project",
  ],
  apply_project_change_order: [
    "project-change-orders",
    "project-baselines",
    "project-earned-value-by-project",
    "project-margin-by-project",
    "tasks",
  ],
  create_project: ["projects"],
  create_project_change_order: ["project-change-orders"],
  create_project_integration_intent: ["project-integration-intents"],
  create_project_milestone: ["project-milestones"],
  create_project_rate_card: ["project-rate-cards"],
  create_project_rate_card_line: ["project-rate-card-lines"],
  create_project_revenue_line: ["project-revenue-lines"],
  create_project_revenue_schedule: ["project-revenue-schedules"],
  create_public_holiday: ["public-holidays"],
  create_resource_allocation: [
    "resource-allocations",
    "resource-capacity-by-employee",
  ],
  create_task: ["tasks"],
  create_working_calendar: ["working-calendars"],
  delete_project_milestone: ["project-milestones"],
  delete_resource_allocation: [
    "resource-allocations",
    "resource-capacity-by-employee",
  ],
  import_project_csv: ["projects"],
  import_task_csv: ["tasks"],
  import_timesheet_csv: ["timesheets", "timesheets-to-validate"],
  link_subcontractor_cost_to_project: [
    "project-subcontractor-costs",
    "project-margin-by-project",
    "project-earned-value-by-project",
  ],
  log_timesheet: ["timesheets", "timesheets-to-validate"],
  recognize_project_revenue: [
    "project-revenue-lines",
    "project-revenue-schedules",
    "account-moves",
    "project-margin-by-project",
  ],
  refresh_capacity_forecast: ["capacity-forecast-by-employee"],
  refresh_project_earned_value: ["project-earned-value-by-project"],
  refresh_project_margin: ["project-margin-by-project"],
  refresh_resource_capacity: ["resource-capacity-by-employee"],
  refresh_resource_utilisation: ["resource-utilisation-by-employee"],
  reject_timesheets: ["timesheets", "timesheets-to-validate", "project-margin-by-project"],
  reopen_timesheets: [
    "timesheets",
    "timesheets-to-validate",
    "timesheets-unbilled",
    "project-margin-by-project",
  ],
  seed_pack_holidays: ["public-holidays"],
  set_project_active: ["projects"],
  set_task_parent: ["tasks"],
  start_timesheet_timer: ["timesheets", "timesheets-to-validate"],
  stop_timesheet_timer: ["timesheets", "timesheets-to-validate"],
  toggle_project_favorite: ["projects"],
  update_project: ["projects"],
  update_project_milestone: ["project-milestones"],
  update_project_rate_card: ["project-rate-cards"],
  update_project_rate_card_line: ["project-rate-card-lines"],
  update_public_holiday: ["public-holidays"],
  update_resource_allocation: [
    "resource-allocations",
    "resource-capacity-by-employee",
  ],
  update_task: ["tasks"],
  update_task_state: ["tasks"],
  update_working_calendar: ["working-calendars"],
  validate_timesheets: [
    "timesheets",
    "timesheets-to-validate",
    "timesheets-unbilled",
    "project-margin-by-project",
    "resource-utilisation-by-employee",
  ],
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

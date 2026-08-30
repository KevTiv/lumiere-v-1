
import type { ReducerCommandContractMeta } from "./types";

/**
 * Versioned workflow definition + runtime + migration + ops mutations via BFF.
 */
export const WORKFLOWS_BFF_REDUCERS = [
  "create_workflow",
  "update_workflow_draft",
  "upsert_workflow_node",
  "upsert_workflow_edge",
  "delete_workflow_node",
  "delete_workflow_edge",
  "publish_workflow_version",
  "clone_workflow_version_to_draft",
  "retire_workflow_version",
  "start_workflow",
  "signal_workflow",
  "cancel_workflow",
  "simulate_workflow",
  "import_workflow_csv",
  "create_workflow_migration_plan",
  "set_workflow_migration_plan_active",
  "preflight_workflow_migration",
  "migrate_workflow_instance",
  "fire_workflow_timer",
  "cancel_workflow_timer",
  "cancel_workflow_outbox",
  "record_workflow_outbox_result",
] as const;

export type WorkflowsBffReducerKey = (typeof WORKFLOWS_BFF_REDUCERS)[number];

const WORKFLOW_RESOURCE_KEYS = [
  "workflows",
  "workflow-versions",
  "workflow-nodes",
  "workflow-edges",
  "workflow-instances",
  "workflow-human-tasks-inbox",
  "workflow-timers-late",
  "workflow-outbox-dead",
  "workflow-decision-events",
  "workflow-migration-plans",
  "workflow-migration-preflights",
  "workflow-migration-results",
] as const;

const WORKFLOWS_HINT_OVERRIDES: Partial<
  Record<WorkflowsBffReducerKey, readonly string[]>
> = {
  create_workflow: WORKFLOW_RESOURCE_KEYS,
  update_workflow_draft: WORKFLOW_RESOURCE_KEYS,
  upsert_workflow_node: WORKFLOW_RESOURCE_KEYS,
  upsert_workflow_edge: WORKFLOW_RESOURCE_KEYS,
  delete_workflow_node: WORKFLOW_RESOURCE_KEYS,
  delete_workflow_edge: WORKFLOW_RESOURCE_KEYS,
  publish_workflow_version: WORKFLOW_RESOURCE_KEYS,
  clone_workflow_version_to_draft: WORKFLOW_RESOURCE_KEYS,
  retire_workflow_version: WORKFLOW_RESOURCE_KEYS,
  start_workflow: WORKFLOW_RESOURCE_KEYS,
  signal_workflow: WORKFLOW_RESOURCE_KEYS,
  cancel_workflow: WORKFLOW_RESOURCE_KEYS,
  simulate_workflow: WORKFLOW_RESOURCE_KEYS,
  import_workflow_csv: WORKFLOW_RESOURCE_KEYS,
  create_workflow_migration_plan: WORKFLOW_RESOURCE_KEYS,
  set_workflow_migration_plan_active: WORKFLOW_RESOURCE_KEYS,
  preflight_workflow_migration: WORKFLOW_RESOURCE_KEYS,
  migrate_workflow_instance: WORKFLOW_RESOURCE_KEYS,
  fire_workflow_timer: WORKFLOW_RESOURCE_KEYS,
  cancel_workflow_timer: WORKFLOW_RESOURCE_KEYS,
  cancel_workflow_outbox: WORKFLOW_RESOURCE_KEYS,
  record_workflow_outbox_result: WORKFLOW_RESOURCE_KEYS,
};

function workflowsReducerHints(): Record<
  WorkflowsBffReducerKey,
  readonly string[]
> {
  const o = {} as Record<WorkflowsBffReducerKey, readonly string[]>;
  for (const k of WORKFLOWS_BFF_REDUCERS) {
    o[k] = WORKFLOWS_HINT_OVERRIDES[k] ?? [];
  }
  return o;
}

export const WORKFLOWS_COMMAND_SUBSCRIPTION_HINTS: Record<
  WorkflowsBffReducerKey,
  readonly string[]
> = workflowsReducerHints();

export function workflowsCommandContract(
  reducer: WorkflowsBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Workflow engine reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: WORKFLOWS_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [
      "workflow",
      "workflow_version",
      "workflow_node",
      "workflow_edge",
      "workflow_instance",
      "workflow_migration_plan",
      "workflow_decision_event",
    ],
    expectations:
      "Definition reducers require company scope; runtime/migration pass params with revisions and idempotency keys.",
  };
}

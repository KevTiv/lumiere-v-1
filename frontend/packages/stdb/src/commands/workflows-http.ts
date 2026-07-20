import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * Versioned workflow definition + runtime mutations via BFF `POST /api/call/:reducer`.
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
] as const;

export type WorkflowsBffReducerKey = (typeof WORKFLOWS_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<WorkflowsBffReducerKey>([
  "create_workflow",
  "update_workflow_draft",
  "upsert_workflow_node",
  "upsert_workflow_edge",
  "delete_workflow_node",
  "delete_workflow_edge",
  "publish_workflow_version",
  "clone_workflow_version_to_draft",
  "retire_workflow_version",
]);

const WORKFLOW_RESOURCE_KEYS = [
  "workflows",
  "workflow-versions",
  "workflow-nodes",
  "workflow-edges",
  "workflow-instances",
  "workflow-human-tasks-inbox",
] as const;

/** Same-origin path used by `apiFetch` in the web app. */
export function workflowsBffCallUrl(reducer: WorkflowsBffReducerKey): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

export function workflowsBffPost(
  reducer: WorkflowsBffReducerKey,
  args: unknown[],
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: workflowsBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCallBody(args),
    },
  };
}

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
    ],
    expectations:
      "Definition reducers require company scope; runtime reducers pass Start/Signal/Cancel params with revisions.",
  };
}

import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * Workflows mutations via Next.js BFF `POST /api/call/:reducer`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` workflows hooks.
 */
export const WORKFLOWS_BFF_REDUCERS = [
  "add_workflow_activity",
  "add_workflow_transition",
  "cancel_workflow_instance",
  "create_workflow",
  "import_workflow_csv",
  "set_workflow_active",
  "set_workitem_exception",
  "signal_workflow",
  "start_workflow",
] as const;

export type WorkflowsBffReducerKey = (typeof WORKFLOWS_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<WorkflowsBffReducerKey>();

const WORKFLOW_RESOURCE_KEYS = [
  "workflows",
  "workflow-activities",
  "workflow-instances",
  "workflow-transitions",
  "workflow-workitems",
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
  add_workflow_activity: WORKFLOW_RESOURCE_KEYS,
  add_workflow_transition: WORKFLOW_RESOURCE_KEYS,
  cancel_workflow_instance: WORKFLOW_RESOURCE_KEYS,
  create_workflow: WORKFLOW_RESOURCE_KEYS,
  import_workflow_csv: WORKFLOW_RESOURCE_KEYS,
  set_workflow_active: WORKFLOW_RESOURCE_KEYS,
  set_workitem_exception: WORKFLOW_RESOURCE_KEYS,
  signal_workflow: WORKFLOW_RESOURCE_KEYS,
  start_workflow: WORKFLOW_RESOURCE_KEYS,
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
    description: `Workflows reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: WORKFLOWS_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}

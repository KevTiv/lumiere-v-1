import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * Human-task / delegation mutations via BFF `POST /api/call/:reducer`.
 * Replaces the removed approval_rule / approval_request reducers.
 */
export const APPROVALS_BFF_REDUCERS = [
  "claim_workflow_human_task",
  "decide_workflow_human_task",
  "add_workflow_human_task_comment",
  "invalidate_workflow_human_task",
  "create_workflow_delegation",
  "revoke_workflow_delegation",
  "set_workflow_candidate_group_member",
] as const;

export type ApprovalsBffReducerKey = (typeof APPROVALS_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<ApprovalsBffReducerKey>([
  "create_workflow_delegation",
  "revoke_workflow_delegation",
  "set_workflow_candidate_group_member",
]);

export function approvalsBffCallUrl(reducer: ApprovalsBffReducerKey): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

export function approvalsBffPost(
  reducer: ApprovalsBffReducerKey,
  args: unknown[],
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: approvalsBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCallBody(args),
    },
  };
}

const INBOX_RESOURCES = [
  "workflow-human-tasks-inbox",
  "workflow-human-tasks",
  "workflow-human-task-events",
] as const;

export const APPROVALS_COMMAND_SUBSCRIPTION_HINTS: Record<
  ApprovalsBffReducerKey,
  readonly string[]
> = {
  claim_workflow_human_task: INBOX_RESOURCES,
  decide_workflow_human_task: INBOX_RESOURCES,
  add_workflow_human_task_comment: INBOX_RESOURCES,
  invalidate_workflow_human_task: INBOX_RESOURCES,
  create_workflow_delegation: INBOX_RESOURCES,
  revoke_workflow_delegation: INBOX_RESOURCES,
  set_workflow_candidate_group_member: INBOX_RESOURCES,
};

export function approvalsCommandContract(
  reducer: ApprovalsBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Workflow human-task reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: APPROVALS_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [
      "workflow_human_task",
      "workflow_human_task_event",
      "workflow_delegation",
    ],
    expectations:
      "Requires organization scope; claim/decide need expected revision + idempotency key.",
  };
}

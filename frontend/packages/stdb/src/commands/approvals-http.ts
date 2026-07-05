import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

export const APPROVALS_BFF_REDUCERS = [
  "approve_approval_request",
  "create_approval_rule",
  "delete_approval_rule",
  "reject_approval_request",
  "set_approval_rule_active",
  "update_approval_rule",
] as const;

export type ApprovalsBffReducerKey = (typeof APPROVALS_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<ApprovalsBffReducerKey>([
  "approve_approval_request",
  "reject_approval_request",
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

export const APPROVALS_COMMAND_SUBSCRIPTION_HINTS: Record<
  ApprovalsBffReducerKey,
  readonly string[]
> = {
  approve_approval_request: ["approval-requests", "approval-requests-inbox"],
  create_approval_rule: ["approval-rules"],
  delete_approval_rule: ["approval-rules"],
  reject_approval_request: ["approval-requests", "approval-requests-inbox"],
  set_approval_rule_active: ["approval-rules"],
  update_approval_rule: ["approval-rules"],
};

export function approvalsCommandContract(
  reducer: ApprovalsBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Approval engine reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: APPROVALS_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: ["approval_rule", "approval_request"],
    expectations:
      "Authenticated session with organization scope; approve/reject require company scope.",
  };
}

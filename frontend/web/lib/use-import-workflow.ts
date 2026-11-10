"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./api-fetch";
import { readImportWorkflow, type WorkflowScope } from "./import-workflow";

export function importWorkflowKey(actor: string, scope: WorkflowScope) {
  return [
    "import-workflow",
    actor,
    scope.organizationId,
    scope.companyId,
    scope.taskId,
  ] as const;
}

export function useImportWorkflow(
  actor: string,
  scope: WorkflowScope,
  enabled = true,
) {
  return useQuery({
    queryKey: importWorkflowKey(actor, scope),
    queryFn: () => readImportWorkflow(apiFetch, scope),
    enabled,
  });
}

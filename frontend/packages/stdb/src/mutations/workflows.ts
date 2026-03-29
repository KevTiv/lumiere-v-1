import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AddWorkflowActivityParams,
  AddWorkflowTransitionParams,
  CreateWorkflowParams,
} from "../generated/types";
import { getStdbConnection } from "../connection";

export type { CreateWorkflowParams };

function invalidateWorkflowQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  organizationId: bigint,
) {
  const o = organizationId.toString();
  void queryClient.invalidateQueries({ queryKey: ["workflows", o] });
  void queryClient.invalidateQueries({ queryKey: ["workflow-activities", o] });
  void queryClient.invalidateQueries({ queryKey: ["workflow-instances", o] });
  void queryClient.invalidateQueries({ queryKey: ["workflow-transitions", o] });
  void queryClient.invalidateQueries({ queryKey: ["workflow-workitems", o] });
}

export function useCreateWorkflow(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateWorkflowParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createWorkflow({ organizationId, companyId: undefined, params });
    },
    onSuccess: () => invalidateWorkflowQueries(queryClient, organizationId),
  });
}

export function useAddWorkflowActivity(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { workflowId: bigint; params: AddWorkflowActivityParams }) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.addWorkflowActivity({
        organizationId,
        workflowId: args.workflowId,
        params: args.params,
      });
    },
    onSuccess: () => invalidateWorkflowQueries(queryClient, organizationId),
  });
}

export function useAddWorkflowTransition(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      workflowId: bigint;
      activityFrom: bigint;
      activityTo: bigint;
      params: AddWorkflowTransitionParams;
    }) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.addWorkflowTransition({
        organizationId,
        workflowId: args.workflowId,
        activityFrom: args.activityFrom,
        activityTo: args.activityTo,
        params: args.params,
      });
    },
    onSuccess: () => invalidateWorkflowQueries(queryClient, organizationId),
  });
}

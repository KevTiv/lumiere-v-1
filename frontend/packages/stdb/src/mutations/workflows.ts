import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateWorkflowParams } from "../generated/types";
import { getStdbConnection } from "../connection";

export type { CreateWorkflowParams };

export function useCreateWorkflow(organizationId: bigint) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateWorkflowParams) => {
      const conn = getStdbConnection();
      if (!conn) throw new Error("Not connected");
      return conn.reducers.createWorkflow({ organizationId, companyId: undefined, params });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
}

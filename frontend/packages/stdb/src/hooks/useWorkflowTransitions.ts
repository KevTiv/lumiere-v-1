import { queryWorkflowTransitions, type WorkflowTransition } from "../queries/workflows";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getStdbConnection } from "../connection";

export type { WorkflowTransition };

export function useWorkflowTransitions(organizationId: bigint, initialData?: Record<string, unknown>[]) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["workflow-transitions", organizationId.toString()], [organizationId]);

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.workflow_transition.onInsert((_ctx, _row) => reload());
    conn.db.workflow_transition.onUpdate((_ctx, _old, _new) => reload());
    conn.db.workflow_transition.onDelete((_ctx, _row) => reload());
  }, [queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: queryWorkflowTransitions,
    staleTime: Infinity,
    initialData: initialData as never,
    initialDataUpdatedAt: initialData?.length ? 0 : undefined,
  });
}

import { queryWorkflows, type Workflow } from "../queries/workflows";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getStdbConnection } from "../connection";

export type { Workflow };

export function useWorkflows(organizationId: bigint, initialData?: Record<string, unknown>[]) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["workflows", organizationId.toString()], [organizationId]);

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.workflow.onInsert((_ctx, _row) => reload());
    conn.db.workflow.onUpdate((_ctx, _old, _new) => reload());
    conn.db.workflow.onDelete((_ctx, _row) => reload());
  }, [queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: queryWorkflows,
    staleTime: Infinity,
    initialData: initialData as never,
    initialDataUpdatedAt: initialData?.length ? 0 : undefined,
  });
}

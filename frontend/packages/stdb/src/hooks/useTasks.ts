import { queryTasks, type ProjectTask } from "../queries/projects";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { ProjectTask };

export function useTasks(companyId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["tasks", companyId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.project_task.onInsert((_ctx, _row) => reload());
    conn.db.project_task.onUpdate((_ctx, _old, _new) => reload());
    conn.db.project_task.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryTasks, staleTime: Infinity });
}

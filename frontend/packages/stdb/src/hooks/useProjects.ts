import { queryProjects, type ProjectProject } from "../queries/projects";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { ProjectProject };

export function useProjects(companyId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["projects", companyId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.project_project.onInsert((_ctx, _row) => reload());
    conn.db.project_project.onUpdate((_ctx, _old, _new) => reload());
    conn.db.project_project.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryProjects, staleTime: Infinity });
}

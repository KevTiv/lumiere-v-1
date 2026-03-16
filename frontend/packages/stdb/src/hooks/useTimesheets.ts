import { queryTimesheets, type ProjectTimesheet } from "../queries/projects";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { ProjectTimesheet };

export function useTimesheets(companyId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["timesheets", companyId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.project_timesheet.onInsert((_ctx, _row) => reload());
    conn.db.project_timesheet.onUpdate((_ctx, _old, _new) => reload());
    conn.db.project_timesheet.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryTimesheets, staleTime: Infinity });
}

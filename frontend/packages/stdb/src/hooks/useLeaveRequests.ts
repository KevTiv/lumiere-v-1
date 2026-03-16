import { queryLeaveRequests, type HrLeave } from "../queries/hr";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { HrLeave };

export function useLeaveRequests(companyId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["hr-leaves", companyId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.hr_leave.onInsert((_ctx, _row) => reload());
    conn.db.hr_leave.onUpdate((_ctx, _old, _new) => reload());
    conn.db.hr_leave.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryLeaveRequests, staleTime: Infinity });
}

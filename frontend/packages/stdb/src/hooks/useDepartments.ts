import { queryDepartments, type HrDepartment } from "../queries/hr";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { HrDepartment };

export function useDepartments(companyId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["hr-departments", companyId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.hr_department.onInsert((_ctx, _row) => reload());
    conn.db.hr_department.onUpdate((_ctx, _old, _new) => reload());
    conn.db.hr_department.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryDepartments, staleTime: Infinity });
}

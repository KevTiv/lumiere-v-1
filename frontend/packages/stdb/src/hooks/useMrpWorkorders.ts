import { queryMrpWorkorders, type MrpWorkorder } from "../queries/manufacturing";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { MrpWorkorder };

export function useMrpWorkorders(companyId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["mrp-workorders", companyId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.mrp_workorder.onInsert((_ctx, _row) => reload());
    conn.db.mrp_workorder.onUpdate((_ctx, _old, _new) => reload());
    conn.db.mrp_workorder.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryMrpWorkorders, staleTime: Infinity });
}

import { queryMrpWorkcenters, type MrpWorkcenter } from "../queries/manufacturing";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { MrpWorkcenter };

export function useMrpWorkcenters(companyId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["mrp-workcenters", companyId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.mrp_workcenter.onInsert((_ctx, _row) => reload());
    conn.db.mrp_workcenter.onUpdate((_ctx, _old, _new) => reload());
    conn.db.mrp_workcenter.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryMrpWorkcenters, staleTime: Infinity });
}

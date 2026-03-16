import { queryMrpProductions, type MrpProduction } from "../queries/manufacturing";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { MrpProduction };

export function useMrpProductions(companyId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["mrp-productions", companyId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.mrp_production.onInsert((_ctx, _row) => reload());
    conn.db.mrp_production.onUpdate((_ctx, _old, _new) => reload());
    conn.db.mrp_production.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryMrpProductions, staleTime: Infinity });
}

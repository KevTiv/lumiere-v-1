import { queryMrpBoms, type MrpBom } from "../queries/manufacturing";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { MrpBom };

export function useMrpBoms(companyId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["mrp-boms", companyId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.mrp_bom.onInsert((_ctx, _row) => reload());
    conn.db.mrp_bom.onUpdate((_ctx, _old, _new) => reload());
    conn.db.mrp_bom.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryMrpBoms, staleTime: Infinity });
}

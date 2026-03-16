import { queryPricelists, type ProductPricelist } from "../queries/sales";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { ProductPricelist };

export function usePricelists(companyId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["pricelists", companyId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.product_pricelist.onInsert((_ctx, _row) => reload());
    conn.db.product_pricelist.onUpdate((_ctx, _old, _new) => reload());
    conn.db.product_pricelist.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryPricelists, staleTime: Infinity });
}

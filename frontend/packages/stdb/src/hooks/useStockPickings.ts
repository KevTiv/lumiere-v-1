import { queryStockPickings, type StockPicking } from "../queries/inventory";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { StockPicking };

export function useStockPickings(companyId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["stock-pickings", companyId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.stock_picking.onInsert((_ctx, _row) => reload());
    conn.db.stock_picking.onUpdate((_ctx, _old, _new) => reload());
    conn.db.stock_picking.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryStockPickings, staleTime: Infinity });
}

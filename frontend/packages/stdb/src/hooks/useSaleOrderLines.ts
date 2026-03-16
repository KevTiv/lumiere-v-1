import { querySaleOrderLines, type SaleOrderLine } from "../queries/sales";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { SaleOrderLine };

export function useSaleOrderLines(companyId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["sale-order-lines", companyId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.sale_order_line.onInsert((_ctx, _row) => reload());
    conn.db.sale_order_line.onUpdate((_ctx, _old, _new) => reload());
    conn.db.sale_order_line.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: querySaleOrderLines, staleTime: Infinity });
}

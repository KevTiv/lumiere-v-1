import { querySaleOrders, type SaleOrder } from "../queries/sales";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { SaleOrder };

export function useSaleOrders(companyId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["sale-orders", companyId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.sale_order.onInsert((_ctx, _row) => reload());
    conn.db.sale_order.onUpdate((_ctx, _old, _new) => reload());
    conn.db.sale_order.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: querySaleOrders, staleTime: Infinity });
}

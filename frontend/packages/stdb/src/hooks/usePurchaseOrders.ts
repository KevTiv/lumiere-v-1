import { queryPurchaseOrders, type PurchaseOrder } from "../queries/purchasing";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { PurchaseOrder };

export function usePurchaseOrders(companyId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["purchase-orders", companyId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.purchase_order.onInsert((_ctx, _row) => reload());
    conn.db.purchase_order.onUpdate((_ctx, _old, _new) => reload());
    conn.db.purchase_order.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryPurchaseOrders, staleTime: Infinity });
}

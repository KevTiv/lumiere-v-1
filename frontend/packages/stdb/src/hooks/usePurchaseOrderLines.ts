import { queryPurchaseOrderLines, type PurchaseOrderLine } from "../queries/purchasing";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getStdbConnection } from "../connection";

export type { PurchaseOrderLine };

export function usePurchaseOrderLines(companyId: bigint, initialData?: Record<string, unknown>[]) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["purchase-order-lines", companyId.toString()], [companyId]);

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.purchase_order_line.onInsert((_ctx, _row) => reload());
    conn.db.purchase_order_line.onUpdate((_ctx, _old, _new) => reload());
    conn.db.purchase_order_line.onDelete((_ctx, _row) => reload());
  }, [queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: queryPurchaseOrderLines,
    staleTime: Infinity,
    initialData: initialData as never,
    initialDataUpdatedAt: initialData?.length ? 0 : undefined,
  });
}

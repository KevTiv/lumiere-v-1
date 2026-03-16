import { queryPurchaseRequisitions, type PurchaseRequisition } from "../queries/purchasing";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { PurchaseRequisition };

export function usePurchaseRequisitions(companyId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["purchase-requisitions", companyId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.purchase_requisition.onInsert((_ctx, _row) => reload());
    conn.db.purchase_requisition.onUpdate((_ctx, _old, _new) => reload());
    conn.db.purchase_requisition.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryPurchaseRequisitions, staleTime: Infinity });
}

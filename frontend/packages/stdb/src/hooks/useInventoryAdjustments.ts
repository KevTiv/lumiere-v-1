import { queryInventoryAdjustments, type InventoryAdjustment } from "../queries/inventory";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { InventoryAdjustment };

export function useInventoryAdjustments(organizationId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["inventory-adjustments", organizationId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.inventory_adjustment.onInsert((_ctx, _row) => reload());
    conn.db.inventory_adjustment.onUpdate((_ctx, _old, _new) => reload());
    conn.db.inventory_adjustment.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryInventoryAdjustments, staleTime: Infinity });
}

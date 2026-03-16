import { queryPickingBatches, type StockPickingBatch } from "../queries/sales";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { StockPickingBatch };

export function usePickingBatches(companyId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["picking-batches", companyId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.stock_picking_batch.onInsert((_ctx, _row) => reload());
    conn.db.stock_picking_batch.onUpdate((_ctx, _old, _new) => reload());
    conn.db.stock_picking_batch.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryPickingBatches, staleTime: Infinity });
}

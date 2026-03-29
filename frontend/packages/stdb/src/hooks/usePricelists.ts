import { queryPricelists, type ProductPricelist } from "../queries/sales";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getStdbConnection } from "../connection";

export type { ProductPricelist };

/** Pricelists are scoped by `organization_id` (see serverQueryPricelists / product_pricelist). */
export function usePricelists(organizationId: bigint, initialData?: Record<string, unknown>[]) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["pricelists", organizationId.toString()], [organizationId]);

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.product_pricelist.onInsert((_ctx, _row) => reload());
    conn.db.product_pricelist.onUpdate((_ctx, _old, _new) => reload());
    conn.db.product_pricelist.onDelete((_ctx, _row) => reload());
  }, [queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: queryPricelists,
    staleTime: Infinity,
    initialData: initialData as never,
    initialDataUpdatedAt: initialData?.length ? 0 : undefined,
  });
}

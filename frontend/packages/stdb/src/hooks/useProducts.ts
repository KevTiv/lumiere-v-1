import { queryProducts, type Product } from "../queries/inventory";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { Product };

export function useProducts(organizationId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["products", organizationId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.product.onInsert((_ctx, _row) => reload());
    conn.db.product.onUpdate((_ctx, _old, _new) => reload());
    conn.db.product.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryProducts, staleTime: Infinity });
}

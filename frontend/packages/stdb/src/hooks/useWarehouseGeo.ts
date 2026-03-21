import { queryWarehouseGeo, type WarehouseGeo } from "../queries/fleet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getStdbConnection } from "../connection";

export type { WarehouseGeo };

export function useWarehouseGeo(organizationId: bigint, initialData?: Record<string, unknown>[]) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["warehouse-geo", organizationId.toString()], [organizationId]);

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (conn as any).db;
    if (!db?.warehouse_geo) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    db.warehouse_geo.onInsert((_ctx: unknown, _row: unknown) => reload());
    db.warehouse_geo.onUpdate((_ctx: unknown, _old: unknown, _new: unknown) => reload());
    db.warehouse_geo.onDelete((_ctx: unknown, _row: unknown) => reload());
  }, [queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: queryWarehouseGeo,
    staleTime: Infinity,
    initialData: initialData as never,
    initialDataUpdatedAt: initialData?.length ? 0 : undefined,
  });
}

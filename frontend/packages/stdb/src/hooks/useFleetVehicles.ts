import { queryFleetVehicles, type FleetVehicle } from "../queries/fleet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getStdbConnection } from "../connection";

export type { FleetVehicle };

export function useFleetVehicles(organizationId: bigint, initialData?: Record<string, unknown>[]) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["fleet-vehicles", organizationId.toString()], [organizationId]);

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (conn as any).db;
    if (!db?.fleet_vehicle) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    db.fleet_vehicle.onInsert((_ctx: unknown, _row: unknown) => reload());
    db.fleet_vehicle.onUpdate((_ctx: unknown, _old: unknown, _new: unknown) => reload());
    db.fleet_vehicle.onDelete((_ctx: unknown, _row: unknown) => reload());
  }, [queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: queryFleetVehicles,
    staleTime: Infinity,
    initialData: initialData as never,
    initialDataUpdatedAt: initialData?.length ? 0 : undefined,
  });
}

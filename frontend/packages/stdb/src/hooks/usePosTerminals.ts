import { queryPosTerminals, type PosTerminal } from "../queries/fleet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getStdbConnection } from "../connection";

export type { PosTerminal };

export function usePosTerminals(organizationId: bigint, initialData?: Record<string, unknown>[]) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["pos-terminals", organizationId.toString()], [organizationId]);

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (conn as any).db;
    if (!db?.pos_terminal) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    db.pos_terminal.onInsert((_ctx: unknown, _row: unknown) => reload());
    db.pos_terminal.onUpdate((_ctx: unknown, _old: unknown, _new: unknown) => reload());
    db.pos_terminal.onDelete((_ctx: unknown, _row: unknown) => reload());
  }, [queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: queryPosTerminals,
    staleTime: Infinity,
    initialData: initialData as never,
    initialDataUpdatedAt: initialData?.length ? 0 : undefined,
  });
}

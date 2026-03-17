import { queryAccountMoves, type AccountMove } from "../queries/accounting";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getStdbConnection } from "../connection";

export type { AccountMove };

export function useAccountMoves(companyId: bigint, moveType?: string, initialData?: Record<string, unknown>[]) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["account-moves", companyId.toString(), moveType ?? "all"], [companyId, moveType]);

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.account_move.onInsert((_ctx, _row) => reload());
    conn.db.account_move.onUpdate((_ctx, _old, _new) => reload());
    conn.db.account_move.onDelete((_ctx, _row) => reload());
  }, [queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: () => queryAccountMoves(moveType),
    staleTime: Infinity,
    initialData: initialData as never,
    initialDataUpdatedAt: initialData?.length ? 0 : undefined,
  });
}

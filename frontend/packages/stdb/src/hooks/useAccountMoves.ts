import { queryAccountMoves, type AccountMove } from "../queries/accounting";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { AccountMove };

export function useAccountMoves(companyId: bigint, moveType?: string) {
  const queryClient = useQueryClient();
  const queryKey = ["account-moves", companyId.toString(), moveType ?? "all"];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.account_move.onInsert((_ctx, _row) => reload());
    conn.db.account_move.onUpdate((_ctx, _old, _new) => reload());
    conn.db.account_move.onDelete((_ctx, _row) => reload());
  }, [moveType, queryClient]);

  return useQuery({
    queryKey,
    queryFn: () => queryAccountMoves(moveType),
    staleTime: Infinity,
  });
}

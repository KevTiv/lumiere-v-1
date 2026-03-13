import { queryBudgets, type CrossoveredBudget } from "../queries/accounting";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { CrossoveredBudget };

export function useBudgets(companyId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["budgets", companyId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.crossovered_budget.onInsert((_ctx, _row) => reload());
    conn.db.crossovered_budget.onUpdate((_ctx, _old, _new) => reload());
    conn.db.crossovered_budget.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryBudgets, staleTime: Infinity });
}

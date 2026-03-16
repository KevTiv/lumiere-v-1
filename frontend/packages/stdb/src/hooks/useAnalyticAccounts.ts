import { queryAnalyticAccounts, type AccountAnalyticAccount } from "../queries/accounting";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { AccountAnalyticAccount };

export function useAnalyticAccounts(companyId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["analytic-accounts", companyId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.account_analytic_account.onInsert((_ctx, _row) => reload());
    conn.db.account_analytic_account.onUpdate((_ctx, _old, _new) => reload());
    conn.db.account_analytic_account.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryAnalyticAccounts, staleTime: Infinity });
}

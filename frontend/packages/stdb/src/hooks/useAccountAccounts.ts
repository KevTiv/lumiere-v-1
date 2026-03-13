import { queryAccountAccounts, type AccountAccount } from "../queries/accounting";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { AccountAccount };

export function useAccountAccounts(companyId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["account-accounts", companyId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.account_account.onInsert((_ctx, _row) => reload());
    conn.db.account_account.onUpdate((_ctx, _old, _new) => reload());
    conn.db.account_account.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryAccountAccounts, staleTime: Infinity });
}

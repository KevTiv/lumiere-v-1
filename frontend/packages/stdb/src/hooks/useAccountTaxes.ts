import { queryAccountTaxes, type AccountTax } from "../queries/accounting";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { AccountTax };

export function useAccountTaxes(companyId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["account-taxes", companyId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.account_tax.onInsert((_ctx, _row) => reload());
    conn.db.account_tax.onUpdate((_ctx, _old, _new) => reload());
    conn.db.account_tax.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryAccountTaxes, staleTime: Infinity });
}

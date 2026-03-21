import { queryBankStatements, type AccountBankStatement } from "../queries/accounting";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getStdbConnection } from "../connection";

export type { AccountBankStatement };

export function useBankStatements(companyId: bigint, initialData?: Record<string, unknown>[]) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["bank-statements", companyId.toString()], [companyId]);

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.account_bank_statement.onInsert((_ctx, _row) => reload());
    conn.db.account_bank_statement.onUpdate((_ctx, _old, _new) => reload());
    conn.db.account_bank_statement.onDelete((_ctx, _row) => reload());
  }, [queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: queryBankStatements,
    staleTime: Infinity,
    initialData: initialData as never,
    initialDataUpdatedAt: initialData?.length ? 0 : undefined,
  });
}

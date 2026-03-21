import { queryExpenses, type HrExpense } from "../queries/expenses";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getStdbConnection } from "../connection";

export type { HrExpense };

export function useExpenses(organizationId: bigint, initialData?: Record<string, unknown>[]) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["expenses", organizationId.toString()], [organizationId]);

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.hr_expense.onInsert((_ctx, _row) => reload());
    conn.db.hr_expense.onUpdate((_ctx, _old, _new) => reload());
    conn.db.hr_expense.onDelete((_ctx, _row) => reload());
  }, [queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: queryExpenses,
    staleTime: Infinity,
    initialData: initialData as never,
    initialDataUpdatedAt: initialData?.length ? 0 : undefined,
  });
}

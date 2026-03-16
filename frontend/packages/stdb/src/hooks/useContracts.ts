import { queryContracts, type HrContract } from "../queries/hr";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { HrContract };

export function useContracts(companyId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["hr-contracts", companyId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.hr_contract.onInsert((_ctx, _row) => reload());
    conn.db.hr_contract.onUpdate((_ctx, _old, _new) => reload());
    conn.db.hr_contract.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryContracts, staleTime: Infinity });
}

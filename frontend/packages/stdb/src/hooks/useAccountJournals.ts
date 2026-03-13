import { queryAccountJournals, type AccountJournal } from "../queries/accounting";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { AccountJournal };

export function useAccountJournals(companyId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["account-journals", companyId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.account_journal.onInsert((_ctx, _row) => reload());
    conn.db.account_journal.onUpdate((_ctx, _old, _new) => reload());
    conn.db.account_journal.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryAccountJournals, staleTime: Infinity });
}

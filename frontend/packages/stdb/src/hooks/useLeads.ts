import { queryLeads, type Lead } from "../queries/crm";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { Lead };

export function useLeads(organizationId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["leads", organizationId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.lead.onInsert((_ctx, _row) => reload());
    conn.db.lead.onUpdate((_ctx, _old, _new) => reload());
    conn.db.lead.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryLeads, staleTime: Infinity });
}

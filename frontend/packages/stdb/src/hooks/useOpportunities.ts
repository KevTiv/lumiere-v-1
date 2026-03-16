import { queryOpportunities, type Opportunity } from "../queries/crm";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { Opportunity };

export function useOpportunities(organizationId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["opportunities", organizationId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.opportunity.onInsert((_ctx, _row) => reload());
    conn.db.opportunity.onUpdate((_ctx, _old, _new) => reload());
    conn.db.opportunity.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryOpportunities, staleTime: Infinity });
}

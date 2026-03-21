import { queryHelpdeskTickets, type HelpdeskTicket } from "../queries/helpdesk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getStdbConnection } from "../connection";

export type { HelpdeskTicket };

export function useHelpdeskTickets(organizationId: bigint, initialData?: Record<string, unknown>[]) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["helpdesk-tickets", organizationId.toString()], [organizationId]);

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.helpdesk_ticket.onInsert((_ctx, _row) => reload());
    conn.db.helpdesk_ticket.onUpdate((_ctx, _old, _new) => reload());
    conn.db.helpdesk_ticket.onDelete((_ctx, _row) => reload());
  }, [queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: queryHelpdeskTickets,
    staleTime: Infinity,
    initialData: initialData as never,
    initialDataUpdatedAt: initialData?.length ? 0 : undefined,
  });
}

import { queryContacts, type Contact } from "../queries/crm";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getStdbConnection } from "../connection";

export type { Contact };

export function useContacts(organizationId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = ["contacts", organizationId.toString()];

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.contact.onInsert((_ctx, _row) => reload());
    conn.db.contact.onUpdate((_ctx, _old, _new) => reload());
    conn.db.contact.onDelete((_ctx, _row) => reload());
  }, [queryClient]);

  return useQuery({ queryKey, queryFn: queryContacts, staleTime: Infinity });
}

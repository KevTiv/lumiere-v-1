import { queryHelpdeskSLAs, type HelpdeskSla } from "../queries/helpdesk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getStdbConnection } from "../connection";

export type { HelpdeskSla };

export function useHelpdeskSLAs(organizationId: bigint, initialData?: Record<string, unknown>[]) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["helpdesk-slas", organizationId.toString()], [organizationId]);

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.helpdesk_sla.onInsert((_ctx, _row) => reload());
    conn.db.helpdesk_sla.onUpdate((_ctx, _old, _new) => reload());
    conn.db.helpdesk_sla.onDelete((_ctx, _row) => reload());
  }, [queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: queryHelpdeskSLAs,
    staleTime: Infinity,
    initialData: initialData as never,
    initialDataUpdatedAt: initialData?.length ? 0 : undefined,
  });
}

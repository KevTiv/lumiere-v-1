import { queryHelpdeskStages, type HelpdeskStage } from "../queries/helpdesk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getStdbConnection } from "../connection";

export type { HelpdeskStage };

export function useHelpdeskStages(organizationId: bigint, initialData?: Record<string, unknown>[]) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["helpdesk-stages", organizationId.toString()], [organizationId]);

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.helpdesk_stage.onInsert((_ctx, _row) => reload());
    conn.db.helpdesk_stage.onUpdate((_ctx, _old, _new) => reload());
    conn.db.helpdesk_stage.onDelete((_ctx, _row) => reload());
  }, [queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: queryHelpdeskStages,
    staleTime: Infinity,
    initialData: initialData as never,
    initialDataUpdatedAt: initialData?.length ? 0 : undefined,
  });
}

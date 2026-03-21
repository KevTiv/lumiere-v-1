import { queryHelpdeskTeams, type HelpdeskTeam } from "../queries/helpdesk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getStdbConnection } from "../connection";

export type { HelpdeskTeam };

export function useHelpdeskTeams(organizationId: bigint, initialData?: Record<string, unknown>[]) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["helpdesk-teams", organizationId.toString()], [organizationId]);

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.helpdesk_team.onInsert((_ctx, _row) => reload());
    conn.db.helpdesk_team.onUpdate((_ctx, _old, _new) => reload());
    conn.db.helpdesk_team.onDelete((_ctx, _row) => reload());
  }, [queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: queryHelpdeskTeams,
    staleTime: Infinity,
    initialData: initialData as never,
    initialDataUpdatedAt: initialData?.length ? 0 : undefined,
  });
}

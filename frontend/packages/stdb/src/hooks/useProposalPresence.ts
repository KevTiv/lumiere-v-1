import { queryProposalPresence, type ProposalPresence } from "../queries/proposals";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getStdbConnection } from "../connection";

export type { ProposalPresence };

export function useProposalPresence(organizationId: bigint, proposalId?: bigint) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["proposal-presence", organizationId.toString(), proposalId?.toString()],
    [organizationId, proposalId],
  );

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (conn as any).db;
    if (!db?.proposal_presence) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    db.proposal_presence.onInsert((_ctx: unknown, _row: unknown) => reload());
    db.proposal_presence.onUpdate((_ctx: unknown, _old: unknown, _new: unknown) => reload());
    db.proposal_presence.onDelete((_ctx: unknown, _row: unknown) => reload());
  }, [queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: () => queryProposalPresence(proposalId),
    staleTime: Infinity,
  });
}

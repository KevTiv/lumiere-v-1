import { queryProposalComments, type ProposalComment } from "../queries/proposals";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getStdbConnection } from "../connection";

export type { ProposalComment };

export function useProposalComments(organizationId: bigint, proposalId?: bigint) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["proposal-comments", organizationId.toString(), proposalId?.toString()],
    [organizationId, proposalId],
  );

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (conn as any).db;
    if (!db?.proposal_comment) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    db.proposal_comment.onInsert((_ctx: unknown, _row: unknown) => reload());
    db.proposal_comment.onUpdate((_ctx: unknown, _old: unknown, _new: unknown) => reload());
    db.proposal_comment.onDelete((_ctx: unknown, _row: unknown) => reload());
  }, [queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: () => queryProposalComments(proposalId),
    staleTime: Infinity,
  });
}

import { queryProposalLineItems, type ProposalLineItem } from "../queries/proposals";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getStdbConnection } from "../connection";

export type { ProposalLineItem };

export function useProposalLineItems(organizationId: bigint, proposalId?: bigint) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["proposal-line-items", organizationId.toString(), proposalId?.toString()],
    [organizationId, proposalId],
  );

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (conn as any).db;
    if (!db?.proposal_line_item) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    db.proposal_line_item.onInsert((_ctx: unknown, _row: unknown) => reload());
    db.proposal_line_item.onUpdate((_ctx: unknown, _old: unknown, _new: unknown) => reload());
    db.proposal_line_item.onDelete((_ctx: unknown, _row: unknown) => reload());
  }, [queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: () => queryProposalLineItems(proposalId),
    staleTime: Infinity,
  });
}

import { queryProposalSourceDocs, type ProposalSourceDoc } from "../queries/proposals";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getStdbConnection } from "../connection";

export type { ProposalSourceDoc };

export function useProposalSourceDocs(organizationId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["proposal-source-docs", organizationId.toString()],
    [organizationId],
  );

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (conn as any).db;
    if (!db?.proposal_source_doc) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    db.proposal_source_doc.onInsert((_ctx: unknown, _row: unknown) => reload());
    db.proposal_source_doc.onUpdate((_ctx: unknown, _old: unknown, _new: unknown) => reload());
    db.proposal_source_doc.onDelete((_ctx: unknown, _row: unknown) => reload());
  }, [queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: queryProposalSourceDocs,
    staleTime: Infinity,
  });
}

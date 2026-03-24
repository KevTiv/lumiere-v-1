import { queryProposalVersions, type ProposalVersion } from "../queries/proposals";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getStdbConnection } from "../connection";

export type { ProposalVersion };

export function useProposalVersions(organizationId: bigint) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["proposal-versions", organizationId.toString()],
    [organizationId],
  );

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (conn as any).db;
    if (!db?.proposal_version) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    db.proposal_version.onInsert((_ctx: unknown, _row: unknown) => reload());
    db.proposal_version.onDelete((_ctx: unknown, _row: unknown) => reload());
  }, [queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: queryProposalVersions,
    staleTime: Infinity,
  });
}

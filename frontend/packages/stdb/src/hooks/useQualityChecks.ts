import { queryQualityChecks, type QualityCheck } from "../queries/inventory";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getStdbConnection } from "../connection";

export type { QualityCheck };

export function useQualityChecks(companyId: bigint, initialData?: Record<string, unknown>[]) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["quality-checks", companyId.toString()], [companyId]);

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.quality_check.onInsert((_ctx, _row) => reload());
    conn.db.quality_check.onUpdate((_ctx, _old, _new) => reload());
    conn.db.quality_check.onDelete((_ctx, _row) => reload());
  }, [queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: queryQualityChecks,
    staleTime: Infinity,
    initialData: initialData as never,
    initialDataUpdatedAt: initialData?.length ? 0 : undefined,
  });
}

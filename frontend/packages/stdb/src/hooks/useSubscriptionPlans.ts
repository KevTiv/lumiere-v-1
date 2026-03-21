import { querySubscriptionPlans, type SubscriptionPlan } from "../queries/subscriptions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getStdbConnection } from "../connection";

export type { SubscriptionPlan };

export function useSubscriptionPlans(organizationId: bigint, initialData?: Record<string, unknown>[]) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["subscription-plans", organizationId.toString()], [organizationId]);

  useEffect(() => {
    const conn = getStdbConnection();
    if (!conn) return;
    const reload = () => queryClient.invalidateQueries({ queryKey });
    conn.db.subscription_plan.onInsert((_ctx, _row) => reload());
    conn.db.subscription_plan.onUpdate((_ctx, _old, _new) => reload());
    conn.db.subscription_plan.onDelete((_ctx, _row) => reload());
  }, [queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: querySubscriptionPlans,
    staleTime: Infinity,
    initialData: initialData as never,
    initialDataUpdatedAt: initialData?.length ? 0 : undefined,
  });
}

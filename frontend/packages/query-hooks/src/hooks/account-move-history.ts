"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { apiFetch } from "../http";
import {
  accountMoveHistoryQueryKey,
  accountMoveHistoryQueryPath,
  accountMoveHistoryScopeReady,
  parseAccountMoveHistoryPage,
  type AccountMoveHistoryScope,
} from "./account-move-history-model";

export class AccountMoveHistoryReadError extends Error {
  constructor(readonly status: number) {
    super("Business change history is unavailable");
    this.name = "AccountMoveHistoryReadError";
  }
}

export function useAccountMoveHistory(
  scope: AccountMoveHistoryScope,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: accountMoveHistoryQueryKey(scope),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const response = await apiFetch(
        accountMoveHistoryQueryPath(scope, pageParam),
        { signal, cache: "no-store" },
      );
      if (!response.ok) throw new AccountMoveHistoryReadError(response.status);
      return parseAccountMoveHistoryPage(await response.json(), scope);
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: enabled && accountMoveHistoryScopeReady(scope),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: "always",
  });
}

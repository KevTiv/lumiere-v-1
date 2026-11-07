"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { apiFetch } from "../http";
import {
  businessHistoryQueryKey, businessHistoryQueryPath, businessHistoryScopeReady,
  parseBusinessHistoryPage, parseBusinessHistorySourcesPage,
  type BusinessHistoryScope,
  businessHistoryActivityQueryKey, businessHistoryActivityQueryPath, businessHistoryActivityScopeReady,
  parseBusinessHistoryActivityPage, type BusinessHistoryActivityScope,
} from "./business-history-model";

export class BusinessHistoryReadError extends Error {
  constructor(readonly status: number) {
    super("Business history is unavailable");
    this.name = "BusinessHistoryReadError";
  }
}

export function useBusinessHistory(scope: BusinessHistoryScope, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: businessHistoryQueryKey(scope),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const response = await apiFetch(businessHistoryQueryPath(scope, pageParam), { signal, cache: "no-store" });
      if (!response.ok) throw new BusinessHistoryReadError(response.status);
      return parseBusinessHistoryPage(await response.json(), scope);
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: enabled && businessHistoryScopeReady(scope),
    staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: "always",
  });
}

export function useBusinessHistorySources(scope: BusinessHistoryScope, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: businessHistoryQueryKey(scope, "sources"),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const response = await apiFetch(businessHistoryQueryPath(scope, pageParam, "sources"), { signal, cache: "no-store" });
      if (!response.ok) throw new BusinessHistoryReadError(response.status);
      return parseBusinessHistorySourcesPage(await response.json(), scope);
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: enabled && businessHistoryScopeReady(scope),
    staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: "always",
  });
}

export function useBusinessHistoryActivity(scope: BusinessHistoryActivityScope, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: businessHistoryActivityQueryKey(scope),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const response = await apiFetch(businessHistoryActivityQueryPath(scope, pageParam), { signal, cache: "no-store" });
      if (!response.ok) throw new BusinessHistoryReadError(response.status);
      return parseBusinessHistoryActivityPage(await response.json(), scope);
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: enabled && businessHistoryActivityScopeReady(scope),
    staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: "always",
  });
}

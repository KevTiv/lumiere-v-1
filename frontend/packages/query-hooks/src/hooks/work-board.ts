"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { responseErrorMessage } from "@lumiere/api-client/response-error"
import { apiFetch } from "../http"
import {
  parseWorkBoardPage,
  workBoardQueryKey,
  workBoardQueryPath,
  type WorkBoardScope,
} from "./work-board-model"

export function useWorkBoard(scope: WorkBoardScope, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: workBoardQueryKey(scope),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const response = await apiFetch(workBoardQueryPath(scope, pageParam), {
        signal,
      })
      if (!response.ok) throw new Error(await responseErrorMessage(response))
      return parseWorkBoardPage(await response.json(), scope)
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled:
      enabled &&
      scope.organizationId > 0 &&
      scope.companyId > 0 &&
      !!scope.actorIdentity,
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: "always",
    retry: false,
  })
}

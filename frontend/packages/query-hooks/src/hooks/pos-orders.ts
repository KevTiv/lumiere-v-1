'use client';
/**
 * POS orders — `/api/query/pos-orders` is cursor-paginated (hot + cold archive)
 * and deliberately outside the subscription census, so it is read with an
 * infinite query rather than a subscription. Lines and payments have no read
 * path. The endpoint has no session filter; callers filter loaded pages.
 */

import { useInfiniteQuery } from '@tanstack/react-query';

import { apiFetch, rqBigIntKey } from '../http';
import {
  buildPosOrdersPath,
  mergePosOrderPages,
  nextPosOrdersCursor,
  parsePosOrdersPage,
  POS_ORDERS_PAGE_SIZE,
  type PosOrdersPage,
} from './pos-orders-pages';

export function usePosOrders(organizationId: bigint, companyId?: bigint) {
  const query = useInfiniteQuery<PosOrdersPage, Error>({
    queryKey: ['pos-orders', rqBigIntKey(organizationId), companyId === undefined ? 'default' : rqBigIntKey(companyId)],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const response = await apiFetch(
        buildPosOrdersPath({ companyId, cursor: pageParam as string | null, limit: POS_ORDERS_PAGE_SIZE }),
      );
      if (!response.ok) throw new Error('Failed to fetch POS orders');
      return parsePosOrdersPage(await response.json());
    },
    getNextPageParam: (_last, pages) => nextPosOrdersCursor(pages),
    staleTime: 15_000,
  });
  const rows = query.data ? mergePosOrderPages(query.data.pages) : [];
  return {
    rows,
    isLoading: query.isLoading,
    error: query.error,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: () => void query.fetchNextPage(),
    refetch: () => void query.refetch(),
  };
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { readRecordListContext } from '@lumiere/ui/lib/record-list-context';
import { buildRecordNavigation, type RecordNavigationInput } from '@/lib/record-navigation';

/**
 * Previous / next for a record page. Follows the list the user opened the record from (its
 * filters, search, sort and grouping) when that list published one, else the default order.
 */
export function useRecordNavigation<T>(input: RecordNavigationInput<T>) {
  const { rows, currentId, basePath } = input;
  const [contextIds, setContextIds] = useState<string[] | undefined>(undefined);
  useEffect(() => {
    setContextIds(readRecordListContext(basePath));
  }, [basePath]);
  const latest = useRef(input);
  latest.current = input;
  return useMemo(
    () => buildRecordNavigation({ ...latest.current, rows, currentId, basePath, contextIds }),
    [rows, currentId, basePath, contextIds],
  );
}

/** Previous / next for a record page: the list the user opened it from, else the default order. */

export interface RecordNavigationLink {
  href: string;
  label: string;
}

export interface RecordNavigationResult {
  position: number;
  total: number;
  previous?: RecordNavigationLink;
  next?: RecordNavigationLink;
}

export interface RecordNavigationInput<T> {
  /** The page's rows, in any order. */
  rows: readonly T[];
  currentId: string;
  /** The ordered keys of the list the user came from, when one was published. */
  contextIds?: readonly string[];
  basePath: string;
  labelOf: (row: T) => string;
  idOf?: (row: T) => string;
  /** The default order: newest (highest id) first unless the page says otherwise. */
  compare?: (a: T, b: T) => number;
}

const defaultId = (row: unknown): string => String((row as { id?: unknown }).id);

function newestFirst(a: unknown, b: unknown): number {
  const left = defaultId(a);
  const right = defaultId(b);
  try {
    const diff = BigInt(right) - BigInt(left);
    return diff > 0n ? 1 : diff < 0n ? -1 : 0;
  } catch {
    return right.localeCompare(left);
  }
}

/**
 * The list's order when `contextIds` holds the current record (rows deleted or no longer visible
 * since are skipped), otherwise the default order. Undefined when the record is in neither.
 */
export function buildRecordNavigation<T>(input: RecordNavigationInput<T>): RecordNavigationResult | undefined {
  const idOf = input.idOf ?? defaultId;
  const byId = new Map<string, T>();
  for (const row of input.rows) byId.set(idOf(row), row);

  let ordered: T[] | undefined;
  if (input.contextIds?.includes(input.currentId)) {
    const fromList: T[] = [];
    const seen = new Set<string>();
    for (const id of input.contextIds) {
      const row = byId.get(id);
      if (row && !seen.has(id)) {
        seen.add(id);
        fromList.push(row);
      }
    }
    if (seen.has(input.currentId)) ordered = fromList;
  }
  if (!ordered) {
    ordered = [...input.rows].sort(input.compare ?? newestFirst);
  }

  const index = ordered.findIndex((row) => idOf(row) === input.currentId);
  if (index === -1) return undefined;
  const link = (row: T | undefined): RecordNavigationLink | undefined =>
    row ? { href: `${input.basePath}/${idOf(row)}`, label: input.labelOf(row) } : undefined;
  return {
    position: index + 1,
    total: ordered.length,
    previous: link(ordered[index - 1]),
    next: link(ordered[index + 1]),
  };
}

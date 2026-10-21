/**
 * The list a record page was opened from: previous / next on the page follow the filters, search,
 * sort and grouping the user had in that list, not the default order.
 *
 * A list publishes the ordered keys of the rows it shows when the user opens a record from it; the
 * record page reads them back. The context is filed under the record page's base path
 * (`/purchasing/orders` for `/purchasing/orders/12`) so both sides agree without sharing a key.
 * Storage is sessionStorage, always best effort: nothing here may break navigation.
 */

const KEY_PREFIX = "lumiere:record-list:"
/** More rows than this are not worth a storage write: the page falls back to its default order. */
export const MAX_RECORD_LIST_SIZE = 5000
/** A context older than this is stale: the user has moved on from that list. */
export const RECORD_LIST_TTL_MS = 30 * 60 * 1000

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">

interface StoredContext {
  ids: string[]
  at: number
}

/** `/purchasing/orders/12?tab=x` -> `{ base: "/purchasing/orders", id: "12" }`. */
export function splitRecordHref(href: string): { base: string; id: string } | undefined {
  const path = href.split(/[?#]/, 1)[0] ?? ""
  const match = /^(\/.*?)\/([^/]+)\/?$/.exec(path)
  if (!match) return undefined
  const [, base, id] = match
  if (!base || !id) return undefined
  return { base, id: decodeURIComponent(id) }
}

function defaultStorage(): StorageLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage
  } catch {
    return undefined
  }
}

/** Files `ids` as the list `base` was last opened from. Returns whether it was stored. */
export function writeRecordListContext(
  base: string,
  ids: readonly string[],
  storage: StorageLike | undefined = defaultStorage(),
  now: number = Date.now(),
): boolean {
  if (!storage || ids.length === 0) return false
  try {
    if (ids.length > MAX_RECORD_LIST_SIZE) {
      storage.removeItem(KEY_PREFIX + base)
      return false
    }
    const value: StoredContext = { ids: [...ids], at: now }
    storage.setItem(KEY_PREFIX + base, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

/** The ordered keys of the list `base` was opened from, or undefined when absent, stale or unreadable. */
export function readRecordListContext(
  base: string,
  storage: StorageLike | undefined = defaultStorage(),
  now: number = Date.now(),
): string[] | undefined {
  if (!storage) return undefined
  try {
    const raw = storage.getItem(KEY_PREFIX + base)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as Partial<StoredContext> | null
    if (!parsed || !Array.isArray(parsed.ids) || typeof parsed.at !== "number") return undefined
    if (now - parsed.at > RECORD_LIST_TTL_MS || now < parsed.at) return undefined
    if (!parsed.ids.every((id) => typeof id === "string")) return undefined
    return parsed.ids
  } catch {
    return undefined
  }
}

/**
 * What the last list the user clicked in shows. The record sheet's Open button has no list of its
 * own, so it commits this one.
 */
let pendingList: readonly string[] | undefined

export function rememberRecordList(ids: readonly string[]): void {
  pendingList = ids
}

/** Publishes the remembered list for the record page at `href`, if that record is in it. */
export function commitRecordListFor(href: string | undefined, ids: readonly string[] | undefined = pendingList): boolean {
  if (!href || !ids) return false
  try {
    const target = splitRecordHref(href)
    if (!target || !ids.includes(target.id)) return false
    return writeRecordListContext(target.base, ids)
  } catch {
    return false
  }
}

/** Ordered record keys and optional Accounting return state, held only in this browser session. */
const KEY_PREFIX = "lumiere:record-list:"
export const MAX_RECORD_LIST_SIZE = 5000
export const RECORD_LIST_TTL_MS = 30 * 60 * 1000

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">
export interface RecordListReturnContext {
  key: string
  href: string
  filterKey: string
  sorting: Array<{ id: string; desc: boolean }>
  /** One-based table page. */
  page: number
  rowId: string
  focus: "link" | "row"
  scrollTop: number
  scrollLeft: number
}
interface StoredContext {
  ids: string[]
  at: number
  returnTo?: RecordListReturnContext
}
const ACCOUNTING_SORT_KEYS = new Set(["id", "name", "partner", "issueDate", "dueDate", "amountTotal", "amountResidual", "currency", "status"])

export function splitRecordHref(href: string): { base: string; id: string } | undefined {
  try {
    const path = href.split(/[?#]/, 1)[0] ?? ""
    const match = /^(\/.*?)\/([^/]+)\/?$/.exec(path)
    if (!match?.[1] || !match[2]) return undefined
    return { base: match[1], id: decodeURIComponent(match[2]) }
  } catch { return undefined }
}
function defaultStorage(): StorageLike | undefined {
  try { return typeof window === "undefined" ? undefined : window.sessionStorage }
  catch { return undefined }
}

/** Return links stay on the exact Accounting list and agree with the scoped worklist kind. */
export function accountingListReturnHref(href: string, key: string): string | undefined {
  try {
    if (!/^lumiere:accounting-worklist:v1:[1-9][0-9]*:[1-9][0-9]*:[^:]+:(invoice|bill)$/.test(key)) return undefined
    if (!href.startsWith("/accounting?") || href.includes("\\") || /[\u0000-\u0020]/.test(href)) return undefined
    const url = new URL(href, "https://record-list.invalid")
    const tab = key.endsWith(":bill") ? "bills" : "invoices"
    if (url.origin !== "https://record-list.invalid" || url.pathname !== "/accounting" || url.hash
      || url.searchParams.getAll("tab").length !== 1 || url.searchParams.get("tab") !== tab) return undefined
    for (const name of ["redirect", "redirectTo", "returnTo", "next", "url"]) if (url.searchParams.has(name)) return undefined
    return url.pathname + url.search
  } catch { return undefined }
}
function validReturn(value: unknown, ids: readonly string[]): value is RecordListReturnContext {
  if (!value || typeof value !== "object") return false
  const item = value as Partial<RecordListReturnContext>
  return typeof item.key === "string" && item.key.length <= 4096
    && typeof item.href === "string" && item.href.length <= 16384 && accountingListReturnHref(item.href, item.key) === item.href
    && typeof item.filterKey === "string" && item.filterKey.length <= 16384
    && typeof item.rowId === "string" && ids.includes(item.rowId)
    && (item.focus === "link" || item.focus === "row")
    && Number.isSafeInteger(item.page) && item.page! >= 1 && item.page! <= MAX_RECORD_LIST_SIZE
    && typeof item.scrollTop === "number" && Number.isFinite(item.scrollTop) && item.scrollTop >= 0 && item.scrollTop <= 100_000_000
    && typeof item.scrollLeft === "number" && Number.isFinite(item.scrollLeft) && item.scrollLeft >= 0 && item.scrollLeft <= 100_000_000
    && Array.isArray(item.sorting) && item.sorting.length <= ACCOUNTING_SORT_KEYS.size
    && item.sorting.every((sort) => sort && typeof sort.id === "string" && ACCOUNTING_SORT_KEYS.has(sort.id) && typeof sort.desc === "boolean")
    && new Set(item.sorting.map((sort) => sort.id)).size === item.sorting.length
}
function storedContext(base: string, storage: StorageLike | undefined, now: number): StoredContext | undefined {
  if (!storage) return undefined
  try {
    const parsed = JSON.parse(storage.getItem(KEY_PREFIX + base) ?? "null") as StoredContext | null
    if (!parsed || !Array.isArray(parsed.ids) || parsed.ids.length > MAX_RECORD_LIST_SIZE
      || !parsed.ids.every((id) => typeof id === "string") || !Number.isFinite(parsed.at)
      || now - parsed.at > RECORD_LIST_TTL_MS || now < parsed.at) return undefined
    return parsed
  } catch { return undefined }
}

/** Existing ordered-ID consumers do not need to know about the optional return snapshot. */
export function writeRecordListContext(base: string, ids: readonly string[], storage: StorageLike | undefined = defaultStorage(), now = Date.now(), returnTo?: RecordListReturnContext): boolean {
  if (!storage || ids.length === 0) return false
  try {
    if (ids.length > MAX_RECORD_LIST_SIZE) { storage.removeItem(KEY_PREFIX + base); return false }
    const value: StoredContext = { ids: [...ids], at: now }
    if (base === "/accounting/invoices" && validReturn(returnTo, ids)) value.returnTo = returnTo
    storage.setItem(KEY_PREFIX + base, JSON.stringify(value))
    return true
  } catch { return false }
}
export function readRecordListContext(base: string, storage: StorageLike | undefined = defaultStorage(), now = Date.now()): string[] | undefined {
  return storedContext(base, storage, now)?.ids
}
export function readRecordListReturnContext(base: string, expected: { key: string; recordId?: string; href?: string; filterKey?: string }, storage: StorageLike | undefined = defaultStorage(), now = Date.now()): RecordListReturnContext | undefined {
  if (base !== "/accounting/invoices") return undefined
  const context = storedContext(base, storage, now)
  const item = context?.returnTo
  if (!context || !validReturn(item, context.ids) || item.key !== expected.key
    || (expected.recordId !== undefined && !context.ids.includes(expected.recordId))
    || (expected.href !== undefined && item.href !== expected.href)
    || (expected.filterKey !== undefined && item.filterKey !== expected.filterKey)) return undefined
  return item
}
/** Consume only the return snapshot; previous/next retain the original ordered keys and timestamp. */
export function consumeRecordListReturnContext(base: string, key: string): void {
  const storage = defaultStorage()
  const context = storedContext(base, storage, Date.now())
  if (!context || context.returnTo?.key !== key || !storage) return
  try { delete context.returnTo; storage.setItem(KEY_PREFIX + base, JSON.stringify(context)) } catch { /* Best effort. */ }
}

let pendingList: readonly string[] | undefined
let pendingReturn: RecordListReturnContext | undefined
let pendingAt = 0
export function rememberRecordList(ids: readonly string[], returnTo?: RecordListReturnContext): void {
  pendingList = ids
  pendingReturn = returnTo
  pendingAt = Date.now()
}
/** Sheet Open and canonical anchor activation use the same existing list owner. */
export function commitRecordListFor(href: string | undefined, ids: readonly string[] | undefined = pendingList, returnTo: RecordListReturnContext | undefined = ids === pendingList ? pendingReturn : undefined): boolean {
  if (!href || !ids || (ids === pendingList && Date.now() - pendingAt > RECORD_LIST_TTL_MS)) return false
  const target = splitRecordHref(href)
  if (!target || !ids.includes(target.id)) return false
  const snapshot = returnTo?.rowId === target.id ? returnTo : undefined
  return writeRecordListContext(target.base, ids, defaultStorage(), Date.now(), snapshot)
}

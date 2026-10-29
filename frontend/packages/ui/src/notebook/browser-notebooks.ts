import type { ErpSessionState } from "@lumiere/erp-session"
import type { Notebook } from "../lib/notebook-types"

const MAX_BYTES = 2_000_000
const MAX_NOTEBOOKS = 20

/** Browser work is isolated by the authenticated actor and explicitly authorized company. */
export function browserWorkScope(session: ErpSessionState): string | null {
  const { identity, organizationId, activeCompanyId, activeCompanyReady, companyIds } = session
  if (!identity || !activeCompanyReady || !Number.isSafeInteger(organizationId) || !organizationId || organizationId < 1
    || !Number.isSafeInteger(activeCompanyId) || !activeCompanyId || activeCompanyId < 1
    || !companyIds?.includes(activeCompanyId)) return null
  return [organizationId, activeCompanyId, identity].map((part) => encodeURIComponent(String(part))).join(":")
}

export function notebookStorageKey(scope: string): string { return `lumiere.notebook.v1:${scope}` }

function record(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function date(value: unknown): Date {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("Invalid notebook date")
  return new Date(value)
}

/** Imports are notes/code only: stored or imported output never becomes executed evidence. */
export function parseBrowserNotebook(value: unknown): Notebook {
  if (!record(value) || typeof value.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id)
    || typeof value.title !== "string" || value.title.length > 200
    || !Array.isArray(value.cells) || value.cells.length < 1 || value.cells.length > 100) throw new Error("Invalid notebook")
  const ids = new Set<string>()
  return {
    id: value.id, title: value.title, createdAt: date(value.createdAt), updatedAt: date(value.updatedAt),
    metadata: { category: "analysis" },
    cells: value.cells.map((cell) => {
      if (!record(cell) || typeof cell.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(cell.id) || ids.has(cell.id)
        || (cell.type !== "code" && cell.type !== "markdown") || typeof cell.content !== "string" || cell.content.length > 100_000)
        throw new Error("Invalid notebook cell")
      ids.add(cell.id)
      return { id: cell.id, type: cell.type, content: cell.content, outputs: [], status: "idle",
        createdAt: date(cell.createdAt), updatedAt: date(cell.updatedAt) }
    }),
  }
}

export interface BrowserNotebooks { activeId: string | null; notebooks: Notebook[] }

export function readBrowserNotebooks(storage: Pick<Storage, "getItem">, scope: string): BrowserNotebooks {
  const raw = storage.getItem(notebookStorageKey(scope))
  if (!raw) return { activeId: null, notebooks: [] }
  if (raw.length > MAX_BYTES) throw new Error("Notebook storage exceeds its limit")
  const parsed: unknown = JSON.parse(raw)
  if (!record(parsed) || parsed.version !== 1 || parsed.scope !== scope || !Array.isArray(parsed.notebooks)
    || parsed.notebooks.length > MAX_NOTEBOOKS || (parsed.activeId !== null && typeof parsed.activeId !== "string"))
    throw new Error("Invalid notebook storage")
  const notebooks = parsed.notebooks.map(parseBrowserNotebook)
  if (new Set(notebooks.map((item) => item.id)).size !== notebooks.length
    || (parsed.activeId !== null && !notebooks.some((item) => item.id === parsed.activeId))) throw new Error("Invalid notebook catalog")
  return { activeId: parsed.activeId as string | null, notebooks }
}

export function saveBrowserNotebook(storage: Pick<Storage, "getItem" | "setItem">, scope: string, notebook: Notebook, expected?: Notebook | null): BrowserNotebooks {
  const current = readBrowserNotebooks(storage, scope)
  const existing = current.notebooks.find((item) => item.id === notebook.id)
  if (expected !== undefined && JSON.stringify(existing ?? null) !== JSON.stringify(expected ? parseBrowserNotebook(JSON.parse(JSON.stringify(expected))) : null))
    throw new Error("This notebook changed in another browser tab. Export your edits and reopen the saved copy.")
  const snapshot = parseBrowserNotebook(JSON.parse(JSON.stringify(notebook)))
  const notebooks = [snapshot, ...current.notebooks.filter((item) => item.id !== snapshot.id)]
  if (notebooks.length > MAX_NOTEBOOKS) throw new Error("Export an existing notebook before adding more than 20 notebooks")
  const raw = JSON.stringify({ version: 1, scope, activeId: snapshot.id, notebooks })
  if (raw.length > MAX_BYTES) throw new Error("Notebook storage exceeds its limit")
  storage.setItem(notebookStorageKey(scope), raw)
  return { activeId: snapshot.id, notebooks }
}

export function deleteBrowserNotebook(storage: Pick<Storage, "getItem" | "setItem">, scope: string, id: string): BrowserNotebooks {
  const current = readBrowserNotebooks(storage, scope)
  const notebooks = current.notebooks.filter((item) => item.id !== id)
  const activeId = current.activeId === id ? notebooks[0]?.id ?? null : current.activeId
  storage.setItem(notebookStorageKey(scope), JSON.stringify({ version: 1, scope, activeId, notebooks }))
  return { notebooks, activeId }
}

export function importBrowserNotebook(raw: string): Notebook {
  if (raw.length > MAX_BYTES) throw new Error("Notebook file exceeds its limit")
  return parseBrowserNotebook(JSON.parse(raw))
}

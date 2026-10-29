import type { FileBrowserState } from "@lumiere/ui/documents/file-browser"

const documentId = (value: string | null) => value && /^[1-9]\d*$/.test(value) && BigInt(value) <= 18446744073709551615n ? value : null

/** Query state contains presentation only; folder/file access still comes from current projections. */
export function documentBrowserState(params: Pick<URLSearchParams, "get">): FileBrowserState {
  return {
    folderId: documentId(params.get("folder")),
    search: (params.get("fileSearch") ?? "").slice(0, 500),
    layout: params.get("fileLayout") === "list" ? "list" : "grid",
    selectedFileId: documentId(params.get("file")),
  }
}

export function documentBrowserHref(state: FileBrowserState, existingQuery = ""): string {
  const params = new URLSearchParams(existingQuery)
  params.set("tab", "documents")
  for (const key of ["folder", "fileSearch", "fileLayout", "file"]) params.delete(key)
  if (state.folderId) params.set("folder", state.folderId)
  if (state.search) params.set("fileSearch", state.search)
  params.set("fileLayout", state.layout)
  if (state.selectedFileId) params.set("file", state.selectedFileId)
  return `/documents?${params}`
}

/** A record can return only to this module's files view, never an arbitrary supplied URL. */
export function documentBrowserReturnHref(value: string | null): string {
  try {
    const url = new URL(value ?? "", "https://lumiere.invalid")
    if (url.origin !== "https://lumiere.invalid" || url.pathname !== "/documents") return documentBrowserHref(documentBrowserState(new URLSearchParams()))
    // Retain module presentation/company context without forwarding arbitrary
    // action or redirect parameters from the untrusted return destination.
    const context = new URLSearchParams()
    for (const key of ["company", "companyId", "filter", "view"]) {
      for (const value of url.searchParams.getAll(key)) context.append(key, value)
    }
    return documentBrowserHref(documentBrowserState(url.searchParams), context.toString())
  } catch {
    return documentBrowserHref(documentBrowserState(new URLSearchParams()))
  }
}

export function documentBrowserRecordHref(id: string, state: FileBrowserState, existingQuery = ""): string {
  const params = new URLSearchParams({ returnTo: documentBrowserHref({ ...state, selectedFileId: id }, existingQuery) })
  return `/documents/${id}?${params}`
}

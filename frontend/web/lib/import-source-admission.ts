export type ImportSourceAdmission = { scopeKey: string; id: string } | null
export type ImportSourceAdmissionEvent =
  | { type: "source"; scopeKey: string; id?: string }
  | { type: "scope"; scopeKey: string }
  | { type: "reset" }

/** Admission describes the selected original source, never the user's derived CSV. */
export function reduceImportSourceAdmission(
  state: ImportSourceAdmission,
  event: ImportSourceAdmissionEvent,
): ImportSourceAdmission {
  if (event.type === "reset") return null
  if (event.type === "scope")
    return state?.scopeKey === event.scopeKey ? state : null
  if (event.id === undefined) return null
  if (!/^[a-f0-9]{32}$/.test(event.id))
    throw new Error("Invalid source admission identity")
  return { scopeKey: event.scopeKey, id: event.id }
}

/** A retained handle cannot escape the actor, tenant and company that selected it. */
export function sourceAdmissionForScope(
  state: ImportSourceAdmission,
  scopeKey: string,
): string | undefined {
  return state?.scopeKey === scopeKey ? state.id : undefined
}

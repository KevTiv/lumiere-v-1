const ACTIVE_COMPANY_STORAGE_KEY = "lumiere:active-company"

interface StoredActiveCompany {
  organizationId: number
  companyId: number
}

function parseStored(raw: string | null): StoredActiveCompany | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredActiveCompany>
    const organizationId = Number(parsed.organizationId)
    const companyId = Number(parsed.companyId)
    if (!Number.isFinite(organizationId) || organizationId <= 0) return null
    if (!Number.isFinite(companyId) || companyId <= 0) return null
    return { organizationId, companyId }
  } catch {
    return null
  }
}

/** Read persisted active company for an organization (browser only). */
export function readStoredActiveCompany(organizationId: number): number | null {
  if (typeof window === "undefined" || organizationId <= 0) return null
  const stored = parseStored(window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY))
  if (!stored || stored.organizationId !== organizationId) return null
  return stored.companyId
}

/** Persist active company selection scoped to organization. */
export function writeStoredActiveCompany(organizationId: number, companyId: number): void {
  if (typeof window === "undefined" || organizationId <= 0 || companyId <= 0) return
  const payload: StoredActiveCompany = { organizationId, companyId }
  window.localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, JSON.stringify(payload))
}

export function clearStoredActiveCompany(): void {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(ACTIVE_COMPANY_STORAGE_KEY)
}

export { ACTIVE_COMPANY_STORAGE_KEY }

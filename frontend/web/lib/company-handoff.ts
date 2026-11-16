/** Resolve an authorized operating-company link and preserve the destination URL. */
export function companyHandoff(href: string, companyIds?: readonly number[]) {
  const url = new URL(href, "https://workspace.invalid")
  const rawCompanyId = url.searchParams.get("companyId")
  if (!rawCompanyId || !/^[1-9]\d*$/.test(rawCompanyId)) return null
  const companyId = Number(rawCompanyId)
  if (!Number.isSafeInteger(companyId) || !companyIds?.includes(companyId)) {
    return null
  }

  url.searchParams.delete("companyId")
  return { companyId, href: url.pathname + url.search + url.hash }
}

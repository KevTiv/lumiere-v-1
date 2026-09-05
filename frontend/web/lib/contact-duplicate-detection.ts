/**
 * CRM contact duplicate detection — mirrors import-duplicate-detection contact keys
 * (email; name + phone) for the merge UI.
 */

import { rowId, rowEmail, rowPhone, rowName } from "@lumiere/erp-shared/contact-matching"

export type ContactDuplicatePair = {
  contactIdA: string
  contactIdB: string
  matchReason: string
  contactA: Record<string, unknown>
  contactB: Record<string, unknown>
}

type QueryRow = Record<string, unknown>

function isActiveContact(row: QueryRow): boolean {
  const deleted = row.deletedAt ?? row.deleted_at
  const mergeTarget = row.mergeTargetId ?? row.merge_target_id
  return deleted == null && mergeTarget == null
}

function contactMatches(a: QueryRow, b: QueryRow): string | null {
  const emailA = rowEmail(a)
  const emailB = rowEmail(b)
  if (emailA && emailB && emailA === emailB) {
    return "email"
  }

  const nameA = rowName(a)
  const nameB = rowName(b)
  const phoneA = rowPhone(a)
  const phoneB = rowPhone(b)
  if (nameA && phoneA && nameA === nameB && phoneA === phoneB) {
    return "name + phone"
  }

  return null
}

function canonicalPair(idA: string, idB: string): [string, string] {
  return idA < idB ? [idA, idB] : [idB, idA]
}

export function detectContactDuplicatePairs(
  contacts: QueryRow[],
  companyId?: string | bigint,
): ContactDuplicatePair[] {
  const companyKey =
    companyId != null && companyId !== "" ? String(companyId) : null

  const active = contacts.filter((row) => {
    if (!isActiveContact(row)) return false
    if (!companyKey) return true
    const rowCompany = String(row.companyId ?? row.company_id ?? "")
    return rowCompany === companyKey
  })

  const seen = new Set<string>()
  const pairs: ContactDuplicatePair[] = []

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!
      const b = active[j]!
      const reason = contactMatches(a, b)
      if (!reason) continue

      const idA = rowId(a)
      const idB = rowId(b)
      const [canonA, canonB] = canonicalPair(idA, idB)
      const key = `${canonA}:${canonB}:${reason}`
      if (seen.has(key)) continue
      seen.add(key)

      const contactA = idA === canonA ? a : b
      const contactB = idB === canonB ? b : a
      pairs.push({
        contactIdA: canonA,
        contactIdB: canonB,
        matchReason: reason,
        contactA,
        contactB,
      })
    }
  }

  return pairs
}

export function contactRowLabel(row: QueryRow): string {
  const name = String(row.displayName ?? row.display_name ?? row.name ?? "").trim()
  const email = rowEmail(row)
  if (name && email) return `${name} (${email})`
  return name || email || `Contact #${rowId(row)}`
}

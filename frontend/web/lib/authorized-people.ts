/** Only the existing protected settings directory may supply selectable people. */
export interface DirectoryPerson {
  identity?: unknown
  name?: unknown
  email?: unknown
  isActive?: unknown
  is_active?: unknown
  membership?: {
    organizationId?: unknown
    organization_id?: unknown
    userIdentity?: unknown
    user_identity?: unknown
    isActive?: unknown
    is_active?: unknown
  }
}

export interface PersonOption { value: string; label: string }

export function personIdentity(value: unknown): string | null {
  if (typeof value !== "string") return null
  const identity = value.trim().replace(/^0x/i, "").toLowerCase()
  return /^[0-9a-f]{64}$/.test(identity) ? identity : null
}

/** Missing/redacted membership and names do not become presumed eligibility. */
export function authorizedPeopleOptions(rows: readonly DirectoryPerson[], organizationId: number): PersonOption[] {
  const people = new Map<string, PersonOption>()
  const ambiguous = new Set<string>()
  for (const row of rows) {
    const identity = personIdentity(row.identity)
    const membership = row.membership
    if (!identity || !membership || String(membership.organizationId ?? membership.organization_id) !== String(organizationId)
      || personIdentity(membership.userIdentity ?? membership.user_identity) !== identity
      || (membership.isActive ?? membership.is_active) !== true
      || (row.isActive ?? row.is_active) !== true) continue
    const name = typeof row.name === "string" ? row.name.trim() : ""
    const email = typeof row.email === "string" ? row.email.trim() : ""
    if (!name && !email) continue
    if (people.has(identity)) { ambiguous.add(identity); continue }
    people.set(identity, { value: identity, label: name && email ? `${name} · ${email}` : name || email })
  }
  const options = [...people.values()].filter((person) => !ambiguous.has(person.value))
  const labelCounts = new Map<string, number>()
  for (const person of options) labelCounts.set(person.label, (labelCounts.get(person.label) ?? 0) + 1)
  return options.map((person) => labelCounts.get(person.label)! > 1 ? { ...person, label: `${person.label} (…${person.value.slice(-8)})` } : person)
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** Revalidate submitted values against the current authorized directory, never a typed identity. */
export function selectedPerson(value: unknown, options: readonly PersonOption[]): string | null {
  const identity = personIdentity(value)
  return identity && options.some((option) => option.value === identity) ? identity : null
}

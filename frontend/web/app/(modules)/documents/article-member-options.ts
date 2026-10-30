import { personIdentity, type PersonOption } from "../../../lib/authorized-people"

export interface ArticleMemberProjection {
  id?: unknown
  organizationId?: unknown
  organization_id?: unknown
  memberIds?: unknown
  member_ids?: unknown
}

export type ArticleMemberOptions = { status: "ready"; options: PersonOption[] } | { status: "unavailable"; options: [] }

/** Removal is based on the article's exposed membership, not current workforce eligibility. */
export function articleMemberOptions(article: ArticleMemberProjection, organizationId: number, people: readonly PersonOption[] = []): ArticleMemberOptions {
  if (String(article.organizationId ?? article.organization_id) !== String(organizationId)) return { status: "unavailable", options: [] }
  const members = article.memberIds ?? article.member_ids
  if (!Array.isArray(members)) return { status: "unavailable", options: [] }
  const identities = members.map(personIdentity)
  if (identities.some((identity) => identity == null) || new Set(identities).size !== identities.length) return { status: "unavailable", options: [] }
  const names = new Map(people.map((person) => [person.value, person.label]))
  return { status: "ready", options: identities.filter((identity): identity is string => identity != null).map((identity) => ({
    value: identity,
    // The exact authorized identity remains visible for departed or same-named members.
    label: `${names.get(identity) ?? "Member"} · ${identity}`,
  })).sort((a, b) => a.label.localeCompare(b.label)) }
}

/** Re-read proof must identify the same article and still list this exact member. */
export function currentArticleMember(rows: readonly ArticleMemberProjection[], articleId: string, organizationId: number, selected: unknown): string | null {
  const identity = personIdentity(selected)
  const matches = rows.filter((row) => String(row.id) === articleId && String(row.organizationId ?? row.organization_id) === String(organizationId))
  if (!identity || matches.length !== 1) return null
  const membership = articleMemberOptions(matches[0], organizationId)
  return membership.status === "ready" && membership.options.some((member) => member.value === identity) ? identity : null
}

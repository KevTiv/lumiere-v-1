/**
 * The one id a command added to an owned relation, from a snapshot taken immediately before
 * dispatch. Resolves only when every prior id is still present and exactly one new id appeared;
 * a missing relation, a lost id, or zero/several (or a duplicated) new ids are unresolved. Never
 * substitute the newest, last or highest id.
 */
export function singleAddedId(
  before: readonly string[],
  after: readonly string[] | undefined,
): string | undefined {
  if (!after) return undefined
  const present = new Set(after)
  if (before.some((id) => !present.has(id))) return undefined
  const prior = new Set(before)
  const added = after.filter((id) => !prior.has(id))
  return added.length === 1 ? added[0] : undefined
}

/** Exact category identity is retained across an uncertain rename reply. */
export interface CategoryName { id: string; name: string }
export async function renameCategory(
  id: string, previousName: string, name: string,
  read: () => Promise<readonly CategoryName[]>,
  update: () => Promise<unknown>,
): Promise<{ id: string; name: string; outcome: 'applied' | 'alreadyApplied' }> {
  if (!/^[1-9]\d*$/.test(id) || !name.trim()) throw new Error('Enter a category name.')
  const exact = async () => {
    const matches = (await read()).filter(row => row.id === id)
    if (matches.length !== 1) throw new Error('The category is unavailable or its identity is not unique.')
    return matches[0]!
  }
  const before = await exact()
  if (before.name === name.trim()) return { id, name: before.name, outcome: 'alreadyApplied' }
  if (before.name !== previousName) throw new Error('The category name changed. Reopen it before saving.')
  let dispatchError: unknown
  try { await update() } catch (error) { dispatchError = error }
  const after = await exact()
  if (after.name !== name.trim()) {
    if (dispatchError) throw dispatchError
    throw new Error('The saved category name could not be confirmed. Your entries are retained.')
  }
  return { id, name: after.name, outcome: 'applied' }
}

import { parseStrictU64 } from "@lumiere/erp-shared/u64"

export const noContactParent = "none"

/** Undefined means there is no explicit change. Null means the user chose to clear the parent. */
export function contactParentChange(currentParent: bigint | null, selection?: string): bigint | null | undefined {
  if (selection === noContactParent) return currentParent === null ? undefined : null
  const chosen = parseStrictU64(selection)
  return chosen && chosen !== currentParent ? chosen : undefined
}

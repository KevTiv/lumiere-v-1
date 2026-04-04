/**
 * Radix Select reserves empty string for "no selection" / placeholder.
 * SelectItem must not use value="". These helpers map option index ↔ sentinel for empty values.
 */
export const RADIX_SELECT_EMPTY_PREFIX = "__lumiere_empty__:"

export type SelectOptionLike = { value: string; disabled?: boolean }

export function radixSelectItemValue(option: SelectOptionLike, index: number): string {
  if (option.value !== "") return option.value
  return `${RADIX_SELECT_EMPTY_PREFIX}${index}`
}

/** Maps stored form value to the string Radix Select should receive. */
export function radixSelectControlledValue(
  stored: string | undefined,
  options: readonly SelectOptionLike[] | undefined,
): string {
  if (stored == null || stored !== "") {
    return stored ?? ""
  }
  const selectableIdx = options?.findIndex((o) => o.value === "" && !o.disabled) ?? -1
  if (selectableIdx >= 0) {
    return `${RADIX_SELECT_EMPTY_PREFIX}${selectableIdx}`
  }
  return ""
}

export function storedValueFromRadixSelect(radixValue: string): string {
  if (radixValue.startsWith(RADIX_SELECT_EMPTY_PREFIX)) return ""
  return radixValue
}

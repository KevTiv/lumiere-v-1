/**
 * Maps SpacetimeDB TypeScript row field names (camelCase) to SQL column names (snake_case).
 * Use with generated `* = __Infer<typeof X>` types so registry keys stay aligned with codegen.
 */

export function camelToSnakeIdentifier(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

/**
 * @param keys - Field names from a generated row type, e.g. `keyof Product`
 * @returns SQL identifiers for `SELECT` lists
 */
export function sqlFieldNames<T extends object>(keys: readonly (keyof T)[]): string[] {
  return keys.map((k) => camelToSnakeIdentifier(String(k)))
}

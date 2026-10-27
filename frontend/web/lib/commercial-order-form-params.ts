/** Custom order fields need an atomic record/EAV save; ordinary metadata is already stored by create. */
export function orderNeedsCustomFieldSave(metadata: unknown): boolean {
  let value = metadata
  if (typeof value === "string") {
    try { value = JSON.parse(value) as unknown }
    catch { return false }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).some((key) => key.startsWith("custom:"))
}

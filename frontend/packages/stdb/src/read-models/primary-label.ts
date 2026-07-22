/** Shared fallback behavior for simple read-model picker labels. */
export function primaryLabel(candidates: unknown[], id: unknown): string {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;

    const label = candidate.trim();
    if (label.length > 0) return label;
  }

  if (typeof id === "number" || typeof id === "bigint") return `#${id}`;
  if (typeof id === "string" && id.trim() !== "") return `#${id.trim()}`;
  return "";
}

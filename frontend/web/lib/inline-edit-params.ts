/**
 * Pure helpers behind the list views' in-place edits. Each builds the one-field patch a module's
 * partial update command accepts (omitted fields stay as they are on the server) or throws a
 * message the cell shows as a toast.
 */

type Row = Record<string, unknown>

/** Tag of a SpacetimeDB enum cell: `{ tag: "Draft" }`, or the plain string a read model may carry. */
export function inlineRowTag(value: unknown): string {
  if (value && typeof value === "object" && "tag" in value) return String((value as { tag?: unknown }).tag ?? "")
  return value == null ? "" : String(value)
}

/** Trimmed text that must not be empty. */
export function requiredInlineText(value: string | number, message: string): string {
  const text = String(value).trim()
  if (!text) throw new Error(message)
  return text
}

/** A finite number that must be at least `min`. */
export function inlineNumberAtLeast(value: string | number, min: number, message: string): number {
  const n = typeof value === "number" ? value : Number(String(value).trim())
  if (!Number.isFinite(n) || n < min) throw new Error(message)
  return n
}

/** A finite number that must be above `min`. */
export function inlineNumberAbove(value: string | number, min: number, message: string): number {
  const n = typeof value === "number" ? value : Number(String(value).trim())
  if (!Number.isFinite(n) || n <= min) throw new Error(message)
  return n
}

/** Trimmed email text; only checks it looks like an address, the server owns the rest. */
export function requiredInlineEmail(value: string | number, message: string): string {
  const text = requiredInlineText(value, message)
  if (!/^[^\s@]+@[^\s@]+$/.test(text)) throw new Error(message)
  return text
}

export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const
export type TicketPriorityValue = (typeof TICKET_PRIORITIES)[number]

/** `UpdateTicketParams` patch carrying only the priority; throws for a value the backend enum lacks. */
export function ticketPriorityPatch(value: string | number): { priority: { tag: "Low" | "Normal" | "High" | "Urgent" } } {
  const key = String(value).toLowerCase() as TicketPriorityValue
  switch (key) {
    case "low":
      return { priority: { tag: "Low" } }
    case "normal":
      return { priority: { tag: "Normal" } }
    case "high":
      return { priority: { tag: "High" } }
    case "urgent":
      return { priority: { tag: "Urgent" } }
    default:
      throw new Error(`Unknown priority "${String(value)}"`)
  }
}

/** The backend only edits Draft expenses. */
export function isDraftExpense(row: Row): boolean {
  return inlineRowTag(row.state) === "Draft"
}

/**
 * Quantity is only a free input on a standard line (mileage and per diem derive it from distance /
 * days), so the backend rejects it elsewhere.
 */
export function isDraftStandardExpense(row: Row): boolean {
  const kind = inlineRowTag(row.lineKind ?? row.line_kind)
  return isDraftExpense(row) && (kind === "" || kind === "Standard")
}

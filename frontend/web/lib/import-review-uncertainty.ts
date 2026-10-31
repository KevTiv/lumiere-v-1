import type {
  ReviewField,
  ReviewHistory,
  ReviewRow,
} from "./import-review-model"
import { z } from "zod"

export type ReviewIssueGroup = {
  key: string
  label: string
  fieldKey?: string
  itemIds: string[]
}
export type ReviewDecision = {
  itemId: string
  expectedRevision: number
  values: Record<string, string | null>
  confirmedFields: string[]
  state: ReviewRow["state"]
  reason: string
}

const reviewReceipt = z.object({
  replayed: z.boolean(),
  item: z.object({
    id: z.string(),
    revision: z.number().int().positive(),
    state: z.enum(["needs_review", "confirmed", "excluded"]),
    values: z.record(z.string().nullable()),
    confirmedFields: z.array(z.string()),
    reason: z.string(),
  }),
})

/** A successful HTTP status alone is not evidence that the reviewed save landed. */
export function verifyReviewReceipt(value: unknown, decision: ReviewDecision) {
  const result = reviewReceipt.safeParse(value)
  if (!result.success)
    throw new Error(
      "The saved review receipt could not be verified. Retry the same submission.",
    )
  const { item, replayed } = result.data
  if (
    item.id !== decision.itemId ||
    item.revision < decision.expectedRevision + 1 ||
    (!replayed && item.revision !== decision.expectedRevision + 1)
  )
    throw new Error(
      "The saved review receipt does not match this submission. Retry the same submission.",
    )
  if (item.revision === decision.expectedRevision + 1) {
    const ordered = (values: ReviewDecision["values"]) =>
      JSON.stringify(
        Object.entries(values).sort(([a], [b]) => a.localeCompare(b)),
      )
    if (
      item.state !== decision.state ||
      item.reason !== decision.reason ||
      ordered(item.values) !== ordered(decision.values) ||
      JSON.stringify([...item.confirmedFields].sort()) !==
        JSON.stringify([...decision.confirmedFields].sort())
    )
      throw new Error(
        "The saved review values do not match this submission. Retry the same submission.",
      )
  }
}

export function verifyBulkReviewReceipt(
  value: unknown,
  decisions: ReviewDecision[],
) {
  const result = z.object({ results: z.array(reviewReceipt) }).safeParse(value)
  if (!result.success || result.data.results.length !== decisions.length)
    throw new Error(
      "The complete bulk review receipt could not be verified. Retry the same submission.",
    )
  const receipts = new Map(
    result.data.results.map((receipt) => [receipt.item.id, receipt]),
  )
  if (receipts.size !== decisions.length)
    throw new Error(
      "The bulk review receipt contains repeated rows. Retry the same submission.",
    )
  for (const decision of decisions)
    verifyReviewReceipt(receipts.get(decision.itemId), decision)
}
export type BulkReviewPreview = {
  field: ReviewField
  decisions: ReviewDecision[]
  rows: { item: ReviewRow; before: string | null; after: string | null }[]
  skipped: { item: ReviewRow; reason: string }[]
}

export function confirmedReviewFields(item: ReviewRow): string[] {
  return (
    item.confirmedFields ??
    (item.state === "confirmed"
      ? Object.keys(item.values).filter((key) => !!item.values[key]?.trim())
      : [])
  )
}

/** Group by the same missing fact or unconfirmed proposal, never by row position. */
export function reviewIssueGroups(items: ReviewRow[]): ReviewIssueGroup[] {
  const groups = new Map<string, ReviewIssueGroup>()
  const add = (
    key: string,
    label: string,
    item: ReviewRow,
    fieldKey?: string,
  ) => {
    const group = groups.get(key) ?? { key, label, fieldKey, itemIds: [] }
    group.itemIds.push(item.id)
    groups.set(key, group)
  }
  for (const item of items) {
    if (item.state !== "needs_review") continue
    const confirmed = new Set(confirmedReviewFields(item))
    let grouped = false
    for (const field of item.source.fields) {
      if (field.required && !item.values[field.key]?.trim()) {
        add(`missing:${field.key}`, `Unknown: ${field.label}`, item, field.key)
        grouped = true
      } else if (
        item.values[field.key]?.trim() &&
        !confirmed.has(field.key) &&
        item.values[field.key] !== field.sourceValue
      ) {
        add(`proposal:${field.key}`, `Confirm: ${field.label}`, item, field.key)
        grouped = true
      }
    }
    if (!grouped) add(`issue:${item.source.issue}`, item.source.issue, item)
  }
  return [...groups.values()].sort(
    (a, b) => b.itemIds.length - a.itemIds.length || a.key.localeCompare(b.key),
  )
}

export function reviewValueError(
  field: ReviewField,
  value: string | null,
): string | null {
  if (value == null || value === "") return null
  if (value.length > 2000) return "A correction value is too long."
  if (field.kind === "decimal" && !/^-?\d{1,12}(?:\.\d{1,6})?$/.test(value))
    return `${field.label} needs an exact decimal value.`
  if (field.kind === "choice" && !field.options?.includes(value))
    return `${field.label} needs one of its listed choices.`
  if (
    field.kind === "date" &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)
  )
    return `${field.label} needs a valid date (YYYY-MM-DD).`
  return null
}

/** Only the named field changes. A unit choice cannot convert numbers implicitly. */
export function changeReviewValue(
  decision: ReviewDecision,
  key: string,
  value: string,
): ReviewDecision {
  return {
    ...decision,
    values: { ...decision.values, [key]: value === "" ? null : value },
    confirmedFields: decision.confirmedFields.filter((field) => field !== key),
    state: decision.state === "confirmed" ? "needs_review" : decision.state,
  }
}

export function reviewDecision(item: ReviewRow): ReviewDecision {
  return {
    itemId: item.id,
    expectedRevision: item.revision,
    values: { ...item.values },
    confirmedFields: confirmedReviewFields(item),
    state: item.state,
    reason: item.reason ?? "",
  }
}

export function buildBulkReviewPreview(args: {
  items: ReviewRow[]
  selectedIds: Set<string>
  fieldKey: string
  value: string
  confirm: boolean
  replaceConfirmed: boolean
  reason: string
}): BulkReviewPreview {
  if (args.reason.trim().length < 3 || args.reason.length > 2000)
    throw new Error("Enter a reason for this bulk correction.")
  const selected = args.items.filter((item) => args.selectedIds.has(item.id))
  if (!selected.length) throw new Error("Select at least one row to preview.")
  const field = selected
    .flatMap((item) => item.source.fields)
    .find((field) => field.key === args.fieldKey)
  if (!field) throw new Error("Choose a field shared by the selected rows.")
  const value = args.value === "" ? null : args.value
  if (args.confirm && !value?.trim())
    throw new Error("An unknown value cannot be confirmed.")
  const result: BulkReviewPreview = {
    field,
    decisions: [],
    rows: [],
    skipped: [],
  }
  for (const item of selected) {
    const rowField = item.source.fields.find(
      (candidate) => candidate.key === args.fieldKey,
    )
    const skip =
      item.state === "excluded"
        ? "Excluded row"
        : !rowField
          ? "Field is not present"
          : confirmedReviewFields(item).includes(args.fieldKey) &&
              !args.replaceConfirmed
            ? "Previously confirmed value retained"
            : reviewValueError(rowField, value)
    if (skip) {
      result.skipped.push({ item, reason: skip })
      continue
    }
    const decision = changeReviewValue(
      reviewDecision(item),
      args.fieldKey,
      args.value,
    )
    decision.reason = args.reason
    // A bulk field correction does not assert completeness of a whole row.
    decision.state = "needs_review"
    if (args.confirm) decision.confirmedFields.push(args.fieldKey)
    result.decisions.push(decision)
    result.rows.push({
      item,
      before: item.values[args.fieldKey] ?? null,
      after: value,
    })
  }
  if (!result.decisions.length)
    throw new Error(
      "No rows can receive this correction. Review the row exceptions.",
    )
  return result
}

/** Undo is a new revision; it cannot erase the original source or audit trail. */
export function undoReviewDecision(
  item: ReviewRow,
  entry: ReviewHistory,
): ReviewDecision {
  if (
    entry.itemId !== item.id ||
    entry.revision !== item.revision ||
    !entry.previousValues ||
    !entry.previousState
  )
    throw new Error(
      "Reload the current row before undoing its latest decision.",
    )
  return {
    itemId: item.id,
    expectedRevision: item.revision,
    values: { ...entry.previousValues },
    confirmedFields: entry.previousConfirmedFields ?? [],
    state: entry.previousState,
    reason: `Undo revision ${entry.revision}: ${entry.reason}`.slice(0, 2000),
  }
}

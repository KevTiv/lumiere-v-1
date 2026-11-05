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

export type BulkConfirmationMode = "complete_rows" | "confirm_fields"
export type BulkConfirmationPreview = {
  mode: BulkConfirmationMode
  decisions: ReviewDecision[]
  rows: {
    item: ReviewRow
    beforeState: ReviewRow["state"]
    afterState: ReviewRow["state"]
    fields: {
      field: ReviewField
      value: string | null
      sourceValue: string | null
      beforeConfirmed: boolean
      afterConfirmed: boolean
    }[]
  }[]
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
  if (new TextEncoder().encode(value).length > 2000)
    return "A correction value is too long."
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

const exactReviewDecimal = (value: string | null | undefined): bigint | null => {
  if (!value || !/^-?\d{1,12}(?:\.\d{1,6})?$/.test(value)) return null
  const negative = value.startsWith("-")
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".")
  const result = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"))
  return negative ? -result : result
}

/** Confirm each row's own values. Source cells and proposals never fill unknowns. */
export function buildBulkConfirmationPreview(args: {
  items: ReviewRow[]
  selectedIds: Set<string>
  mode: BulkConfirmationMode
  fieldKeys?: string[]
  reason: string
}): BulkConfirmationPreview {
  if (
    args.reason.trim().length < 3 ||
    new TextEncoder().encode(args.reason).length > 2000
  )
    throw new Error("Enter supporting evidence for these confirmations.")
  if (!args.selectedIds.size)
    throw new Error("Select at least one row to preview.")
  if (args.selectedIds.size > 1000)
    throw new Error("Select no more than 1,000 rows for one save.")
  const selected = args.items.filter((item) => args.selectedIds.has(item.id))
  if (
    selected.length !== args.selectedIds.size ||
    new Set(selected.map((item) => item.id)).size !== selected.length
  )
    throw new Error("Reload the selected rows before preparing a confirmation.")
  const fieldKeys = [...new Set(args.fieldKeys ?? [])]
  if (args.mode === "confirm_fields" && !fieldKeys.length)
    throw new Error("Select at least one field to confirm.")
  const result: BulkConfirmationPreview = {
    mode: args.mode,
    decisions: [],
    rows: [],
    skipped: [],
  }
  for (const item of selected) {
    if (item.state !== "needs_review") {
      result.skipped.push({
        item,
        reason: item.state === "excluded" ? "Excluded row" : "Row already confirmed",
      })
      continue
    }
    const fields =
      args.mode === "complete_rows"
        ? item.source.fields
        : fieldKeys.flatMap((key) =>
            item.source.fields.filter((field) => field.key === key),
          )
    let error: string | null =
      args.mode === "confirm_fields" && fields.length !== fieldKeys.length
        ? "Selected field is not present"
        : null
    // The server validates all current values, including on partial saves.
    for (const field of item.source.fields) {
      error ??= reviewValueError(field, item.values[field.key] ?? null)
      if (
        args.mode === "complete_rows" &&
        field.required &&
        !item.values[field.key]?.trim()
      )
        error ??= `${field.label} is required before confirmation.`
    }
    if (args.mode === "confirm_fields") {
      for (const field of fields)
        if (!item.values[field.key]?.trim())
          error ??= `${field.label} is unknown and remains unconfirmed.`
    } else {
      if (!fields.some((field) => item.values[field.key]?.trim()))
        error ??= "There are no known values to confirm."
      const quantity = exactReviewDecimal(item.values.quantity)
      const price = exactReviewDecimal(item.values.unit_price)
      const amount = exactReviewDecimal(item.values.amount)
      if (
        quantity !== null &&
        price !== null &&
        amount !== null &&
        quantity * price !== amount * 1_000_000n
      )
        error ??= "Quantity multiplied by unit price must equal the recorded amount."
    }
    if (error) {
      result.skipped.push({ item, reason: error })
      continue
    }
    const beforeConfirmed = new Set(confirmedReviewFields(item))
    const afterConfirmed = new Set(beforeConfirmed)
    for (const field of fields)
      if (item.values[field.key]?.trim()) afterConfirmed.add(field.key)
    if (
      args.mode === "confirm_fields" &&
      afterConfirmed.size === beforeConfirmed.size
    ) {
      result.skipped.push({ item, reason: "Selected fields are already confirmed" })
      continue
    }
    const decision = reviewDecision(item)
    decision.reason = args.reason
    decision.confirmedFields = [...afterConfirmed]
    decision.state = args.mode === "complete_rows" ? "confirmed" : "needs_review"
    result.decisions.push(decision)
    result.rows.push({
      item,
      beforeState: item.state,
      afterState: decision.state,
      fields: fields.map((field) => ({
        field,
        value: item.values[field.key] ?? null,
        sourceValue: field.sourceValue,
        beforeConfirmed: beforeConfirmed.has(field.key),
        afterConfirmed: afterConfirmed.has(field.key),
      })),
    })
  }
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

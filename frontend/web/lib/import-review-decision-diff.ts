import { isHistoryDate } from "@lumiere/erp-shared/history-period"
import type { useTranslation } from "@lumiere/i18n"
import type {
  HistoryDiffValue,
  HistoryFieldDiffRow,
} from "@lumiere/ui/entity-views/history-field-diff"
import { shiftHistoryDate } from "./history-data"
import type { ReviewBusinessDate, ReviewField, ReviewRow } from "./import-review-model"

type Translate = ReturnType<typeof useTranslation>["t"]

type ReviewSnapshot = {
  values?: ReviewRow["values"] | null
  confirmedFields?: string[] | null
  state?: ReviewRow["state"] | null
}

function capturedValue(
  values: ReviewSnapshot["values"],
  key: string,
): HistoryDiffValue {
  if (!values) return { kind: "unavailable" }
  return Object.hasOwn(values, key)
    ? { kind: "value", value: values[key]! }
    : { kind: "absent" }
}

export function reviewDecisionDiff(
  before: ReviewSnapshot,
  after: ReviewSnapshot,
  fields: readonly ReviewField[],
  t: Translate,
): HistoryFieldDiffRow[] {
  const rows: HistoryFieldDiffRow[] = []
  if (before.state !== after.state) {
    const stateValue = (state: ReviewSnapshot["state"]): HistoryDiffValue =>
      state
        ? { kind: "value", value: t(`settings.importReview.filter.${state}`) }
        : { kind: "unavailable" }
    rows.push({
      id: "state",
      label: t("settings.importReview.grouped.rowStatus"),
      before: stateValue(before.state),
      after: stateValue(after.state),
    })
  }

  const fieldLabels = new Map(fields.map((field) => [field.key, field.label]))
  const beforeConfirmed = before.confirmedFields && new Set(before.confirmedFields)
  const afterConfirmed = after.confirmedFields && new Set(after.confirmedFields)
  const affectedKeys = new Set([
    ...Object.keys(before.values ?? {}),
    ...Object.keys(after.values ?? {}),
    ...(beforeConfirmed ?? []),
    ...(afterConfirmed ?? []),
  ])
  const confirmationValue = (confirmed: boolean | null | undefined): HistoryDiffValue =>
    typeof confirmed === "boolean"
      ? {
          kind: "value",
          value: t(
            confirmed
              ? "settings.importReview.grouped.valueIsConfirmed"
              : "settings.importReview.grouped.valueIsUnconfirmed",
          ),
        }
      : { kind: "unavailable" }

  for (const key of affectedKeys) {
    const label = fieldLabels.get(key) ?? key
    const oldValue = capturedValue(before.values, key)
    const newValue = capturedValue(after.values, key)
    const oldConfirmation = beforeConfirmed?.has(key)
    const newConfirmation = afterConfirmed?.has(key)
    const confirmationChanged =
      oldConfirmation !== newConfirmation && (oldConfirmation || newConfirmation)
    if (
      confirmationChanged ||
      oldValue.kind !== newValue.kind ||
      (oldValue.kind === "value" &&
        newValue.kind === "value" &&
        oldValue.value !== newValue.value)
    ) {
      rows.push({ id: `value:${key}`, label, before: oldValue, after: newValue })
    }
    if (confirmationChanged) {
      rows.push({
        id: `confirmation:${key}`,
        label: t("settings.importReview.grouped.fieldConfirmation", { field: label }),
        before: confirmationValue(oldConfirmation),
        after: confirmationValue(newConfirmation),
      })
    }
  }
  return rows
}

export function reviewSourceLabel(item: ReviewRow, t: Translate): string {
  const { file, row, rowBasis } = item.source.source
  const coordinate = t(
    rowBasis === "import_row"
      ? "settings.importReview.importRow"
      : "settings.importReview.sourceLine",
    { row },
  )
  return `${file} · ${coordinate}`
}

export function reviewSourceDate(date: ReviewBusinessDate, t: Translate): string {
  if (isHistoryDate(date.from) && isHistoryDate(date.toExclusive) && date.from < date.toExclusive) {
    if (date.precision === "day") return date.from
    return t("settings.importReview.decisionSummary.periodRange", {
      from: date.from,
      through: shiftHistoryDate(date.toExclusive, -1),
    })
  }
  return t(date.precision === "invalid" ? "availableHistory.invalid" : "availableHistory.undated")
}

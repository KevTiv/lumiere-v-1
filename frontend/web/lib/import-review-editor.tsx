"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { interpretSourceCells } from "./source-observation"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  reviewSaleReconciliation,
  type ReviewField,
  type ReviewRow,
} from "./import-review-model"
import {
  changeReviewValue,
  reviewDecision,
  reviewValueError,
  type ReviewDecision,
} from "./import-review-uncertainty"
import {
  productReviewReferenceOptions,
  productReviewStoredUnit,
  type ProductReviewReferences,
} from "./import-review-product-references"

export class ReviewRequestError extends Error {
  constructor(
    message: string,
    readonly definitive: boolean,
  ) {
    super(message)
  }
}

export function ReviewValueInput({
  field,
  value,
  onChange,
  disabled,
  label,
  product,
  organizationId,
  references,
  item,
}: {
  field: ReviewField
  value: string
  onChange: (value: string) => void
  disabled: boolean
  label: string
  product: boolean
  organizationId: number
  references?: ProductReviewReferences
  item?: ReviewRow
}) {
  const { t } = useTranslation()
  const reference =
    product && ["category_id", "uom_id", "uom_po_id"].includes(field.key)
  const options = reference
    ? productReviewReferenceOptions(
        (field.key === "category_id"
          ? references?.categories
          : references?.uoms) ?? [],
        organizationId,
        field.key === "category_id"
          ? undefined
          : productReviewStoredUnit(item ?? null),
      )
    : field.kind === "choice"
      ? (field.options ?? []).map((value) => ({ value, label: value }))
      : null
  if (options)
    return (
      <Select
        value={value || "__unknown__"}
        onValueChange={(value) =>
          onChange(value === "__unknown__" ? "" : value)
        }
        disabled={disabled || (reference && !references)}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__unknown__">
            {t("settings.importReview.unknown")}
          </SelectItem>
          {value && !options.some((option) => option.value === value) ? (
            <SelectItem value={value} disabled>
              {t("settings.importReview.grouped.unavailableValue", { value })}
            </SelectItem>
          ) : null}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  return (
    <Input
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      inputMode={field.kind === "decimal" ? "decimal" : undefined}
      placeholder={t("settings.importReview.unknown")}
    />
  )
}

export function ImportReviewEditor({
  item,
  product,
  organizationId,
  references,
  referenceError,
  onSave,
  onClose,
  onNext,
  hasNext,
  onLockChange,
}: {
  item: ReviewRow
  product: boolean
  organizationId: number
  references?: ProductReviewReferences
  referenceError?: string
  onSave: (
    decision: ReviewDecision,
    requestKey: string,
    next: boolean,
  ) => Promise<void>
  onClose: () => void
  onNext: () => void
  hasNext: boolean
  onLockChange: (locked: boolean) => void
}) {
  const { t } = useTranslation()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [])
  const [decision, setDecision] = useState(() => reviewDecision(item))
  const reconciliation = reviewSaleReconciliation(decision.values)
  const saleMismatch =
    reconciliation?.difference != null && reconciliation.difference !== "0"
  const interpretations = item.source.fields.flatMap((field) =>
    field.sourceValue ? interpretSourceCells(field.sourceValue) : [],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uncertain, setUncertain] = useState(false)
  useEffect(() => {
    onLockChange(busy || uncertain)
    return () => onLockChange(false)
  }, [busy, uncertain, onLockChange])
  const pending = useRef<{
    decision: ReviewDecision
    requestKey: string
    next: boolean
  } | null>(null)
  const dirty =
    JSON.stringify(decision) !== JSON.stringify(reviewDecision(item))
  const submit = async (next: boolean) => {
    setError(null)
    if (!pending.current) {
      const invalid = item.source.fields
        .map((field) =>
          reviewValueError(field, decision.values[field.key] ?? null),
        )
        .find(Boolean)
      if (invalid) {
        setError(invalid)
        return
      }
      if (
        decision.state === "confirmed" &&
        "sale_amount" in decision.values &&
        saleMismatch
      ) {
        setError(
          t("settings.importReview.saleMismatch", {
            defaultValue:
              "Resolve the difference between the recorded and calculated sale amount before confirming the row.",
          }),
        )
        return
      }
      const confirmedFields =
        decision.state === "confirmed"
          ? item.source.fields
              .filter((field) => decision.values[field.key]?.trim())
              .map((field) => field.key)
          : decision.confirmedFields
      pending.current = {
        decision: { ...decision, confirmedFields },
        requestKey: crypto.randomUUID(),
        next,
      }
    }
    setBusy(true)
    try {
      await onSave(
        pending.current.decision,
        pending.current.requestKey,
        pending.current.next,
      )
      pending.current = null
      setUncertain(false)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      const unknown =
        !(failure instanceof ReviewRequestError) || !failure.definitive
      setUncertain(unknown)
      if (!unknown) pending.current = null
    } finally {
      setBusy(false)
    }
  }
  const label = (field: ReviewField) =>
    product && field.key === "category_id"
      ? t("settings.importReview.category")
      : product && field.key === "uom_id"
        ? t("settings.importReview.productUnit")
        : product && field.key === "uom_po_id"
          ? t("settings.importReview.purchaseUnit")
          : product && field.key === "stored_unit"
            ? t("settings.importReview.priceUnit")
            : field.label
  return (
    <section
      aria-label={t("settings.importReview.grouped.editor", {
        name: item.source.label,
      })}
      className="@container/editor min-w-0 rounded-lg border bg-background p-3 sm:p-4"
    >
      <div className="mb-3 flex flex-wrap justify-between gap-2">
        <div className="min-w-0">
          <h4
            ref={heading}
            tabIndex={-1}
            className="scroll-mt-4 break-words font-semibold"
          >
            {item.source.label}
          </h4>
          <p className="text-sm text-muted-foreground">{item.source.issue}</p>
          {interpretations.length ? (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {t("settings.importReview.sourceMeaning", {
                  defaultValue: "Interpret source notes",
                })}
              </summary>
              <ul className="mt-2 space-y-2 text-sm">
                {interpretations.map((hint, index) => (
                  <li key={`${hint.key}:${index}`}>
                    <span className="font-medium">{hint.original}</span>
                    {": "}
                    {t(`settings.importReview.meaning.${hint.key}`, {
                      defaultValue: hint.message,
                    })}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || uncertain}
          onClick={onClose}
        >
          {t("common.cancel")}
        </Button>
      </div>
      <p className="mb-3 break-words text-xs text-muted-foreground">
        {item.source.source.file} ·{" "}
        {item.source.source.sheet ? <>{item.source.source.sheet} · </> : null}
        {t(
          item.source.source.rowBasis === "import_row"
            ? "settings.importReview.importRow"
            : "settings.importReview.sourceLine",
          { row: item.source.source.row },
        )}{" "}
        · SHA-256 {item.source.source.sha256}
      </p>
      <p className="mb-3 text-sm text-muted-foreground">
        {t("settings.importReview.grouped.independentFields")}
      </p>
      <div className="grid gap-3">
        {item.source.fields.map((field) => (
          <fieldset
            key={field.key}
            className="min-w-0 rounded-md border px-3 pb-3"
          >
            <legend className="px-1 text-sm font-medium">
              {label(field)}
              {field.required ? " *" : ""}
            </legend>
            <div className="grid gap-3 @xl/editor:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <div className="min-w-0 whitespace-pre-wrap break-words text-sm">
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {t("settings.importReview.grouped.original")}
                </p>
                <p data-testid="review-original-value">
                  {field.sourceValue === ""
                    ? t("settings.importReview.blankCell", {
                        defaultValue: "Blank source cell",
                      })
                    : (field.sourceValue ?? t("settings.importReview.unknown"))}
                </p>
                {field.sourceColumn != null ? (
                  <span className="block text-xs text-muted-foreground">
                    {t("settings.importReview.sourceColumn", {
                      defaultValue: "Source column {{column}}",
                      column: field.sourceColumn,
                    })}
                  </span>
                ) : null}
              </div>
              <div className="min-w-0">
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {t("settings.importReview.proposed")}
                </p>
                <ReviewValueInput
                  field={field}
                  label={label(field)}
                  value={decision.values[field.key] ?? ""}
                  onChange={(value) =>
                    setDecision((current) =>
                      changeReviewValue(current, field.key, value),
                    )
                  }
                  disabled={busy || uncertain}
                  product={product}
                  organizationId={organizationId}
                  references={references}
                  item={item}
                />
                {item.source.proposed[field.key] != null &&
                item.source.proposed[field.key] !== field.sourceValue &&
                item.source.proposed[field.key] !==
                  decision.values[field.key] ? (
                  <span className="block whitespace-pre-wrap break-words text-xs text-muted-foreground">
                    {t("settings.importReview.initialProposal", {
                      defaultValue: "Prepared value · {{value}}",
                      value: item.source.proposed[field.key],
                    })}
                  </span>
                ) : null}
                <label className="mt-2 flex min-h-8 cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    aria-label={t(
                      "settings.importReview.grouped.confirmField",
                      {
                        field: label(field),
                      },
                    )}
                    checked={decision.confirmedFields.includes(field.key)}
                    disabled={
                      busy || uncertain || !decision.values[field.key]?.trim()
                    }
                    onCheckedChange={(checked) =>
                      setDecision((current) => ({
                        ...current,
                        state:
                          current.state === "confirmed"
                            ? "needs_review"
                            : current.state,
                        confirmedFields: checked
                          ? [
                              ...current.confirmedFields.filter(
                                (key) => key !== field.key,
                              ),
                              field.key,
                            ]
                          : current.confirmedFields.filter(
                              (key) => key !== field.key,
                            ),
                      }))
                    }
                  />
                  {t("settings.importReview.grouped.confirmValue")}
                </label>
              </div>
            </div>
          </fieldset>
        ))}
      </div>
      {reconciliation ? (
        <div className="mt-3 space-y-1 text-sm">
          <p>
            {t("settings.importReview.calculated", {
              amount: reconciliation.calculated,
            })}
          </p>
          {reconciliation.recorded != null ? (
            <p
              className={
                saleMismatch ? "font-medium text-destructive" : undefined
              }
            >
              {t("settings.importReview.saleReconciliation", {
                defaultValue:
                  "Recorded amount {{amount}} · difference {{difference}}",
                amount: reconciliation.recorded,
                difference: reconciliation.difference,
              })}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm">
          <span>{t("settings.importReview.status")}</span>
          <Select
            value={decision.state}
            onValueChange={(value) =>
              setDecision((current) => ({
                ...current,
                state: value as ReviewRow["state"],
              }))
            }
            disabled={busy || uncertain}
          >
            <SelectTrigger aria-label={t("settings.importReview.status")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="needs_review">
                {t("settings.importReview.pending")}
              </SelectItem>
              <SelectItem value="confirmed">
                {t("settings.importReview.grouped.confirmRow")}
              </SelectItem>
              <SelectItem value="excluded">
                {t("settings.importReview.excluded")}
              </SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <span>{t("settings.importReview.reason")}</span>
          <Textarea
            variant="plain"
            value={decision.reason}
            onChange={(event) =>
              setDecision((current) => ({
                ...current,
                reason: event.target.value,
              }))
            }
            disabled={busy || uncertain}
            aria-label={t("settings.importReview.reason")}
            rows={2}
          />
        </label>
      </div>
      <div className="sticky bottom-0 z-10 mt-4 border-t bg-background py-3 @5xl/review:static">
        {error || referenceError ? (
          <p role="alert" className="mb-2 text-sm text-destructive">
            {error ?? referenceError}
          </p>
        ) : null}
        {uncertain ? (
          <p role="status" className="mb-2 text-sm">
            {t("settings.importReview.grouped.uncertainSave")}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant={hasNext && !uncertain ? "outline" : "default"}
            disabled={busy}
            onClick={() => void submit(false)}
          >
            {t(
              uncertain
                ? "settings.importReview.grouped.retrySave"
                : "settings.importReview.save",
            )}
          </Button>
          <Button
            disabled={busy || uncertain || !hasNext}
            onClick={() => void submit(true)}
          >
            {t("settings.importReview.grouped.saveNext")}
          </Button>
          <Button
            variant="ghost"
            disabled={busy || uncertain || dirty || !hasNext}
            onClick={onNext}
          >
            {t("settings.importReview.grouped.next")}
          </Button>
        </div>
      </div>
    </section>
  )
}

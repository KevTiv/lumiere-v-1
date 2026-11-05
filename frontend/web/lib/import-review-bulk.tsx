"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ReviewRow } from "./import-review-model"
import {
  buildBulkConfirmationPreview,
  buildBulkReviewPreview,
  type BulkConfirmationMode,
  type BulkConfirmationPreview,
  type BulkReviewPreview,
  type ReviewDecision,
} from "./import-review-uncertainty"
import { ReviewRequestError, ReviewValueInput } from "./import-review-editor"
import type { ProductReviewReferences } from "./import-review-product-references"

type BatchAction = "shared_value" | BulkConfirmationMode

type BatchPreview =
  | { kind: "shared_value"; data: BulkReviewPreview }
  | { kind: "confirmation"; data: BulkConfirmationPreview }

export function ImportReviewBulk({
  items,
  selectedIds,
  initialField,
  product,
  organizationId,
  references,
  onSave,
  onClear,
  onLockChange,
}: {
  items: ReviewRow[]
  selectedIds: Set<string>
  initialField?: string
  product: boolean
  organizationId: number
  references?: ProductReviewReferences
  onSave: (decisions: ReviewDecision[], requestKey: string) => Promise<void>
  onClear: () => void
  onLockChange: (locked: boolean) => void
}) {
  const { t } = useTranslation()
  const fields = [
    ...new Map(
      items
        .filter((item) => selectedIds.has(item.id))
        .flatMap((item) => item.source.fields)
        .map((field) => [field.key, field]),
    ).values(),
  ]
  const [action, setAction] = useState<BatchAction>("shared_value")
  const [fieldKey, setFieldKey] = useState(initialField ?? fields[0]?.key ?? "")
  const [fieldKeys, setFieldKeys] = useState<string[]>(
    initialField ? [initialField] : [],
  )
  const field = fields.find((field) => field.key === fieldKey)
  const [value, setValue] = useState("")
  const [reason, setReason] = useState("")
  const [confirm, setConfirm] = useState(true)
  const [replaceConfirmed, setReplaceConfirmed] = useState(false)
  const [preview, setPreview] = useState<BatchPreview | null>(null)
  const [heldIds, setHeldIds] = useState<Set<string>>(() => new Set())
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    onLockChange(busy || uncertain || preview !== null)
    return () => onLockChange(false)
  }, [busy, uncertain, preview, onLockChange])
  const [error, setError] = useState<string | null>(null)
  const pending = useRef<{
    decisions: ReviewDecision[]
    requestKey: string
  } | null>(null)
  const decisions =
    preview?.data.decisions.filter((decision) => !heldIds.has(decision.itemId)) ?? []
  const rows = preview?.data.rows.filter((row) => !heldIds.has(row.item.id)) ?? []
  const skipped = preview
    ? [
        ...preview.data.skipped,
        ...preview.data.rows
          .filter((row) => heldIds.has(row.item.id))
          .map((row) => ({
            item: row.item,
            reason: t("settings.importReview.grouped.rowException"),
          })),
      ]
    : []
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 50) - 1))
  const sharedPage =
    preview?.kind === "shared_value"
      ? preview.data.rows
          .filter((row) => !heldIds.has(row.item.id))
          .slice(currentPage * 50, currentPage * 50 + 50)
      : []
  const confirmationPage =
    preview?.kind === "confirmation"
      ? preview.data.rows
          .filter((row) => !heldIds.has(row.item.id))
          .slice(currentPage * 50, currentPage * 50 + 50)
      : []
  const prepare = () => {
    setError(null)
    try {
      setPreview(
        action === "shared_value"
          ? {
              kind: "shared_value",
              data: buildBulkReviewPreview({
                items,
                selectedIds,
                fieldKey,
                value,
                reason,
                confirm,
                replaceConfirmed,
              }),
            }
          : {
              kind: "confirmation",
              data: buildBulkConfirmationPreview({
                items,
                selectedIds,
                mode: action,
                fieldKeys,
                reason,
              }),
            },
      )
      setHeldIds(new Set())
      setSaved(false)
      setPage(0)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }
  const save = async () => {
    if (!preview || !decisions.length || saved) return
    pending.current ??= {
      decisions,
      requestKey: crypto.randomUUID(),
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(pending.current.decisions, pending.current.requestKey)
      pending.current = null
      setUncertain(false)
      if (preview.kind === "shared_value") {
        setPreview(null)
        onClear()
      } else {
        setSaved(true)
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      const unknown =
        !(failure instanceof ReviewRequestError) || !failure.definitive
      setUncertain(unknown)
      if (!unknown) {
        pending.current = null
        setPreview(null)
      }
    } finally {
      setBusy(false)
    }
  }
  const holdRow = (id: string) =>
    setHeldIds((current) => new Set(current).add(id))
  const confirmedLabel = (confirmed: boolean) =>
    t(
      confirmed
        ? "settings.importReview.grouped.valueIsConfirmed"
        : "settings.importReview.grouped.valueIsUnconfirmed",
    )
  return (
    <section
      aria-label={t("settings.importReview.grouped.bulk")}
      className="flex min-w-0 flex-col gap-3 rounded-lg border p-4"
    >
      <h4 className="font-semibold">
        {t("settings.importReview.grouped.bulkSelected", {
          count: selectedIds.size,
        })}
      </h4>
      {!preview ? (
        <>
          <FieldGroup>
            <Field>
              <FieldLabel>{t("settings.importReview.grouped.batchAction")}</FieldLabel>
              <ToggleGroup
                aria-label={t("settings.importReview.grouped.batchAction")}
                value={[action]}
                onValueChange={(next) => {
                  const candidate = next[0]
                  if (
                    candidate === "shared_value" ||
                    candidate === "complete_rows" ||
                    candidate === "confirm_fields"
                  ) {
                    setAction(candidate)
                    setError(null)
                  }
                }}
                variant="outline"
                className="w-full flex-wrap"
              >
                <ToggleGroupItem value="shared_value">
                  {t("settings.importReview.grouped.sharedValue")}
                </ToggleGroupItem>
                <ToggleGroupItem value="complete_rows">
                  {t("settings.importReview.grouped.confirmExisting")}
                </ToggleGroupItem>
                <ToggleGroupItem value="confirm_fields">
                  {t("settings.importReview.grouped.confirmSelected")}
                </ToggleGroupItem>
              </ToggleGroup>
              <FieldDescription>
                {t(
                  action === "shared_value"
                    ? "settings.importReview.grouped.sharedValueHint"
                    : action === "complete_rows"
                      ? "settings.importReview.grouped.confirmExistingHint"
                      : "settings.importReview.grouped.confirmSelectedHint",
                )}
              </FieldDescription>
            </Field>
            {action === "shared_value" ? (
              <>
                <Field>
                  <FieldLabel>{t("settings.importReview.grouped.field")}</FieldLabel>
                  <Select
                    value={field?.key ?? ""}
                    onValueChange={(key) => {
                      setFieldKey(key)
                      setValue("")
                    }}
                  >
                    <SelectTrigger
                      aria-label={t("settings.importReview.grouped.bulkField")}
                    >
                      <SelectValue placeholder={t("settings.importReview.grouped.chooseField")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {fields.map((field) => (
                          <SelectItem key={field.key} value={field.key}>
                            {field.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>{t("settings.importReview.grouped.newValue")}</FieldLabel>
                  {field ? (
                    <ReviewValueInput
                      field={field}
                      label={t("settings.importReview.grouped.newValue")}
                      value={value}
                      onChange={setValue}
                      disabled={false}
                      product={product}
                      organizationId={organizationId}
                      references={references}
                    />
                  ) : null}
                </Field>
                <Field orientation="horizontal">
                  <Checkbox
                    id="bulk-confirm-shared-field"
                    checked={confirm}
                    onCheckedChange={setConfirm}
                  />
                  <FieldLabel htmlFor="bulk-confirm-shared-field">
                    {t("settings.importReview.grouped.confirmOnlyField")}
                  </FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <Checkbox
                    id="bulk-replace-confirmed"
                    checked={replaceConfirmed}
                    onCheckedChange={setReplaceConfirmed}
                  />
                  <FieldLabel htmlFor="bulk-replace-confirmed">
                    {t("settings.importReview.grouped.replaceConfirmed")}
                  </FieldLabel>
                </Field>
              </>
            ) : action === "confirm_fields" ? (
              <FieldSet>
                <FieldLegend variant="label">
                  {t("settings.importReview.grouped.fieldsToConfirm")}
                </FieldLegend>
                <FieldGroup>
                  {fields.map((field) => (
                    <Field key={field.key} orientation="horizontal">
                      <Checkbox
                        id={`bulk-existing-${field.key}`}
                        aria-label={t(
                          "settings.importReview.grouped.confirmExistingField",
                          { field: field.label },
                        )}
                        checked={fieldKeys.includes(field.key)}
                        onCheckedChange={(checked) =>
                          setFieldKeys((current) =>
                            checked
                              ? [...current.filter((key) => key !== field.key), field.key]
                              : current.filter((key) => key !== field.key),
                          )
                        }
                      />
                      <FieldLabel htmlFor={`bulk-existing-${field.key}`}>{field.label}</FieldLabel>
                    </Field>
                  ))}
                </FieldGroup>
              </FieldSet>
            ) : null}
            <Field>
              <FieldLabel htmlFor="bulk-review-reason">{t("settings.importReview.reason")}</FieldLabel>
              <Input
                id="bulk-review-reason"
                aria-label={t("settings.importReview.grouped.bulkReason")}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={prepare}
              disabled={action === "shared_value" ? !field : action === "confirm_fields" && !fieldKeys.length}
            >
              {t("settings.importReview.grouped.previewBulk")}
            </Button>
            <Button variant="ghost" onClick={onClear}>
              {t("settings.importReview.grouped.clearSelection")}
            </Button>
          </div>
        </>
      ) : (
        <>
          {!saved ? (
            <p role="status">
              {t("settings.importReview.grouped.previewCount", {
                count: decisions.length,
                skipped: skipped.length,
              })}
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            {t(preview.kind === "shared_value"
              ? "settings.importReview.grouped.previewBoundary"
              : "settings.importReview.grouped.confirmationBoundary")}
          </p>
          {saved ? (
            <Alert role="status">
              <AlertDescription>
                {t("settings.importReview.grouped.savedReviews", { count: decisions.length })}
              </AlertDescription>
            </Alert>
          ) : null}
          {preview.kind === "shared_value" ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("settings.importReview.source")}</TableHead>
                  <TableHead>{t("settings.importReview.item")}</TableHead>
                  <TableHead>{t("settings.importReview.grouped.before")}</TableHead>
                  <TableHead>{t("settings.importReview.grouped.after")}</TableHead>
                  <TableHead>{t("settings.importReview.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sharedPage.map((row) => (
                  <TableRow key={row.item.id}>
                    <TableCell>{row.item.source.source.file} · {row.item.source.source.row}</TableCell>
                    <TableCell>{row.item.source.label}</TableCell>
                    <TableCell>{row.before ?? t("settings.importReview.unknown")}</TableCell>
                    <TableCell>{row.after ?? t("settings.importReview.unknown")}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy || uncertain}
                        onClick={() => holdRow(row.item.id)}
                      >
                        {t("settings.importReview.grouped.leaveUnchanged")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <section
              aria-label={t(
                saved
                  ? "settings.importReview.grouped.savedResults"
                  : "settings.importReview.grouped.confirmationPreview",
              )}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("settings.importReview.source")}</TableHead>
                    <TableHead>{t("settings.importReview.item")}</TableHead>
                    <TableHead>{t("settings.importReview.grouped.before")}</TableHead>
                    <TableHead>{t("settings.importReview.grouped.after")}</TableHead>
                    <TableHead>{t("settings.importReview.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {confirmationPage.map((row) => (
                    <TableRow key={row.item.id}>
                      <TableCell>
                        <p>{row.item.source.source.file} · {row.item.source.source.row}</p>
                        <details>
                          <summary>{t("settings.importReview.grouped.sourceHash")}</summary>
                          <p className="max-w-48 break-all">{row.item.source.source.sha256}</p>
                        </details>
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-48 max-w-lg flex-col gap-2 whitespace-normal">
                          <p>{row.item.source.label}</p>
                          <dl className="flex flex-col gap-1">
                            {row.fields
                              .filter((entry) => entry.value?.trim())
                              .map((entry) => (
                                <div key={entry.field.key} className="flex flex-wrap gap-x-2">
                                  <dt>{entry.field.label}:</dt>
                                  <dd className="break-all">
                                    {entry.value}
                                    {entry.value !== entry.sourceValue ? (
                                      <span>
                                        {" "}({t("settings.importReview.grouped.proposedValue")})
                                      </span>
                                    ) : null}
                                  </dd>
                                </div>
                              ))}
                          </dl>
                          <details>
                            <summary>
                              {t("settings.importReview.grouped.reviewValues", {
                                count: row.fields.length,
                              })}
                            </summary>
                            <Table
                              aria-label={t("settings.importReview.grouped.rowValues", {
                                name: row.item.source.label,
                              })}
                            >
                              <TableHeader>
                                <TableRow>
                                  <TableHead>{t("settings.importReview.grouped.field")}</TableHead>
                                  <TableHead>{t("settings.importReview.grouped.original")}</TableHead>
                                  <TableHead>{t("settings.importReview.grouped.currentValue")}</TableHead>
                                  <TableHead>{t("settings.importReview.grouped.before")}</TableHead>
                                  <TableHead>{t("settings.importReview.grouped.after")}</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {row.fields.map((entry) => (
                                  <TableRow key={entry.field.key}>
                                    <TableCell>{entry.field.label}</TableCell>
                                    <TableCell>
                                      {entry.sourceValue ?? t("settings.importReview.unknown")}
                                    </TableCell>
                                    <TableCell>
                                      <p>{entry.value ?? t("settings.importReview.unknown")}</p>
                                      <p className="text-sm text-muted-foreground">
                                        {t(
                                          entry.value === entry.sourceValue
                                            ? "settings.importReview.grouped.sourceValue"
                                            : "settings.importReview.grouped.proposedValue",
                                        )}
                                      </p>
                                    </TableCell>
                                    <TableCell>{confirmedLabel(entry.beforeConfirmed)}</TableCell>
                                    <TableCell>{confirmedLabel(entry.afterConfirmed)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </details>
                        </div>
                      </TableCell>
                      <TableCell>{t(`settings.importReview.filter.${row.beforeState}`)}</TableCell>
                      <TableCell>{t(`settings.importReview.filter.${row.afterState}`)}</TableCell>
                      <TableCell>
                        {saved ? t("settings.importReview.grouped.rowSaved") : (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t("settings.importReview.grouped.holdNamedRow", {
                              name: row.item.source.label,
                            })}
                            disabled={busy || uncertain}
                            onClick={() => holdRow(row.item.id)}
                          >
                            {t("settings.importReview.grouped.holdRow")}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}
          {rows.length > 50 ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!currentPage}
                onClick={() => setPage(currentPage - 1)}
              >
                {t("settings.importReview.grouped.previousPage")}
              </Button>
              <span className="self-center text-sm">
                {t("settings.importReview.grouped.page", {
                  page: currentPage + 1,
                  pages: Math.ceil(rows.length / 50),
                })}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={(currentPage + 1) * 50 >= rows.length}
                onClick={() => setPage(currentPage + 1)}
              >
                {t("settings.importReview.grouped.nextPage")}
              </Button>
            </div>
          ) : null}
          {skipped.length ? (
            <details>
              <summary>{t("settings.importReview.grouped.exceptions", { count: skipped.length })}</summary>
              <ul className="max-h-48 overflow-auto text-sm">
                {skipped.map(({ item, reason }) => (
                  <li key={item.id}>
                    {item.source.label} · {item.source.source.file}:{item.source.source.row} · {reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {saved ? (
              <Button onClick={onClear}>{t("settings.importReview.grouped.done")}</Button>
            ) : (
              <>
                <Button disabled={busy || !decisions.length} aria-busy={busy} onClick={() => void save()}>
                  {uncertain
                    ? t("settings.importReview.grouped.retrySave")
                    : t(preview.kind === "shared_value"
                      ? "settings.importReview.grouped.applyBulk"
                      : "settings.importReview.grouped.saveReviews", { count: decisions.length })}
                </Button>
                <Button variant="ghost" disabled={busy || uncertain} onClick={() => setPreview(null)}>
                  {t("settings.importReview.grouped.editPreview")}
                </Button>
              </>
            )}
          </div>
        </>
      )}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {uncertain ? (
        <p role="status" className="text-sm">{t("settings.importReview.grouped.uncertainSave")}</p>
      ) : null}
    </section>
  )
}

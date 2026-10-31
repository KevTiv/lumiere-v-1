"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
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
import type { ReviewRow } from "./import-review-model"
import {
  buildBulkReviewPreview,
  type BulkReviewPreview,
  type ReviewDecision,
} from "./import-review-uncertainty"
import { ReviewRequestError, ReviewValueInput } from "./import-review-editor"
import type { ProductReviewReferences } from "./import-review-product-references"

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
  const [fieldKey, setFieldKey] = useState(initialField ?? fields[0]?.key ?? "")
  const field = fields.find((field) => field.key === fieldKey)
  const [value, setValue] = useState("")
  const [reason, setReason] = useState("")
  const [confirm, setConfirm] = useState(true)
  const [replaceConfirmed, setReplaceConfirmed] = useState(false)
  const [preview, setPreview] = useState<BulkReviewPreview | null>(null)
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  useEffect(() => {
    onLockChange(busy || uncertain)
    return () => onLockChange(false)
  }, [busy, uncertain, onLockChange])
  const [error, setError] = useState<string | null>(null)
  const pending = useRef<{
    decisions: ReviewDecision[]
    requestKey: string
  } | null>(null)
  const prepare = () => {
    setError(null)
    try {
      setPreview(
        buildBulkReviewPreview({
          items,
          selectedIds,
          fieldKey,
          value,
          reason,
          confirm,
          replaceConfirmed,
        }),
      )
      setPage(0)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }
  const save = async () => {
    if (!preview || !preview.decisions.length) return
    pending.current ??= {
      decisions: preview.decisions,
      requestKey: crypto.randomUUID(),
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(pending.current.decisions, pending.current.requestKey)
      pending.current = null
      setPreview(null)
      setUncertain(false)
      onClear()
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
  const previewPage = preview?.rows.slice(page * 50, page * 50 + 50) ?? []
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
          <div className="grid gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-2 text-sm">
              <span>{t("settings.importReview.grouped.field")}</span>
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
                  <SelectValue
                    placeholder={t("settings.importReview.grouped.chooseField")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {fields.map((field) => (
                    <SelectItem key={field.key} value={field.key}>
                      {field.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-2 text-sm">
              <span>{t("settings.importReview.grouped.newValue")}</span>
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
            </label>
            <label className="flex flex-col gap-2 text-sm">
              <span>{t("settings.importReview.reason")}</span>
              <Input
                aria-label={t("settings.importReview.grouped.bulkReason")}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={confirm} onCheckedChange={setConfirm} />
            {t("settings.importReview.grouped.confirmOnlyField")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={replaceConfirmed}
              onCheckedChange={setReplaceConfirmed}
            />
            {t("settings.importReview.grouped.replaceConfirmed")}
          </label>
          <div className="flex gap-2">
            <Button variant="outline" onClick={prepare} disabled={!field}>
              {t("settings.importReview.grouped.previewBulk")}
            </Button>
            <Button variant="ghost" onClick={onClear}>
              {t("settings.importReview.grouped.clearSelection")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p role="status">
            {t("settings.importReview.grouped.previewCount", {
              count: preview.decisions.length,
              skipped: preview.skipped.length,
            })}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("settings.importReview.grouped.previewBoundary")}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("settings.importReview.source")}</TableHead>
                <TableHead>{t("settings.importReview.item")}</TableHead>
                <TableHead>
                  {t("settings.importReview.grouped.before")}
                </TableHead>
                <TableHead>
                  {t("settings.importReview.grouped.after")}
                </TableHead>
                <TableHead>{t("settings.importReview.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewPage.map((row) => (
                <TableRow key={row.item.id}>
                  <TableCell>
                    {row.item.source.source.file} · {row.item.source.source.row}
                  </TableCell>
                  <TableCell>{row.item.source.label}</TableCell>
                  <TableCell>
                    {row.before ?? t("settings.importReview.unknown")}
                  </TableCell>
                  <TableCell>
                    {row.after ?? t("settings.importReview.unknown")}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy || uncertain}
                      onClick={() =>
                        setPreview((current) =>
                          current
                            ? {
                                ...current,
                                decisions: current.decisions.filter(
                                  (decision) => decision.itemId !== row.item.id,
                                ),
                                rows: current.rows.filter(
                                  (candidate) =>
                                    candidate.item.id !== row.item.id,
                                ),
                                skipped: [
                                  ...current.skipped,
                                  {
                                    item: row.item,
                                    reason: t(
                                      "settings.importReview.grouped.rowException",
                                    ),
                                  },
                                ],
                              }
                            : null,
                        )
                      }
                    >
                      {t("settings.importReview.grouped.leaveUnchanged")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {preview.rows.length > 50 ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!page}
                onClick={() => setPage(page - 1)}
              >
                {t("settings.importReview.grouped.previousPage")}
              </Button>
              <span className="self-center text-sm">
                {t("settings.importReview.grouped.page", {
                  page: page + 1,
                  pages: Math.ceil(preview.rows.length / 50),
                })}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={(page + 1) * 50 >= preview.rows.length}
                onClick={() => setPage(page + 1)}
              >
                {t("settings.importReview.grouped.nextPage")}
              </Button>
            </div>
          ) : null}
          {preview.skipped.length ? (
            <details>
              <summary>
                {t("settings.importReview.grouped.exceptions", {
                  count: preview.skipped.length,
                })}
              </summary>
              <ul className="max-h-48 overflow-auto text-sm">
                {preview.skipped.map(({ item, reason }) => (
                  <li key={item.id}>
                    {item.source.label} · {item.source.source.file}:
                    {item.source.source.row} · {reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <div className="flex gap-2">
            <Button
              disabled={busy || !preview.decisions.length}
              onClick={() => void save()}
            >
              {uncertain
                ? t("settings.importReview.grouped.retrySave")
                : t("settings.importReview.grouped.applyBulk", {
                    count: preview.decisions.length,
                  })}
            </Button>
            <Button
              variant="ghost"
              disabled={busy || uncertain}
              onClick={() => setPreview(null)}
            >
              {t("settings.importReview.grouped.editPreview")}
            </Button>
          </div>
        </>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {uncertain ? (
        <p role="status" className="text-sm">
          {t("settings.importReview.grouped.uncertainSave")}
        </p>
      ) : null}
    </section>
  )
}

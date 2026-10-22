"use client"

import { useState, type ComponentProps } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Alert, AlertDescription } from "@lumiere/ui/components/alert"
import { Button } from "@lumiere/ui/components/button"
import { Input } from "@lumiere/ui/components/input"
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@lumiere/ui/components/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lumiere/ui/components/select"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@lumiere/ui/components/alert-dialog"
import type { CustomField, FormValues } from "@lumiere/ui/lib/form-types"
import {
  parseTemplateBlocks,
  REPORT_COLUMNS,
  serializeTemplateBlocks,
  templatePreviewDocument,
  type TemplateBlock,
  type ReportColumnKey,
} from "./template-layout"

export function TemplateLayoutEditor({
  value,
  onChange,
  field,
}: ComponentProps<CustomField["component"]>) {
  const { t } = useTranslation()
  const content = typeof value === "string" ? value : ""
  const blocks = parseTemplateBlocks(content)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(blocks === null)
  const setBlocks = (next: TemplateBlock[]) => {
    if (!field.disabled) onChange(serializeTemplateBlocks(next))
  }
  const addBlock = (kind: TemplateBlock["kind"]) => {
    if (field.disabled || (blocks?.length ?? 0) >= 100) return
    const id = crypto.randomUUID()
    setBlocks([
      ...(blocks ?? []),
      kind === "table"
        ? { id, kind, columns: ["number", "date", "partner", "total"] }
        : { id, kind, text: "" },
    ])
  }
  const edit = (index: number, block: TemplateBlock) =>
    setBlocks((blocks ?? []).map((current, i) => (i === index ? block : current)))
  return (
    <FieldGroup data-testid="template-layout-editor">
      <Alert>
        <AlertDescription>
          {t("reports.layout.bindingLimit", {
            defaultValue:
              "This editor saves layout markup. Your report integration supplies live data. Example values appear only in the preview.",
          })}
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setSourceOpen((open) => !open)}
        >
          {sourceOpen
            ? t("reports.layout.hideSource", { defaultValue: "Hide markup" })
            : t("reports.layout.showSource", { defaultValue: "Edit markup" })}
        </Button>
        {blocks === null ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={field.disabled}
            onClick={() => setReplaceOpen(true)}
          >
            {t("reports.layout.useSections", {
              defaultValue: "Build with sections",
            })}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={field.disabled || (blocks?.length ?? 0) >= 100}
              onClick={() => addBlock("heading")}
            >
              {t("reports.layout.addHeading", { defaultValue: "Add heading" })}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={field.disabled || (blocks?.length ?? 0) >= 100}
              onClick={() => addBlock("paragraph")}
            >
              {t("reports.layout.addText", { defaultValue: "Add text" })}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={field.disabled || (blocks?.length ?? 0) >= 100}
              onClick={() => addBlock("table")}
            >
              {t("reports.layout.addTable", {
                defaultValue: "Add document table",
              })}
            </Button>
          </>
        )}
      </div>
      {sourceOpen ? (
        <Field>
          <FieldLabel htmlFor="report-template-markup">
            {t("reports.layout.markup", { defaultValue: "Template markup" })}
          </FieldLabel>
          <textarea
            id="report-template-markup"
            data-testid="template-markup"
            className="min-h-48 w-full rounded-md border border-input bg-background p-3 font-mono text-sm"
            value={content}
            disabled={field.disabled}
            onChange={(event) => onChange(event.target.value)}
            spellCheck={false}
          />
        </Field>
      ) : null}
      {blocks?.map((block, index) => (
        <Field
          key={block.id}
          className="rounded-lg border border-border p-3"
          data-testid={`template-section-${index}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {index + 1}.{" "}
              {t(`reports.layout.kind.${block.kind}`, {
                defaultValue: block.kind,
              })}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={field.disabled || index === 0}
                aria-label={t("reports.layout.moveUp", {
                  defaultValue: "Move section {{number}} up",
                  number: index + 1,
                })}
                onClick={() => {
                  const next = [...blocks]
                  ;[next[index - 1], next[index]] = [next[index]!, next[index - 1]!]
                  setBlocks(next)
                }}
              >
                {t("reports.layout.up", { defaultValue: "Up" })}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={field.disabled || index === blocks.length - 1}
                aria-label={t("reports.layout.moveDown", {
                  defaultValue: "Move section {{number}} down",
                  number: index + 1,
                })}
                onClick={() => {
                  const next = [...blocks]
                  ;[next[index], next[index + 1]] = [next[index + 1]!, next[index]!]
                  setBlocks(next)
                }}
              >
                {t("reports.layout.down", { defaultValue: "Down" })}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={field.disabled}
                aria-label={t("reports.layout.removeSection", {
                  defaultValue: "Remove section {{number}}",
                  number: index + 1,
                })}
                onClick={() => setBlocks(blocks.filter((_, i) => i !== index))}
              >
                {t("common.remove", { defaultValue: "Remove" })}
              </Button>
            </div>
          </div>
          {block.kind === "table" ? (
            <FieldGroup>
              <FieldDescription>
                {t("reports.layout.columnsHint", {
                  defaultValue:
                    "Choose the labels and order for the document columns. Example rows are not saved.",
                })}
              </FieldDescription>
              {block.columns.map((key, columnIndex) => (
                <Field key={key} orientation="horizontal">
                  <FieldLabel htmlFor={`${block.id}-${key}`}>
                    {t("reports.layout.column", {
                      defaultValue: "Column {{number}}",
                      number: columnIndex + 1,
                    })}
                  </FieldLabel>
                  <Select
                    value={key}
                    disabled={field.disabled}
                    onValueChange={(next) => {
                      if (
                        REPORT_COLUMNS.some((column) => column.key === next) &&
                        !block.columns.includes(next as ReportColumnKey)
                      )
                        edit(index, {
                          ...block,
                          columns: block.columns.map((current, i) =>
                            i === columnIndex ? (next as ReportColumnKey) : current,
                          ),
                        })
                    }}
                  >
                    <SelectTrigger id={`${block.id}-${key}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {REPORT_COLUMNS.map((column) => (
                          <SelectItem
                            key={column.key}
                            value={column.key}
                            disabled={block.columns.includes(column.key) && column.key !== key}
                          >
                            {column.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={field.disabled}
                    aria-label={t("reports.layout.removeColumn", {
                      defaultValue: "Remove column {{number}}",
                      number: columnIndex + 1,
                    })}
                    onClick={() =>
                      edit(index, {
                        ...block,
                        columns: block.columns.filter((_, i) => i !== columnIndex),
                      })
                    }
                  >
                    {t("common.remove", { defaultValue: "Remove" })}
                  </Button>
                </Field>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={field.disabled || block.columns.length === REPORT_COLUMNS.length}
                onClick={() => {
                  const next = REPORT_COLUMNS.find((column) => !block.columns.includes(column.key))
                  if (next)
                    edit(index, {
                      ...block,
                      columns: [...block.columns, next.key],
                    })
                }}
              >
                {t("reports.layout.addColumn", { defaultValue: "Add column" })}
              </Button>
            </FieldGroup>
          ) : (
            <>
              <FieldLabel htmlFor={`template-text-${block.id}`}>
                {t("reports.layout.sectionText", {
                  defaultValue: "Section text",
                })}
              </FieldLabel>
              {block.kind === "heading" ? (
                <Input
                  id={`template-text-${block.id}`}
                  data-testid={`template-section-text-${index}`}
                  value={block.text}
                  disabled={field.disabled}
                  onChange={(event) => edit(index, { ...block, text: event.target.value })}
                />
              ) : (
                <textarea
                  id={`template-text-${block.id}`}
                  data-testid={`template-section-text-${index}`}
                  className="min-h-28 w-full rounded-md border border-input bg-background p-3 text-sm"
                  value={block.text}
                  disabled={field.disabled}
                  onChange={(event) => edit(index, { ...block, text: event.target.value })}
                />
              )}
            </>
          )}
        </Field>
      ))}
      <AlertDialog open={replaceOpen} onOpenChange={setReplaceOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("reports.layout.replaceTitle", {
                defaultValue: "Replace existing markup?",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("reports.layout.replaceDescription", {
                defaultValue:
                  "Section editing starts a new layout. The existing markup is replaced only in this draft. Cancel the form to keep the saved template.",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={field.disabled}
              onClick={() => {
                setBlocks([])
                setSourceOpen(false)
                setReplaceOpen(false)
              }}
            >
              {t("reports.layout.replace", {
                defaultValue: "Start section layout",
              })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FieldGroup>
  )
}

export function TemplateLayoutPreview({ values }: { values: FormValues }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-3" data-testid="template-layout-preview">
      <p className="text-sm text-muted-foreground">
        {t("reports.layout.previewHint", {
          defaultValue:
            "Layout preview with example values. Scripts and external content are not loaded.",
        })}
      </p>
      <iframe
        title={t("reports.layout.previewTitle", {
          defaultValue: "Report template layout preview",
        })}
        sandbox=""
        referrerPolicy="no-referrer"
        className="h-[32rem] w-full rounded-lg border border-border bg-background"
        srcDoc={templatePreviewDocument(
          String(values.templateContent ?? ""),
          String(values.orientation ?? "Portrait"),
        )}
      />
    </div>
  )
}

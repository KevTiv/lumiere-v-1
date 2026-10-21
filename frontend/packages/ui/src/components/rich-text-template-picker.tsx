"use client"

import * as React from "react"
import { useTranslation } from "@lumiere/i18n"
import type { Editor } from "@tiptap/react"
import { closeHistory } from "@tiptap/pm/history"
import { DOMParser, type Node as ProseMirrorNode } from "@tiptap/pm/model"
import type { Selection } from "@tiptap/pm/state"
import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  FileText,
  LayoutTemplate,
  RefreshCw,
  Search,
  TextCursorInput,
  X,
} from "lucide-react"

import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@lumiere/ui/components/popover"
import { useRichTextTemplates } from "@lumiere/ui/components/rich-text-template-provider"
import { sanitizeRichTextTemplateHtml } from "@lumiere/ui/lib/document-template-designer"

type RichTextTemplatePickerProps = {
  editor: Editor
  disabled: boolean
  maxLength?: number
}

type InsertionTarget = {
  doc: ProseMirrorNode
  selection: Selection
}

type TemplateSource = NonNullable<ReturnType<typeof useRichTextTemplates>>

type TemplatePreview = {
  heading: string
  excerpt: string
  kind: "Text" | "List" | "Table" | "Quote" | "Code"
}

/** A small, inert preview of the same supported content used for insertion. */
function readTemplatePreview(
  html: string,
  t: ReturnType<typeof useTranslation>["t"],
): TemplatePreview {
  const fallback: TemplatePreview = {
    heading: "",
    excerpt: t("documents.templatePicker.previewUnavailable", {
      defaultValue: "Content preview unavailable.",
    }),
    kind: "Text",
  }
  if (typeof document === "undefined") return fallback

  try {
    const content = document.createElement("div")
    content.innerHTML = sanitizeRichTextTemplateHtml(html)
    const kind = content.querySelector("table")
      ? "Table"
      : content.querySelector("ul, ol")
        ? "List"
        : content.querySelector("blockquote")
          ? "Quote"
          : content.querySelector("pre")
            ? "Code"
            : "Text"
    // Preserve readable boundaries between paragraphs and table cells without
    // rendering stored HTML or introducing focusable links into a card.
    content.querySelectorAll("br").forEach((node) => node.replaceWith(" "))
    content
      .querySelectorAll("p, h1, h2, h3, li, tr, td, th, blockquote, pre, div")
      .forEach((node) => node.append(" "))
    const normalize = (text: string | null) =>
      (text ?? "").replace(/\s+/g, " ").trim()
    const headingNode = content.querySelector("h1, h2, h3")
    const heading = Array.from(normalize(headingNode?.textContent ?? ""))
      .slice(0, 96)
      .join("")
    headingNode?.remove()
    const body = normalize(content.textContent) || heading
    const characters = Array.from(body)
    const excerpt =
      characters.length > 180 ? `${characters.slice(0, 177).join("")}…` : body
    return { heading, excerpt: excerpt || fallback.excerpt, kind }
  } catch {
    return fallback
  }
}

function ScopedTemplatePicker({
  editor,
  disabled,
  maxLength,
  source,
}: RichTextTemplatePickerProps & { source: TemplateSource }) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const [insertionError, setInsertionError] = React.useState<string>()
  const targetRef = React.useRef<InsertionTarget | null>(null)
  const insertedRef = React.useRef(false)
  const searchRef = React.useRef<HTMLInputElement>(null)
  const query = search.trim().toLocaleLowerCase()
  const previews = React.useMemo(
    () =>
      open && source.status === "ready"
        ? source.templates.map((template) => ({
            ...template,
            preview: readTemplatePreview(template.html, t),
          }))
        : [],
    [open, source.status, source.templates, t],
  )
  const templates = previews.filter((template) =>
    template.name.toLocaleLowerCase().includes(query),
  )

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      if (disabled || editor.isDestroyed || !editor.isEditable) return
      targetRef.current = {
        doc: editor.state.doc,
        selection: editor.state.selection,
      }
      insertedRef.current = false
      setSearch("")
      setInsertionError(undefined)
      source.onRequest()
    } else {
      targetRef.current = null
    }
    setOpen(nextOpen)
  }

  const insertTemplate = (id: string) => {
    if (disabled || editor.isDestroyed || !editor.isEditable) return
    const target = targetRef.current
    const template = source.templates.find((option) => option.id === id)
    if (!target || source.status !== "ready" || !template) {
      setInsertionError(
        t("documents.templatePicker.noLongerAvailable", {
          defaultValue:
            "This template is no longer available. Reopen templates to try again.",
        }),
      )
      return
    }
    if (editor.state.doc !== target.doc) {
      setInsertionError(
        t("documents.templatePicker.textChanged", {
          defaultValue:
            "The text changed while templates were open. Reopen templates to choose where to insert.",
        }),
      )
      return
    }

    try {
      const container = document.createElement("div")
      container.innerHTML = sanitizeRichTextTemplateHtml(template.html)
      const content = DOMParser.fromSchema(editor.schema).parseSlice(container)
      if (!content.content.size) {
        setInsertionError(
          t("documents.templatePicker.noContent", {
            defaultValue:
              "This template has no supported text content to insert.",
          }),
        )
        return
      }

      // Build and validate the entire edit before dispatching. CharacterCount's
      // paste handling can truncate content, which is unsuitable for templates.
      const transaction = editor.state.tr
        .setSelection(target.selection)
        .replaceSelection(content)
      const count = editor.storage.characterCount.characters({
        node: transaction.doc,
      })
      if (maxLength !== undefined && maxLength >= 0 && count > maxLength) {
        setInsertionError(
          t("documents.templatePicker.lengthLimit", {
            defaultValue:
              "This template would exceed the {{limit}}-character limit. Shorten the text or choose another template.",
            limit: maxLength,
          }),
        )
        return
      }

      editor.view.dispatch(closeHistory(transaction).scrollIntoView())
      // A metadata-only boundary keeps subsequent typing out of the template's
      // undo step. The content change still uses one undoable transaction and
      // the editor's normal onUpdate/Markdown/native-textarea bridge.
      editor.view.dispatch(closeHistory(editor.state.tr))
      insertedRef.current = true
      targetRef.current = null
      setOpen(false)
      editor.view.focus()
    } catch {
      setInsertionError(
        t("documents.templatePicker.insertFailed", {
          defaultValue:
            "This template could not be inserted. Choose another template.",
        }),
      )
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={t("documents.templatePicker.insertTextTemplate", {
              defaultValue: "Insert text template",
            })}
            title={t("documents.templatePicker.insertTextTemplate", {
              defaultValue: "Insert text template",
            })}
            disabled={disabled}
            className="mr-1.5 inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border border-border/70 bg-background px-2.5 text-xs font-medium text-foreground shadow-xs outline-none transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-40 aria-expanded:border-primary/30 aria-expanded:bg-primary/5 aria-expanded:text-primary sm:h-8"
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
          >
            <LayoutTemplate
              aria-hidden="true"
              className="size-4 text-primary sm:size-3.5"
            />
            {t("documents.templatePicker.templates", {
              defaultValue: "Templates",
            })}
            <ChevronDown
              aria-hidden="true"
              className="size-3 text-muted-foreground"
            />
          </button>
        }
      />
      <PopoverContent
        align="start"
        sideOffset={8}
        className="max-h-[min(36rem,var(--available-height))] w-[25rem] max-w-[calc(100vw-1.5rem)] gap-0 overflow-hidden rounded-2xl p-0 shadow-xl shadow-black/10"
        initialFocus={searchRef}
        finalFocus={() =>
          insertedRef.current && !editor.isDestroyed ? editor.view.dom : true
        }
      >
        <div className="shrink-0 space-y-4 border-b border-border/70 px-4 pt-4 pb-3">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/8 text-primary ring-1 ring-primary/10"
            >
              <LayoutTemplate className="size-5" />
            </span>
            <div className="min-w-0 space-y-0.5 pt-0.5">
              <PopoverTitle className="text-sm font-semibold tracking-tight">
                {t("documents.templatePicker.textTemplates", {
                  defaultValue: "Text templates",
                })}
              </PopoverTitle>
              <PopoverDescription className="text-xs leading-relaxed">
                {t(
                  "documents.templatePicker.chooseReusableContentForThisField",
                  { defaultValue: "Choose reusable content for this field." },
                )}
              </PopoverDescription>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-input/80 bg-muted/30 px-3 transition-[border-color,box-shadow] focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/15">
            <Search
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <input
              ref={searchRef}
              type="search"
              aria-label={t("documents.templatePicker.searchTextTemplates", {
                defaultValue: "Search text templates",
              })}
              placeholder={t("documents.templatePicker.searchTemplates", {
                defaultValue: "Search templates…",
              })}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70 [&::-webkit-search-cancel-button]:appearance-none"
            />
            {search ? (
              <button
                type="button"
                aria-label={t("documents.templatePicker.clearTemplateSearch", {
                  defaultValue: "Clear template search",
                })}
                className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
                onClick={() => {
                  setSearch("")
                  searchRef.current?.focus()
                }}
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>
        {source.status === "idle" || source.status === "loading" ? (
          <div className="min-h-0 overflow-y-auto p-3">
            <p
              role="status"
              className="px-1 pb-3 text-xs text-muted-foreground"
            >
              {t("documents.templatePicker.loadingTemplates", {
                defaultValue: "Loading templates…",
              })}
            </p>
            <div
              aria-hidden="true"
              className="space-y-2 motion-safe:animate-pulse"
            >
              {[0, 1].map((item) => (
                <div
                  key={item}
                  className="flex gap-3 rounded-xl border border-border/60 p-3"
                >
                  <span className="h-20 w-14 shrink-0 rounded-md bg-muted" />
                  <span className="flex flex-1 flex-col gap-2.5 py-1">
                    <span className="h-3 w-2/3 rounded bg-muted" />
                    <span className="h-2.5 w-full rounded bg-muted/70" />
                    <span className="h-2.5 w-4/5 rounded bg-muted/70" />
                    <span className="mt-auto h-2.5 w-10 rounded bg-muted" />
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : source.status === "error" ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-6 py-7 text-center">
            <span
              aria-hidden="true"
              className="grid size-11 place-items-center rounded-full bg-destructive/8 text-destructive"
            >
              <AlertCircle className="size-5" />
            </span>
            <p className="text-sm font-medium">
              {t("documents.templatePicker.templatesCouldnTBeLoaded", {
                defaultValue: "Templates couldn’t be loaded",
              })}
            </p>
            <p
              role="alert"
              className="text-xs leading-relaxed text-muted-foreground"
            >
              {source.error ??
                t("documents.templatePicker.loadFailed", {
                  defaultValue: "Templates could not be loaded.",
                })}
            </p>
            <button
              type="button"
              className="mt-1 inline-flex h-8 items-center gap-2 rounded-lg border bg-background px-3 text-xs font-medium shadow-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30"
              onClick={source.onRequest}
            >
              <RefreshCw aria-hidden="true" className="size-3.5" />
              {t("documents.templatePicker.retry", { defaultValue: "Retry" })}
            </button>
          </div>
        ) : templates.length ? (
          <div className="min-h-0 overflow-y-auto overscroll-contain p-3">
            <div className="mb-2 flex items-center justify-between px-1 text-[11px] text-muted-foreground">
              <span className="font-medium">
                {query
                  ? t("documents.templatePicker.searchResults", {
                      defaultValue: "Search results",
                    })
                  : t("documents.templatePicker.available", {
                      defaultValue: "Available templates",
                    })}
              </span>
              <span className="tabular-nums">
                {t("documents.templatePicker.count", {
                  defaultValue: "{{count}} templates",
                  count: templates.length,
                })}
              </span>
            </div>
            <ul
              aria-label={t("documents.templatePicker.availableTextTemplates", {
                defaultValue: "Available text templates",
              })}
              className="space-y-2"
            >
              {templates.map((template) => (
                <li key={template.id}>
                  <button
                    type="button"
                    aria-label={t("documents.templatePicker.insertNamed", {
                      defaultValue: "Insert {{name}}",
                      name: template.name,
                    })}
                    aria-description={template.preview.excerpt}
                    className="group/template flex w-full items-stretch gap-3 rounded-xl border border-border/70 bg-background p-3 text-left outline-none transition-[border-color,box-shadow,background-color] hover:border-primary/35 hover:bg-primary/[0.025] hover:shadow-sm focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/20"
                    onClick={() => insertTemplate(template.id)}
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-20 w-14 shrink-0 flex-col gap-1.5 overflow-hidden rounded-md border border-border/80 bg-muted/10 px-1.5 py-2 text-foreground/65 shadow-xs transition-transform motion-safe:group-hover/template:-rotate-3"
                    >
                      <span className="line-clamp-2 text-[6px] leading-[1.4] font-semibold">
                        {template.preview.heading || template.name}
                      </span>
                      <span className="line-clamp-6 text-[5px] leading-[1.65]">
                        {template.preview.excerpt}
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="flex items-start justify-between gap-2">
                        <span className="line-clamp-2 text-xs leading-relaxed font-medium break-words text-foreground">
                          {template.name}
                        </span>
                        <span className="shrink-0 rounded-md bg-muted/70 px-1.5 py-0.5 text-[10px] leading-4 font-medium text-muted-foreground">
                          {t(
                            `documents.templatePicker.kind.${template.preview.kind.toLowerCase()}`,
                            { defaultValue: template.preview.kind },
                          )}
                        </span>
                      </span>
                      <span className="line-clamp-2 text-[11px] leading-relaxed break-words text-muted-foreground">
                        {template.preview.excerpt}
                      </span>
                      <span className="mt-auto inline-flex items-center gap-1 pt-0.5 text-[11px] font-medium text-primary">
                        {t("documents.templatePicker.insert", {
                          defaultValue: "Insert",
                        })}{" "}
                        <ArrowRight
                          aria-hidden="true"
                          className="size-3 transition-transform motion-safe:group-hover/template:translate-x-0.5"
                        />
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-7 py-8 text-center">
            <span
              aria-hidden="true"
              className="grid size-12 place-items-center rounded-2xl bg-muted/60 text-muted-foreground"
            >
              {query ? (
                <Search className="size-5" />
              ) : (
                <FileText className="size-5" />
              )}
            </span>
            <p role="status" className="text-sm font-medium">
              {query
                ? t("documents.templatePicker.noMatch", {
                    defaultValue: "No matching text templates.",
                  })
                : t("documents.templatePicker.empty", {
                    defaultValue:
                      "No text templates are available for this company.",
                  })}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {query
                ? t("documents.templatePicker.tryDifferent", {
                    defaultValue: "Try a different template name.",
                  })
                : t("documents.templatePicker.emptyHint", {
                    defaultValue:
                      "Reusable text templates from Documents will appear here.",
                  })}
            </p>
            {!query && source.managementHref ? (
              <a
                href={source.managementHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border bg-background px-3 text-xs font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                {t("documents.templatePicker.manage", {
                  defaultValue: "Create or manage templates",
                })}
                <ArrowRight aria-hidden="true" className="size-3.5" />
                <span className="sr-only">
                  {t("documents.templatePicker.newTab", {
                    defaultValue:
                      "Opens in a new tab so your current text is kept.",
                  })}
                </span>
              </a>
            ) : null}
          </div>
        )}
        {insertionError ? (
          <div className="mx-3 mb-3 flex items-start gap-2 rounded-xl border border-destructive/15 bg-destructive/5 p-3">
            <AlertCircle
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0 text-destructive"
            />
            <p
              role="alert"
              className="text-xs leading-relaxed text-destructive"
            >
              {insertionError}
            </p>
          </div>
        ) : null}
        <div className="flex shrink-0 items-center gap-2 border-t border-border/70 bg-muted/20 px-4 py-2.5 text-[11px] text-muted-foreground">
          <TextCursorInput aria-hidden="true" className="size-3.5 shrink-0" />
          <span>
            {targetRef.current?.selection.empty
              ? t("documents.templatePicker.atCursor", {
                  defaultValue: "Insert at your cursor",
                })
              : t("documents.templatePicker.replaceSelected", {
                  defaultValue: "Replace selected text",
                })}
            <span aria-hidden="true" className="mx-1.5 opacity-50">
              ·
            </span>
            {t("documents.templatePicker.keepEditingAfterInsertion", {
              defaultValue: "Keep editing after insertion",
            })}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function RichTextTemplatePicker(props: RichTextTemplatePickerProps) {
  const source = useRichTextTemplates()
  if (!source) return null

  // Closing on scope/disabled changes also discards the captured selection and
  // any template option left open for the previous company or editability state.
  return (
    <ScopedTemplatePicker
      key={`${source.scopeKey}:${props.disabled}`}
      {...props}
      source={source}
    />
  )
}

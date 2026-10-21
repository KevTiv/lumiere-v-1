"use client"

import * as React from "react"
import type { Editor } from "@tiptap/react"
import { closeHistory } from "@tiptap/pm/history"
import { DOMParser, type Node as ProseMirrorNode } from "@tiptap/pm/model"
import type { Selection } from "@tiptap/pm/state"
import { LayoutTemplate, Search } from "lucide-react"

import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger
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

function ScopedTemplatePicker({
  editor,
  disabled,
  maxLength,
  source
}: RichTextTemplatePickerProps & { source: TemplateSource }) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const [insertionError, setInsertionError] = React.useState<string>()
  const targetRef = React.useRef<InsertionTarget | null>(null)
  const insertedRef = React.useRef(false)
  const searchRef = React.useRef<HTMLInputElement>(null)
  const query = search.trim().toLocaleLowerCase()
  const templates = source.templates.filter((template) =>
    template.name.toLocaleLowerCase().includes(query)
  )

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      if (disabled || editor.isDestroyed || !editor.isEditable) return
      targetRef.current = {
        doc: editor.state.doc,
        selection: editor.state.selection
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
        "This template is no longer available. Reopen templates to try again."
      )
      return
    }
    if (editor.state.doc !== target.doc) {
      setInsertionError(
        "The text changed while templates were open. Reopen templates to choose where to insert."
      )
      return
    }

    try {
      const container = document.createElement("div")
      container.innerHTML = sanitizeRichTextTemplateHtml(template.html)
      const content = DOMParser.fromSchema(editor.schema).parseSlice(container)
      if (!content.content.size) {
        setInsertionError(
          "This template has no supported text content to insert."
        )
        return
      }

      // Build and validate the entire edit before dispatching. CharacterCount's
      // paste handling can truncate content, which is unsuitable for templates.
      const transaction = editor.state.tr
        .setSelection(target.selection)
        .replaceSelection(content)
      const count = editor.storage.characterCount.characters({
        node: transaction.doc
      })
      if (maxLength !== undefined && maxLength >= 0 && count > maxLength) {
        setInsertionError(
          `This template would exceed the ${maxLength}-character limit. Shorten the text or choose another template.`
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
        "This template could not be inserted. Choose another template."
      )
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Insert text template"
            title="Insert text template"
            disabled={disabled}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-40 sm:h-7"
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
          >
            <LayoutTemplate className="size-4 sm:size-3.5" />
            Templates
          </button>
        }
      />
      <PopoverContent
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)]"
        initialFocus={searchRef}
        finalFocus={() =>
          insertedRef.current && !editor.isDestroyed ? editor.view.dom : true
        }
      >
        <div className="space-y-1">
          <PopoverTitle>Text templates</PopoverTitle>
          <PopoverDescription className="text-xs">
            Insert reusable text at your selection.
          </PopoverDescription>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-input px-2">
          <Search
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <input
            ref={searchRef}
            type="search"
            aria-label="Search text templates"
            placeholder="Search templates"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        {source.status === "idle" || source.status === "loading" ? (
          <p
            role="status"
            className="py-3 text-center text-xs text-muted-foreground"
          >
            Loading templates…
          </p>
        ) : source.status === "error" ? (
          <div className="space-y-2 py-2">
            <p role="alert" className="text-xs text-destructive">
              {source.error ?? "Templates could not be loaded."}
            </p>
            <button
              type="button"
              className="text-xs underline"
              onClick={source.onRequest}
            >
              Retry
            </button>
          </div>
        ) : templates.length ? (
          <ul
            aria-label="Available text templates"
            className="max-h-64 space-y-1 overflow-y-auto"
          >
            {templates.map((template) => (
              <li key={template.id}>
                <button
                  type="button"
                  aria-label={`Insert ${template.name}`}
                  className="w-full rounded-md px-2 py-2 text-left text-sm break-words outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30"
                  onClick={() => insertTemplate(template.id)}
                >
                  {template.name}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p
            role="status"
            className="py-3 text-center text-xs text-muted-foreground"
          >
            {query
              ? "No matching text templates."
              : "No text templates are available for this company."}
          </p>
        )}
        {insertionError ? (
          <p role="alert" className="text-xs text-destructive">
            {insertionError}
          </p>
        ) : null}
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

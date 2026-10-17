"use client"

import * as React from "react"
import {
  Bold,
  Code2,
  Heading2,
  Italic,
  Link,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from "lucide-react"

import { cn } from "@lumiere/ui/lib/utils"

type TextareaProps = React.ComponentProps<"textarea">

type ToolbarButtonProps = {
  label: string
  shortcut?: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}

function ToolbarButton({
  label,
  shortcut,
  disabled,
  onClick,
  children,
}: ToolbarButtonProps) {
  const title = shortcut ? `${label} (${shortcut})` : label

  return (
    <button
      type="button"
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5"
      aria-label={label}
      title={title}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function ToolbarDivider() {
  return <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border" />
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") {
    ref(value)
    return
  }

  if (ref) {
    ref.current = value
  }
}

/**
 * A Jira-inspired rich text panel that preserves the native textarea contract.
 * Formatting is stored as Markdown, so existing forms continue to submit a
 * plain string and callers can keep using native textarea props and refs.
 */
function Textarea({
  className,
  disabled,
  readOnly,
  ref,
  onKeyDown,
  ...props
}: TextareaProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const editorDisabled = disabled || readOnly

  const setTextareaRef = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node
      assignRef(ref, node)
    },
    [ref]
  )

  const replaceSelection = React.useCallback(
    (
      replacement: string,
      selectionStart: number,
      selectionEnd: number
    ) => {
      const textarea = textareaRef.current
      if (!textarea || editorDisabled) return

      const start = textarea.selectionStart
      const end = textarea.selectionEnd

      textarea.setRangeText(replacement, start, end, "end")
      textarea.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: replacement,
        })
      )

      textarea.focus()
      textarea.setSelectionRange(start + selectionStart, start + selectionEnd)
    },
    [editorDisabled]
  )

  const wrapSelection = React.useCallback(
    (before: string, after: string, placeholder: string) => {
      const textarea = textareaRef.current
      if (!textarea) return

      const selected = textarea.value.slice(
        textarea.selectionStart,
        textarea.selectionEnd
      )
      const content = selected || placeholder
      const replacement = `${before}${content}${after}`
      replaceSelection(
        replacement,
        before.length,
        before.length + content.length
      )
    },
    [replaceSelection]
  )

  const prefixSelectedLines = React.useCallback(
    (prefix: string | ((index: number) => string), placeholder: string) => {
      const textarea = textareaRef.current
      if (!textarea) return

      const value = textarea.value
      const selectionStart = textarea.selectionStart
      const selectionEnd = textarea.selectionEnd
      const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1
      const nextLineBreak = value.indexOf("\n", selectionEnd)
      const lineEnd = nextLineBreak === -1 ? value.length : nextLineBreak
      const selectedBlock = value.slice(lineStart, lineEnd) || placeholder
      const replacement = selectedBlock
        .split("\n")
        .map((line, index) => {
          const linePrefix = typeof prefix === "function" ? prefix(index) : prefix
          return `${linePrefix}${line}`
        })
        .join("\n")

      textarea.setSelectionRange(lineStart, lineEnd)
      replaceSelection(replacement, 0, replacement.length)
    },
    [replaceSelection]
  )

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      onKeyDown?.(event)
      if (
        event.defaultPrevented ||
        editorDisabled ||
        !(event.metaKey || event.ctrlKey)
      ) {
        return
      }

      const key = event.key.toLowerCase()
      if (key === "b") {
        event.preventDefault()
        wrapSelection("**", "**", "bold text")
      } else if (key === "i") {
        event.preventDefault()
        wrapSelection("_", "_", "italic text")
      } else if (key === "k") {
        event.preventDefault()
        wrapSelection("[", "](https://)", "link text")
      }
    },
    [editorDisabled, onKeyDown, wrapSelection]
  )

  return (
    <div
      data-slot="rich-text-panel"
      className="group/rich-text w-full overflow-hidden rounded-lg border border-input bg-background shadow-xs transition-[border-color,box-shadow,background-color] duration-150 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20 has-disabled:cursor-not-allowed has-disabled:bg-input/30 has-disabled:opacity-60 has-[[aria-invalid=true]]:border-destructive has-[[aria-invalid=true]]:ring-3 has-[[aria-invalid=true]]:ring-destructive/20 dark:bg-input/20 dark:has-disabled:bg-input/50 dark:has-[[aria-invalid=true]]:border-destructive/50 dark:has-[[aria-invalid=true]]:ring-destructive/40"
    >
      <div
        role="toolbar"
        aria-label="Text formatting"
        className="flex min-h-9 items-center overflow-x-auto border-b border-border/70 bg-muted/30 px-1.5 py-1"
      >
        <ToolbarButton
          label="Heading"
          disabled={editorDisabled}
          onClick={() => prefixSelectedLines("## ", "Heading")}
        >
          <Heading2 />
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton
          label="Bold"
          shortcut="Ctrl+B"
          disabled={editorDisabled}
          onClick={() => wrapSelection("**", "**", "bold text")}
        >
          <Bold />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          shortcut="Ctrl+I"
          disabled={editorDisabled}
          onClick={() => wrapSelection("_", "_", "italic text")}
        >
          <Italic />
        </ToolbarButton>
        <ToolbarButton
          label="Strikethrough"
          disabled={editorDisabled}
          onClick={() => wrapSelection("~~", "~~", "strikethrough text")}
        >
          <Strikethrough />
        </ToolbarButton>
        <ToolbarButton
          label="Inline code"
          disabled={editorDisabled}
          onClick={() => wrapSelection("`", "`", "code")}
        >
          <Code2 />
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton
          label="Bulleted list"
          disabled={editorDisabled}
          onClick={() => prefixSelectedLines("- ", "List item")}
        >
          <List />
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          disabled={editorDisabled}
          onClick={() =>
            prefixSelectedLines((index) => `${index + 1}. `, "List item")
          }
        >
          <ListOrdered />
        </ToolbarButton>
        <ToolbarButton
          label="Quote"
          disabled={editorDisabled}
          onClick={() => prefixSelectedLines("> ", "Quote")}
        >
          <Quote />
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton
          label="Link"
          shortcut="Ctrl+K"
          disabled={editorDisabled}
          onClick={() => wrapSelection("[", "](https://)", "link text")}
        >
          <Link />
        </ToolbarButton>
        <span className="ml-auto hidden shrink-0 px-2 text-[10px] font-medium tracking-wide text-muted-foreground/80 uppercase sm:inline">
          Markdown
        </span>
      </div>

      <textarea
        ref={setTextareaRef}
        data-slot="textarea"
        className={cn(
          "flex field-sizing-content min-h-24 w-full resize-y border-0 bg-transparent px-3 py-2.5 text-base leading-6 outline-none placeholder:text-muted-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:bg-transparent disabled:opacity-100 md:text-sm",
          className
        )}
        disabled={disabled}
        readOnly={readOnly}
        onKeyDown={handleKeyDown}
        {...props}
      />
    </div>
  )
}

export { Textarea }

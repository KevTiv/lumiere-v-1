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

import {
  markdownToRichTextHtml,
  richTextElementToMarkdown,
} from "./rich-text-markdown"
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

function setNativeTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  )?.set
  valueSetter?.call(textarea, value)
  textarea.dispatchEvent(new Event("input", { bubbles: true }))
}

function selectionBelongsTo(editor: HTMLElement) {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return false
  const range = selection.getRangeAt(0)
  return editor.contains(range.commonAncestorContainer)
}

function fallbackInlineFormat(editor: HTMLElement, tagName: string, placeholder: string) {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !selectionBelongsTo(editor)) return

  const range = selection.getRangeAt(0)
  const element = document.createElement(tagName)
  if (range.collapsed) {
    element.textContent = placeholder
  } else {
    element.append(range.extractContents())
  }
  range.insertNode(element)
  range.selectNodeContents(element)
  selection.removeAllRanges()
  selection.addRange(range)
}

/**
 * Jira-inspired visual rich-text editing with a native textarea form bridge.
 * Users see formatted content while forms continue to store and submit Markdown.
 */
function Textarea({
  className,
  disabled,
  readOnly,
  ref,
  onBlur,
  onFocus,
  onInvalid,
  onKeyDown,
  autoFocus,
  id,
  placeholder,
  maxLength,
  rows,
  style,
  value,
  defaultValue,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  ...props
}: TextareaProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const editorRef = React.useRef<HTMLDivElement | null>(null)
  const isControlled = value !== undefined
  const [uncontrolledValue, setUncontrolledValue] = React.useState(() =>
    String(defaultValue ?? "")
  )
  const [labelDerivedEditorName, setLabelDerivedEditorName] = React.useState<
    string | undefined
  >()
  const markdownValue = isControlled ? String(value ?? "") : uncontrolledValue
  const lastEditorValue = React.useRef(markdownValue)
  const editorDisabled = Boolean(disabled || readOnly)

  const setTextareaRef = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node
      assignRef(ref, node)
    },
    [ref]
  )

  React.useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor || markdownValue === lastEditorValue.current) return
    editor.innerHTML = markdownToRichTextHtml(markdownValue)
    lastEditorValue.current = markdownValue
  }, [markdownValue])

  React.useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.innerHTML = markdownToRichTextHtml(markdownValue)
  }, []) // Initial DOM hydration only; later values are handled above.

  React.useEffect(() => {
    if (autoFocus) editorRef.current?.focus()
  }, [autoFocus])

  React.useLayoutEffect(() => {
    if (ariaLabel || ariaLabelledBy) return
    const labelText = textareaRef.current?.labels?.[0]?.textContent?.trim()
    setLabelDerivedEditorName(
      labelText ? `${labelText} rich text editor` : undefined
    )
  }, [ariaLabel, ariaLabelledBy, id])

  const limitMarkdown = React.useCallback(
    (nextValue: string) =>
      maxLength === undefined ? nextValue : nextValue.slice(0, maxLength),
    [maxLength]
  )

  const syncFormValue = React.useCallback(() => {
    const editor = editorRef.current
    const textarea = textareaRef.current
    if (!editor || !textarea) return ""

    const serializedValue = richTextElementToMarkdown(editor)
    const nextValue = limitMarkdown(serializedValue)
    if (nextValue !== serializedValue) {
      editor.innerHTML = markdownToRichTextHtml(nextValue)
    }
    lastEditorValue.current = nextValue
    if (!isControlled) setUncontrolledValue(nextValue)
    setNativeTextareaValue(textarea, nextValue)
    return nextValue
  }, [isControlled, limitMarkdown])

  React.useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    // Preserve the practical `.value` contract used by form helpers while the
    // contenteditable surface owns the visible editing experience.
    Object.defineProperty(editor, "value", {
      configurable: true,
      get: () => textareaRef.current?.value ?? richTextElementToMarkdown(editor),
      set: (rawValue: unknown) => {
        const nextValue = limitMarkdown(String(rawValue ?? ""))
        editor.innerHTML = markdownToRichTextHtml(nextValue)
        lastEditorValue.current = nextValue
        if (!isControlled) setUncontrolledValue(nextValue)
        if (textareaRef.current) {
          setNativeTextareaValue(textareaRef.current, nextValue)
        }
      },
    })

    return () => {
      delete (editor as HTMLElement & { value?: string }).value
    }
  }, [isControlled, limitMarkdown])

  const runCommand = React.useCallback(
    (
      command: string,
      value?: string,
      fallback?: () => void
    ) => {
      const editor = editorRef.current
      if (!editor || editorDisabled) return

      editor.focus()
      const commandSupported = typeof document.execCommand === "function"
      const applied = commandSupported
        ? document.execCommand(command, false, value)
        : false
      if (!applied) fallback?.()
      syncFormValue()
    },
    [editorDisabled, syncFormValue]
  )

  const formatInline = React.useCallback(
    (command: string, tagName: string, placeholder: string) => {
      runCommand(command, undefined, () => {
        const editor = editorRef.current
        if (editor) fallbackInlineFormat(editor, tagName, placeholder)
      })
    },
    [runCommand]
  )

  const handleEditorBlur = React.useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const nextValue = syncFormValue()
      const editor = editorRef.current
      if (editor) {
        editor.innerHTML = markdownToRichTextHtml(nextValue)
      }
      onBlur?.(event as unknown as React.FocusEvent<HTMLTextAreaElement>)
    },
    [onBlur, syncFormValue]
  )

  const handleEditorKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event as unknown as React.KeyboardEvent<HTMLTextAreaElement>)
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
        formatInline("bold", "strong", "bold text")
      } else if (key === "i") {
        event.preventDefault()
        formatInline("italic", "em", "italic text")
      } else if (key === "k") {
        event.preventDefault()
        const href = window.prompt("Link URL", "https://")
        if (href) runCommand("createLink", href)
      }
    },
    [editorDisabled, formatInline, onKeyDown, runCommand]
  )

  const handleLink = React.useCallback(() => {
    const href = window.prompt("Link URL", "https://")
    if (href) runCommand("createLink", href)
  }, [runCommand])

  const editorMinHeight = rows ? `${Math.max(rows, 3) * 24 + 20}px` : undefined

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
          onClick={() => runCommand("formatBlock", "h2")}
        >
          <Heading2 />
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton
          label="Bold"
          shortcut="Ctrl+B"
          disabled={editorDisabled}
          onClick={() => formatInline("bold", "strong", "bold text")}
        >
          <Bold />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          shortcut="Ctrl+I"
          disabled={editorDisabled}
          onClick={() => formatInline("italic", "em", "italic text")}
        >
          <Italic />
        </ToolbarButton>
        <ToolbarButton
          label="Strikethrough"
          disabled={editorDisabled}
          onClick={() => formatInline("strikeThrough", "s", "strikethrough text")}
        >
          <Strikethrough />
        </ToolbarButton>
        <ToolbarButton
          label="Inline code"
          disabled={editorDisabled}
          onClick={() => formatInline("inlineCode", "code", "code")}
        >
          <Code2 />
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton
          label="Bulleted list"
          disabled={editorDisabled}
          onClick={() => runCommand("insertUnorderedList")}
        >
          <List />
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          disabled={editorDisabled}
          onClick={() => runCommand("insertOrderedList")}
        >
          <ListOrdered />
        </ToolbarButton>
        <ToolbarButton
          label="Quote"
          disabled={editorDisabled}
          onClick={() => runCommand("formatBlock", "blockquote")}
        >
          <Quote />
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton
          label="Link"
          shortcut="Ctrl+K"
          disabled={editorDisabled}
          onClick={handleLink}
        >
          <Link />
        </ToolbarButton>
        <span className="ml-auto hidden shrink-0 px-2 text-[10px] font-medium tracking-wide text-muted-foreground/80 uppercase sm:inline">
          Rich text
        </span>
      </div>

      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel ?? labelDerivedEditorName}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-required={props.required}
        data-slot="rich-text-editor"
        data-placeholder={placeholder}
        contentEditable={!editorDisabled}
        suppressContentEditableWarning
        className={cn(
          "min-h-24 w-full overflow-y-auto border-0 bg-transparent px-3 py-2.5 text-base leading-6 outline-none empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)] [&_a]:text-primary [&_a]:underline [&_blockquote]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h2]:my-1 [&_h2]:text-lg [&_h2]:font-semibold [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:min-h-6 [&_s]:text-muted-foreground [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-6 md:text-sm",
          editorDisabled && "cursor-not-allowed",
          className
        )}
        style={{ minHeight: editorMinHeight, ...style }}
        onInput={syncFormValue}
        onBlur={handleEditorBlur}
        onFocus={(event) =>
          onFocus?.(event as unknown as React.FocusEvent<HTMLTextAreaElement>)
        }
        onKeyDown={handleEditorKeyDown}
      />

      <textarea
        ref={setTextareaRef}
        id={id}
        data-slot="textarea"
        className="sr-only"
        aria-hidden="true"
        disabled={disabled}
        readOnly={readOnly}
        tabIndex={-1}
        value={value}
        defaultValue={defaultValue}
        autoFocus={false}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={rows}
        onFocus={() => editorRef.current?.focus()}
        onInvalid={(event) => {
          editorRef.current?.focus()
          onInvalid?.(event)
        }}
        {...props}
      />
    </div>
  )
}

export { Textarea }

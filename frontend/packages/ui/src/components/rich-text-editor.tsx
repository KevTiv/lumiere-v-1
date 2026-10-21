"use client"

import * as React from "react"
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react"
import {
  Bold,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Redo2,
  SquareCode,
  Strikethrough,
  Table as TableIcon,
  Undo2,
  Unlink,
} from "lucide-react"

import { cn } from "@lumiere/ui/lib/utils"
import {
  createRichTextExtensions,
  richTextContentClassName,
  serializeRichTextMarkdown,
} from "@lumiere/ui/lib/rich-text-extensions"
import { Popover, PopoverContent, PopoverTrigger } from "@lumiere/ui/components/popover"
import { RichTextTemplatePicker } from "@lumiere/ui/components/rich-text-template-picker"

type RichTextEditorProps = {
  /** Controlled Markdown value. */
  value?: string
  /** Initial Markdown when uncontrolled. */
  defaultValue?: string
  onValueChange?: (markdown: string) => void
  onFocus?: () => void
  onBlur?: () => void
  /** Return `true` to stop the editor handling the key (e.g. submit shortcuts). */
  onKeyDown?: (event: KeyboardEvent) => boolean
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  autoFocus?: boolean
  maxLength?: number
  /** Minimum visible lines, mirrors the textarea `rows` attribute. */
  rows?: number
  id?: string
  /** Test id placed on the editable surface (Playwright `fill` works on it). */
  testId?: string
  className?: string
  contentClassName?: string
  /** Accessibility attributes applied to the editable surface. */
  ariaAttributes?: React.AriaAttributes
  editorAttributes?: Record<string, string>
  /** Escape hatch for wrappers that need the Tiptap instance. */
  onEditorReady?: (editor: Editor | null) => void
}

const LINE_HEIGHT_REM = 1.5
const VERTICAL_PADDING_REM = 1.25

type ToolbarButtonProps = {
  label: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  children: React.ReactNode
} & Omit<React.ComponentProps<"button">, "onClick">

function ToolbarButton({
  label,
  shortcut,
  active,
  disabled,
  onClick,
  children,
  className,
  ...props
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-muted aria-pressed:text-foreground sm:size-7 [&_svg]:size-4 sm:[&_svg]:size-3.5",
        className
      )}
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  )
}

function ToolbarDivider() {
  return <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border" />
}

function normalizeHref(raw: string): string {
  const href = raw.trim()
  if (!href) return ""
  if (/^(https?:|mailto:|tel:|\/|#)/i.test(href)) return href
  return `https://${href}`
}

function LinkControl({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const [open, setOpen] = React.useState(false)
  const [href, setHref] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)
  const isActive = editor.isActive("link")

  const apply = () => {
    const next = normalizeHref(href)
    const chain = editor.chain().focus().extendMarkRange("link")
    if (!next) {
      chain.unsetLink().run()
    } else if (editor.state.selection.empty && !isActive) {
      editor
        .chain()
        .focus()
        .insertContent({ type: "text", text: href.trim(), marks: [{ type: "link", attrs: { href: next } }] })
        .run()
    } else {
      chain.setLink({ href: next }).run()
    }
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setHref(editor.getAttributes("link").href ?? "")
        setOpen(nextOpen)
      }}
    >
      <PopoverTrigger
        render={
          <ToolbarButton label="Link" active={isActive} disabled={disabled}>
            <LinkIcon />
          </ToolbarButton>
        }
      />
      <PopoverContent align="start" className="w-80" initialFocus={inputRef}>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            apply()
          }}
        >
          <input
            ref={inputRef}
            aria-label="Link URL"
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
            placeholder="https://"
            value={href}
            onChange={(event) => setHref(event.target.value)}
          />
          <button
            type="submit"
            className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Apply
          </button>
          {isActive ? (
            <ToolbarButton
              label="Remove link"
              onClick={() => {
                editor.chain().focus().extendMarkRange("link").unsetLink().run()
                setOpen(false)
              }}
            >
              <Unlink />
            </ToolbarButton>
          ) : null}
        </form>
      </PopoverContent>
    </Popover>
  )
}

function RichTextToolbar({
  editor,
  disabled,
  maxLength,
}: {
  editor: Editor
  disabled: boolean
  maxLength?: number
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      h1: current.isActive("heading", { level: 1 }),
      h2: current.isActive("heading", { level: 2 }),
      h3: current.isActive("heading", { level: 3 }),
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      strike: current.isActive("strike"),
      code: current.isActive("code"),
      codeBlock: current.isActive("codeBlock"),
      bulletList: current.isActive("bulletList"),
      orderedList: current.isActive("orderedList"),
      taskList: current.isActive("taskList"),
      blockquote: current.isActive("blockquote"),
      table: current.isActive("table"),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  })

  const chain = () => editor.chain().focus()

  return (
    <div
      role="toolbar"
      aria-label="Text formatting"
      className="flex min-h-9 items-center overflow-x-auto border-b border-border/70 bg-muted/30 px-1.5 py-1"
    >
      <RichTextTemplatePicker
        editor={editor}
        disabled={disabled}
        maxLength={maxLength}
      />
      <ToolbarButton label="Heading 1" active={state.h1} disabled={disabled} onClick={() => chain().toggleHeading({ level: 1 }).run()}>
        <Heading1 />
      </ToolbarButton>
      <ToolbarButton label="Heading 2" active={state.h2} disabled={disabled} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
        <Heading2 />
      </ToolbarButton>
      <ToolbarButton label="Heading 3" active={state.h3} disabled={disabled} onClick={() => chain().toggleHeading({ level: 3 }).run()}>
        <Heading3 />
      </ToolbarButton>
      <ToolbarDivider />
      <ToolbarButton label="Bold" shortcut="Ctrl+B" active={state.bold} disabled={disabled} onClick={() => chain().toggleBold().run()}>
        <Bold />
      </ToolbarButton>
      <ToolbarButton label="Italic" shortcut="Ctrl+I" active={state.italic} disabled={disabled} onClick={() => chain().toggleItalic().run()}>
        <Italic />
      </ToolbarButton>
      <ToolbarButton label="Strikethrough" active={state.strike} disabled={disabled} onClick={() => chain().toggleStrike().run()}>
        <Strikethrough />
      </ToolbarButton>
      <ToolbarButton label="Inline code" active={state.code} disabled={disabled} onClick={() => chain().toggleCode().run()}>
        <Code2 />
      </ToolbarButton>
      <ToolbarDivider />
      <ToolbarButton label="Bulleted list" active={state.bulletList} disabled={disabled} onClick={() => chain().toggleBulletList().run()}>
        <List />
      </ToolbarButton>
      <ToolbarButton label="Numbered list" active={state.orderedList} disabled={disabled} onClick={() => chain().toggleOrderedList().run()}>
        <ListOrdered />
      </ToolbarButton>
      <ToolbarButton label="Checklist" active={state.taskList} disabled={disabled} onClick={() => chain().toggleTaskList().run()}>
        <ListChecks />
      </ToolbarButton>
      <ToolbarButton label="Quote" active={state.blockquote} disabled={disabled} onClick={() => chain().toggleBlockquote().run()}>
        <Quote />
      </ToolbarButton>
      <ToolbarButton label="Code block" active={state.codeBlock} disabled={disabled} onClick={() => chain().toggleCodeBlock().run()}>
        <SquareCode />
      </ToolbarButton>
      <ToolbarDivider />
      <LinkControl editor={editor} disabled={disabled} />
      <ToolbarButton
        label={state.table ? "Delete table" : "Insert table"}
        active={state.table}
        disabled={disabled}
        onClick={() =>
          state.table
            ? chain().deleteTable().run()
            : chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
      >
        <TableIcon />
      </ToolbarButton>
      <span className="ml-auto flex shrink-0 items-center">
        <ToolbarButton label="Undo" shortcut="Ctrl+Z" disabled={disabled || !state.canUndo} onClick={() => chain().undo().run()}>
          <Undo2 />
        </ToolbarButton>
        <ToolbarButton label="Redo" shortcut="Ctrl+Shift+Z" disabled={disabled || !state.canRedo} onClick={() => chain().redo().run()}>
          <Redo2 />
        </ToolbarButton>
      </span>
    </div>
  )
}

function CharacterCounter({ editor, maxLength }: { editor: Editor; maxLength: number }) {
  const count = useEditorState({
    editor,
    selector: ({ editor: current }) => current.storage.characterCount.characters() as number,
  })
  return (
    <div
      aria-live="polite"
      className={cn(
        "px-3 pb-1.5 text-right text-[11px] tabular-nums text-muted-foreground",
        count >= maxLength && "text-destructive"
      )}
    >
      {count}/{maxLength}
    </div>
  )
}

/**
 * Tiptap-backed rich text editor. Content goes in and comes out as Markdown so
 * it stays compatible with every string column it is bound to.
 */
function RichTextEditor({
  value,
  defaultValue,
  onValueChange,
  onFocus,
  onBlur,
  onKeyDown,
  placeholder,
  disabled = false,
  readOnly = false,
  autoFocus = false,
  maxLength,
  rows = 3,
  id,
  testId,
  className,
  contentClassName,
  ariaAttributes,
  editorAttributes,
  onEditorReady,
}: RichTextEditorProps) {
  const editable = !disabled && !readOnly
  const lastEmitted = React.useRef<string>(value ?? defaultValue ?? "")
  const callbacks = React.useRef({ onValueChange, onFocus, onBlur, onKeyDown })
  callbacks.current = { onValueChange, onFocus, onBlur, onKeyDown }

  const extensions = React.useMemo(
    () => createRichTextExtensions({ placeholder, maxLength }),
    [placeholder, maxLength]
  )

  const attributes = React.useMemo(() => {
    const attrs: Record<string, string> = {
      class: cn("min-w-0 px-3 py-2.5 outline-none", richTextContentClassName, contentClassName),
      role: "textbox",
      "aria-multiline": "true",
      style: `min-height: ${rows * LINE_HEIGHT_REM + VERTICAL_PADDING_REM}rem`,
    }
    Object.assign(attrs, editorAttributes)
    if (id) attrs.id = id
    if (testId) attrs["data-testid"] = testId
    if (readOnly) attrs["aria-readonly"] = "true"
    if (disabled) attrs["aria-disabled"] = "true"
    for (const [key, attrValue] of Object.entries(ariaAttributes ?? {})) {
      if (attrValue !== undefined && attrValue !== null) attrs[key] = String(attrValue)
    }
    return attrs
  }, [ariaAttributes, editorAttributes, contentClassName, disabled, id, readOnly, rows, testId])

  const editor = useEditor(
    {
      extensions,
      content: lastEmitted.current,
      contentType: "markdown",
      editable,
      autofocus: autoFocus ? "end" : false,
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes,
        handleKeyDown: (_view, event) => callbacks.current.onKeyDown?.(event) ?? false,
      },
      onUpdate: ({ editor: current }) => {
        const markdown = serializeRichTextMarkdown(current)
        if (markdown === lastEmitted.current) return
        lastEmitted.current = markdown
        callbacks.current.onValueChange?.(markdown)
      },
      onFocus: () => callbacks.current.onFocus?.(),
      onBlur: () => callbacks.current.onBlur?.(),
    },
    [extensions]
  )

  React.useEffect(() => {
    onEditorReady?.(editor)
  }, [editor, onEditorReady])

  React.useEffect(() => {
    if (!editor) return
    editor.setEditable(editable, false)
  }, [editor, editable])

  React.useEffect(() => {
    if (!editor) return
    editor.setOptions({
      editorProps: { ...editor.options.editorProps, attributes },
    })
  }, [editor, attributes])

  // Only resync from props when the value changed outside the editor, so the
  // caret does not jump while typing.
  React.useEffect(() => {
    if (!editor || value === undefined || value === lastEmitted.current) return
    lastEmitted.current = value
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false })
  }, [editor, value])

  return (
    <div
      data-slot="rich-text-panel"
      data-disabled={disabled || undefined}
      className={cn(
        "group/rich-text w-full overflow-hidden rounded-lg border border-input bg-background shadow-xs transition-[border-color,box-shadow,background-color] duration-150 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20 data-disabled:cursor-not-allowed data-disabled:bg-input/30 data-disabled:opacity-60 has-[[aria-invalid=true]]:border-destructive has-[[aria-invalid=true]]:ring-3 has-[[aria-invalid=true]]:ring-destructive/20 dark:bg-input/20 dark:data-disabled:bg-input/50 dark:has-[[aria-invalid=true]]:border-destructive/50 dark:has-[[aria-invalid=true]]:ring-destructive/40",
        className
      )}
    >
      {editor && !readOnly ? (
        <RichTextToolbar
          editor={editor}
          disabled={!editable}
          maxLength={maxLength}
        />
      ) : null}
      {editor ? (
        <EditorContent editor={editor} />
      ) : (
        <div
          aria-hidden="true"
          className={cn("px-3 py-2.5 whitespace-pre-wrap text-muted-foreground", richTextContentClassName)}
          style={{ minHeight: `${rows * LINE_HEIGHT_REM + VERTICAL_PADDING_REM}rem` }}
        >
          {value ?? defaultValue ?? placeholder}
        </div>
      )}
      {editor && maxLength && editable ? <CharacterCounter editor={editor} maxLength={maxLength} /> : null}
    </div>
  )
}

export { RichTextEditor }
export type { RichTextEditorProps }

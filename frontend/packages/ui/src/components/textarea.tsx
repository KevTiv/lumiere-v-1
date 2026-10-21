"use client"

import * as React from "react"
import { CodeNode } from "@lexical/code"
import { $toggleLink, LinkNode } from "@lexical/link"
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
} from "@lexical/list"
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from "@lexical/markdown"
import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin"
import { ListPlugin } from "@lexical/react/LexicalListPlugin"
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import { $setBlocksType } from "@lexical/selection"
import {
  $createHeadingNode,
  $createQuoteNode,
  HeadingNode,
  QuoteNode,
} from "@lexical/rich-text"
import {
  $createRangeSelectionFromDom,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  FORMAT_TEXT_COMMAND,
  SKIP_DOM_SELECTION_TAG,
  type EditorState,
  type LexicalEditor,
  type RangeSelection,
} from "lexical"
import {
  Bold,
  Check,
  Code2,
  Heading2,
  Italic,
  Link,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  X,
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

const EXTERNAL_VALUE_TAG = "lumiere-textarea-external-value"
const SAFE_LINK_PROTOCOL = /^(https?:|mailto:|tel:|\/|#)/i

const EDITOR_NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  LinkNode,
  CodeNode,
]

const EDITOR_THEME = {
  heading: {
    h2: "my-1 text-lg font-semibold",
  },
  link: "text-primary underline",
  list: {
    listitem: "min-h-6",
    ol: "my-1 list-decimal pl-6",
    ul: "my-1 list-disc pl-6",
  },
  quote: "my-1 border-l-2 border-border pl-3 text-muted-foreground",
  text: {
    bold: "font-semibold",
    code: "rounded bg-muted px-1 font-mono",
    italic: "italic",
    strikethrough: "text-muted-foreground line-through",
  },
}

function normalizeMarkdownForEditor(markdown: string) {
  return markdown
    .replace(/(^|[\s(])\*\*\s+([^*\n]+?)\s+\*\*/g, "$1**$2**")
    .replace(/(^|[\s(])~~\s+([^~\n]+?)\s+~~/g, "$1~~$2~~")
}

function normalizeLinkUrl(value: string) {
  const url = value.trim()
  if (!url) return null
  if (SAFE_LINK_PROTOCOL.test(url)) return url
  return `https://${url}`
}

function isSafeLinkUrl(value: string) {
  return SAFE_LINK_PROTOCOL.test(value)
}

function applyMarkdown(editor: LexicalEditor, markdown: string) {
  editor.update(
    () => {
      $convertFromMarkdownString(
        normalizeMarkdownForEditor(markdown),
        TRANSFORMERS
      )
    },
    { discrete: true, tag: EXTERNAL_VALUE_TAG }
  )
}

function focusLexicalEditor(editor: LexicalEditor) {
  editor.getRootElement()?.focus({ preventScroll: true })
}

function syncSelectionFromDom(editor: LexicalEditor) {
  const root = editor.getRootElement()
  const domSelection = root?.ownerDocument.defaultView?.getSelection() ?? null
  editor.update(
    () => {
      const nextSelection = $createRangeSelectionFromDom(domSelection, editor)
      if (nextSelection) $setSelection(nextSelection)
    },
    { discrete: true, tag: SKIP_DOM_SELECTION_TAG }
  )
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
      className="inline-flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-40 sm:size-7 [&_svg]:size-4 sm:[&_svg]:size-3.5"
      aria-label={label}
      title={title}
      disabled={disabled}
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function ToolbarDivider() {
  return (
    <span
      aria-hidden="true"
      className="mx-1 h-5 w-px shrink-0 bg-border sm:h-4"
    />
  )
}

function RichTextToolbar({ disabled }: { disabled: boolean }) {
  const [editor] = useLexicalComposerContext()
  const [linkEditorOpen, setLinkEditorOpen] = React.useState(false)
  const [linkUrl, setLinkUrl] = React.useState("https://")
  const savedSelectionRef = React.useRef<RangeSelection | null>(null)
  const linkInputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (linkEditorOpen) linkInputRef.current?.focus()
  }, [linkEditorOpen])

  const formatBlock = React.useCallback(
    (kind: "heading" | "quote") => {
      syncSelectionFromDom(editor)
      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
        $setBlocksType(selection, () =>
          kind === "heading" ? $createHeadingNode("h2") : $createQuoteNode()
        )
      })
      focusLexicalEditor(editor)
    },
    [editor]
  )

  const openLinkEditor = React.useCallback(() => {
    syncSelectionFromDom(editor)
    editor.getEditorState().read(() => {
      const selection = $getSelection()
      savedSelectionRef.current = $isRangeSelection(selection)
        ? selection.clone()
        : null
    })
    if (!savedSelectionRef.current) return
    setLinkEditorOpen(true)
  }, [editor])

  const closeLinkEditor = React.useCallback(() => {
    setLinkEditorOpen(false)
    setLinkUrl("https://")
    focusLexicalEditor(editor)
  }, [editor])

  const applyLink = React.useCallback(() => {
    const url = normalizeLinkUrl(linkUrl)
    const selection = savedSelectionRef.current
    if (!url || !selection) return

    editor.update(() => {
      $setSelection(selection.clone())
      $toggleLink(url, { rel: "noreferrer", target: "_blank" })
    })
    closeLinkEditor()
  }, [closeLinkEditor, editor, linkUrl])

  return (
    <div
      role="toolbar"
      aria-label="Text formatting"
      className="flex min-h-12 items-center gap-0.5 overflow-x-auto overscroll-x-contain border-b border-border/70 bg-muted/30 px-1.5 py-1 [-webkit-overflow-scrolling:touch] sm:min-h-9"
    >
      <ToolbarButton
        label="Heading"
        disabled={disabled}
        onClick={() => formatBlock("heading")}
      >
        <Heading2 />
      </ToolbarButton>
      <ToolbarDivider />
      <ToolbarButton
        label="Bold"
        shortcut="Ctrl+B"
        disabled={disabled}
        onClick={() => {
          syncSelectionFromDom(editor)
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")
          focusLexicalEditor(editor)
        }}
      >
        <Bold />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        shortcut="Ctrl+I"
        disabled={disabled}
        onClick={() => {
          syncSelectionFromDom(editor)
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")
          focusLexicalEditor(editor)
        }}
      >
        <Italic />
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough"
        disabled={disabled}
        onClick={() => {
          syncSelectionFromDom(editor)
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough")
          focusLexicalEditor(editor)
        }}
      >
        <Strikethrough />
      </ToolbarButton>
      <ToolbarButton
        label="Inline code"
        disabled={disabled}
        onClick={() => {
          syncSelectionFromDom(editor)
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code")
          focusLexicalEditor(editor)
        }}
      >
        <Code2 />
      </ToolbarButton>
      <ToolbarDivider />
      <ToolbarButton
        label="Bulleted list"
        disabled={disabled}
        onClick={() => {
          syncSelectionFromDom(editor)
          editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)
          focusLexicalEditor(editor)
        }}
      >
        <List />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        disabled={disabled}
        onClick={() => {
          syncSelectionFromDom(editor)
          editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)
          focusLexicalEditor(editor)
        }}
      >
        <ListOrdered />
      </ToolbarButton>
      <ToolbarButton
        label="Quote"
        disabled={disabled}
        onClick={() => formatBlock("quote")}
      >
        <Quote />
      </ToolbarButton>
      <ToolbarDivider />
      <ToolbarButton
        label="Link"
        shortcut="Ctrl+K"
        disabled={disabled}
        onClick={openLinkEditor}
      >
        <Link />
      </ToolbarButton>

      {linkEditorOpen ? (
        <form
          className="ml-1 flex shrink-0 items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            applyLink()
          }}
        >
          <input
            ref={linkInputRef}
            aria-label="Link URL"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            value={linkUrl}
            className="h-10 w-48 rounded-md border border-input bg-background px-2 text-base outline-none focus:ring-2 focus:ring-ring/30 sm:h-7 sm:text-xs"
            onChange={(event) => setLinkUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                closeLinkEditor()
              }
            }}
          />
          <button
            type="submit"
            aria-label="Apply link"
            className="inline-flex size-10 touch-manipulation items-center justify-center rounded-md hover:bg-muted sm:size-7"
          >
            <Check className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Cancel link"
            className="inline-flex size-10 touch-manipulation items-center justify-center rounded-md hover:bg-muted sm:size-7"
            onClick={closeLinkEditor}
          >
            <X className="size-4" />
          </button>
        </form>
      ) : (
        <span className="ml-auto hidden shrink-0 px-2 text-[10px] font-medium tracking-wide text-muted-foreground/80 uppercase sm:inline">
          Rich text
        </span>
      )}
    </div>
  )
}

function EditableStatePlugin({ editable }: { editable: boolean }) {
  const [editor] = useLexicalComposerContext()

  React.useLayoutEffect(() => {
    editor.setEditable(editable)
  }, [editable, editor])

  return null
}

type MarkdownBridgePluginProps = {
  isControlled: boolean
  markdownValue: string
  maxLength?: number
  rootRef: React.RefObject<HTMLDivElement | null>
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  lastEditorValue: React.RefObject<string>
  setUncontrolledValue: React.Dispatch<React.SetStateAction<string>>
}

function MarkdownBridgePlugin({
  isControlled,
  markdownValue,
  maxLength,
  rootRef,
  textareaRef,
  lastEditorValue,
  setUncontrolledValue,
}: MarkdownBridgePluginProps) {
  const [editor] = useLexicalComposerContext()

  const publishMarkdown = React.useCallback(
    (nextValue: string) => {
      lastEditorValue.current = nextValue
      if (!isControlled) setUncontrolledValue(nextValue)
      if (textareaRef.current) {
        setNativeTextareaValue(textareaRef.current, nextValue)
      }
    },
    [isControlled, lastEditorValue, setUncontrolledValue, textareaRef]
  )

  const handleChange = React.useCallback(
    (editorState: EditorState, _editor: LexicalEditor, tags: Set<string>) => {
      if (tags.has(EXTERNAL_VALUE_TAG)) return

      const nextValue = editorState.read(() =>
        $convertToMarkdownString(TRANSFORMERS)
      )
      if (maxLength !== undefined && nextValue.length > maxLength) {
        applyMarkdown(editor, lastEditorValue.current)
        return
      }
      if (nextValue !== lastEditorValue.current) publishMarkdown(nextValue)
    },
    [editor, lastEditorValue, maxLength, publishMarkdown]
  )

  React.useLayoutEffect(() => {
    if (markdownValue === lastEditorValue.current) return
    lastEditorValue.current = markdownValue
    applyMarkdown(editor, markdownValue)
  }, [editor, lastEditorValue, markdownValue])

  React.useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return

    Object.defineProperty(root, "value", {
      configurable: true,
      get: () => textareaRef.current?.value ?? lastEditorValue.current,
      set: (rawValue: unknown) => {
        const requestedValue = String(rawValue ?? "")
        const nextValue =
          maxLength === undefined
            ? requestedValue
            : requestedValue.slice(0, maxLength)
        lastEditorValue.current = nextValue
        if (!isControlled) setUncontrolledValue(nextValue)
        applyMarkdown(editor, nextValue)
        if (textareaRef.current) {
          setNativeTextareaValue(textareaRef.current, nextValue)
        }
      },
    })

    return () => {
      delete (root as HTMLDivElement & { value?: string }).value
    }
  }, [
    editor,
    isControlled,
    lastEditorValue,
    maxLength,
    rootRef,
    setUncontrolledValue,
    textareaRef,
  ])

  return <OnChangePlugin ignoreSelectionChange onChange={handleChange} />
}

function AutoFocusBridge() {
  const [editor] = useLexicalComposerContext()

  React.useEffect(() => {
    focusLexicalEditor(editor)
  }, [editor])

  return null
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") {
    ref(value)
    return
  }

  if (ref) ref.current = value
}

function setNativeTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  )?.set
  valueSetter?.call(textarea, value)
  textarea.dispatchEvent(new Event("input", { bubbles: true }))
}

/**
 * Jira-inspired rich-text editing backed by Lexical for reliable mobile IME,
 * selection, paste, and virtual-keyboard behavior. Forms still submit Markdown.
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
  inputMode,
  enterKeyHint,
  autoCapitalize,
  autoCorrect,
  spellCheck,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  ...props
}: TextareaProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const editorRootRef = React.useRef<HTMLDivElement | null>(null)
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
  const editorNamespace = React.useId()
  const editorMinHeight = rows ? `${Math.max(rows, 3) * 24 + 20}px` : undefined

  const [initialConfig] = React.useState(() => ({
    namespace: `LumiereTextarea-${editorNamespace}`,
    nodes: EDITOR_NODES,
    theme: EDITOR_THEME,
    editable: !editorDisabled,
    editorState: () => {
      $convertFromMarkdownString(
        normalizeMarkdownForEditor(markdownValue),
        TRANSFORMERS
      )
    },
    onError: (error: Error) => {
      throw error
    },
  }))

  const setTextareaRef = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node
      assignRef(ref, node)
    },
    [ref]
  )

  React.useLayoutEffect(() => {
    if (ariaLabel || ariaLabelledBy) return
    const labelText = textareaRef.current?.labels?.[0]?.textContent?.trim()
    setLabelDerivedEditorName(
      labelText ? `${labelText} rich text editor` : undefined
    )
  }, [ariaLabel, ariaLabelledBy, id])

  const focusEditor = React.useCallback(() => {
    const root = editorRootRef.current
    if (root) root.focus({ preventScroll: true })
  }, [])

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div
        data-slot="rich-text-panel"
        className="group/rich-text w-full overflow-hidden rounded-lg border border-input bg-background shadow-xs transition-[border-color,box-shadow,background-color] duration-150 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20 has-disabled:cursor-not-allowed has-disabled:bg-input/30 has-disabled:opacity-60 has-[[aria-invalid=true]]:border-destructive has-[[aria-invalid=true]]:ring-3 has-[[aria-invalid=true]]:ring-destructive/20 dark:bg-input/20 dark:has-disabled:bg-input/50 dark:has-[[aria-invalid=true]]:border-destructive/50 dark:has-[[aria-invalid=true]]:ring-destructive/40"
      >
        <RichTextToolbar disabled={editorDisabled} />
        <div className="relative">
          <RichTextPlugin
            ErrorBoundary={LexicalErrorBoundary}
            contentEditable={
              <ContentEditable
                ref={editorRootRef}
                aria-label={ariaLabel ?? labelDerivedEditorName}
                aria-labelledby={ariaLabelledBy}
                aria-describedby={ariaDescribedBy}
                aria-invalid={ariaInvalid}
                aria-multiline="true"
                aria-required={props.required}
                inputMode={inputMode}
                enterKeyHint={enterKeyHint}
                autoCapitalize={autoCapitalize}
                autoCorrect={autoCorrect}
                spellCheck={spellCheck ?? true}
                data-slot="rich-text-editor"
                className={cn(
                  "min-h-24 w-full overflow-y-auto border-0 bg-transparent px-3 py-2.5 text-base leading-6 outline-none md:text-sm",
                  editorDisabled && "cursor-not-allowed",
                  className
                )}
                style={{ minHeight: editorMinHeight, ...style }}
                onBlur={(event) =>
                  onBlur?.(
                    event as unknown as React.FocusEvent<HTMLTextAreaElement>
                  )
                }
                onFocus={(event) =>
                  onFocus?.(
                    event as unknown as React.FocusEvent<HTMLTextAreaElement>
                  )
                }
                onKeyDown={(event) =>
                  onKeyDown?.(
                    event as unknown as React.KeyboardEvent<HTMLTextAreaElement>
                  )
                }
              />
            }
            placeholder={
              placeholder ? (
                <div className="pointer-events-none absolute top-2.5 left-3 text-base text-muted-foreground md:text-sm">
                  {placeholder}
                </div>
              ) : null
            }
          />
        </div>

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
          inputMode={inputMode}
          enterKeyHint={enterKeyHint}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          spellCheck={spellCheck}
          onFocus={focusEditor}
          onInvalid={(event) => {
            focusEditor()
            onInvalid?.(event)
          }}
          {...props}
        />
      </div>

      <EditableStatePlugin editable={!editorDisabled} />
      <HistoryPlugin />
      <ListPlugin />
      <LinkPlugin
        validateUrl={isSafeLinkUrl}
        attributes={{ rel: "noreferrer", target: "_blank" }}
      />
      <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
      <MarkdownBridgePlugin
        isControlled={isControlled}
        markdownValue={markdownValue}
        maxLength={maxLength}
        rootRef={editorRootRef}
        textareaRef={textareaRef}
        lastEditorValue={lastEditorValue}
        setUncontrolledValue={setUncontrolledValue}
      />
      {autoFocus ? <AutoFocusBridge /> : null}
    </LexicalComposer>
  )
}

export { Textarea }

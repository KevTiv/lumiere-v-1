"use client"

import * as React from "react"
import type { Editor } from "@tiptap/react"

import { cn } from "@lumiere/ui/lib/utils"
import { RichTextEditor } from "@lumiere/ui/components/rich-text-editor"

type TextareaProps = React.ComponentProps<"textarea"> & {
  /**
   * `rich` (default) renders the Tiptap editor and stores Markdown.
   * `plain` renders a bare native textarea for raw HTML, code or JSON input.
   */
  variant?: "rich" | "plain"
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

function toText(value: TextareaProps["value"]): string | undefined {
  if (value === undefined || value === null) return undefined
  return Array.isArray(value) ? value.join("\n") : String(value)
}

function setNativeTextareaValue(textarea: HTMLTextAreaElement, next: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  )?.set
  setter?.call(textarea, next)
  textarea.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "insertText" })
  )
}

function PlainTextarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-base shadow-xs transition-[border-color,box-shadow,background-color] duration-150 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:bg-input/30 disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/20 dark:disabled:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

function pickAriaAttributes(
  props: React.ComponentProps<"textarea">
): React.AriaAttributes {
  const aria: React.AriaAttributes = {}
  for (const key of Object.keys(props) as Array<keyof typeof props>) {
    if (typeof key === "string" && key.startsWith("aria-")) {
      Object.assign(aria, { [key]: props[key] })
    }
  }
  return aria
}

/**
 * Rich text field that keeps the native textarea contract: a visually hidden
 * `<textarea>` carries `name`, `value`, `ref` and `onChange`, while a Tiptap
 * editor is what people type into. Content is stored as Markdown.
 */
function RichTextarea({
  className,
  value,
  defaultValue,
  onChange,
  onFocus,
  onBlur,
  placeholder,
  disabled,
  readOnly,
  autoFocus,
  maxLength,
  rows,
  id,
  ref,
  "data-testid": testId,
  ...props
}: React.ComponentProps<"textarea"> & { "data-testid"?: string }) {
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const editorRef = React.useRef<Editor | null>(null)
  const surfaceId = React.useId()
  const [labelledBy, setLabelledBy] = React.useState<string | undefined>()

  const controlledValue = toText(value)
  const initialValue = toText(defaultValue)

  const setTextareaRef = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node
      assignRef(ref, node)
    },
    [ref]
  )

  // `ref.current.focus()` and `<label htmlFor>` land on the hidden textarea;
  // hand focus over to the editor.
  React.useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const redirect = () => editorRef.current?.commands.focus()
    textarea.addEventListener("focus", redirect)
    return () => textarea.removeEventListener("focus", redirect)
  }, [])

  const ariaLabel = props["aria-label"]
  const ariaLabelledBy = props["aria-labelledby"]

  // Associate an external `<label for={id}>` with the editable surface.
  React.useEffect(() => {
    if (!id || ariaLabel || ariaLabelledBy) return
    const label = document.querySelector<HTMLLabelElement>(
      `label[for="${CSS.escape(id)}"]`
    )
    if (!label) return
    if (!label.id) label.id = `${surfaceId}-label`
    setLabelledBy(label.id)
  }, [ariaLabel, ariaLabelledBy, id, surfaceId])

  const ariaAttributes = React.useMemo(() => {
    const aria = pickAriaAttributes(props)
    if (labelledBy && !aria["aria-labelledby"]) aria["aria-labelledby"] = labelledBy
    if (props.required) aria["aria-required"] = true
    return aria
  }, [labelledBy, props])

  const dispatchFocus = React.useCallback((type: "focusin" | "focusout") => {
    textareaRef.current?.dispatchEvent(new FocusEvent(type, { bubbles: true }))
  }, [])

  // Replay editor key presses on the hidden textarea so `onKeyDown` handlers
  // (submit shortcuts and the like) keep working; preventDefault stops Tiptap.
  const handleKeyDown = React.useCallback((event: KeyboardEvent) => {
    const textarea = textareaRef.current
    if (!textarea) return false
    const replay = new KeyboardEvent("keydown", {
      key: event.key,
      code: event.code,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      repeat: event.repeat,
      bubbles: true,
      cancelable: true,
    })
    textarea.dispatchEvent(replay)
    if (replay.defaultPrevented) event.preventDefault()
    return replay.defaultPrevented
  }, [])

  const handleEditorReady = React.useCallback((editor: Editor | null) => {
    editorRef.current = editor
  }, [])

  const handleValueChange = React.useCallback((markdown: string) => {
    const textarea = textareaRef.current
    if (textarea) setNativeTextareaValue(textarea, markdown)
  }, [])

  return (
    <>
      <RichTextEditor
        value={controlledValue}
        defaultValue={initialValue}
        onValueChange={handleValueChange}
        onFocus={() => dispatchFocus("focusin")}
        onBlur={() => dispatchFocus("focusout")}
        onKeyDown={handleKeyDown}
        onEditorReady={handleEditorReady}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        autoFocus={autoFocus}
        maxLength={maxLength}
        rows={rows}
        className={className}
        testId={testId}
        ariaAttributes={ariaAttributes}
      />
      <textarea
        ref={setTextareaRef}
        data-slot="textarea"
        id={id}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        value={controlledValue}
        defaultValue={controlledValue === undefined ? initialValue : undefined}
        onChange={onChange ?? (() => undefined)}
        onFocus={onFocus}
        onBlur={onBlur}
        disabled={disabled}
        readOnly={readOnly}
        maxLength={maxLength}
        {...props}
      />
    </>
  )
}

function Textarea({ variant = "rich", ...props }: TextareaProps) {
  if (variant === "plain") return <PlainTextarea {...props} />
  return <RichTextarea {...props} />
}

export { Textarea }
export type { TextareaProps }

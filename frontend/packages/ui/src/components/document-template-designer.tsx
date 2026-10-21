"use client"

import * as React from "react"
import type { Component, ComponentDefinition, Editor, EditorConfig } from "grapesjs"
import {
  AlignLeft,
  Columns2,
  Heading1,
  Heading2,
  LayoutTemplate,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Table2,
  Trash2,
  Undo2,
  type LucideIcon,
} from "lucide-react"

import "grapesjs/dist/css/grapes.min.css"

import { Button } from "@lumiere/ui/components/button"
import {
  DOCUMENT_TEMPLATE_CANVAS_CSS,
  createDocumentDesignerSnapshot,
  sanitizeDocumentTemplateHtml,
  sanitizeRichTextTemplateHtml,
  type DocumentDesignerKind,
  type DocumentDesignerSnapshot,
  type DocumentDesignerState,
} from "@lumiere/ui/lib/document-template-designer"

export interface DocumentTemplateDesignerProps {
  kind: DocumentDesignerKind
  /** Initial source only. Mount with a new key when opening another template. */
  initialDesigner?: DocumentDesignerState
  onChange: (snapshot: DocumentDesignerSnapshot) => void
  onError?: (message: string) => void
  disabled?: boolean
}

type TemplateBlock = {
  id: string
  label: string
  icon: LucideIcon
  html: string
}

const CONTENT_BLOCKS: readonly TemplateBlock[] = [
  { id: "heading", label: "Heading", icon: Heading1, html: "<h1>Heading</h1>" },
  { id: "subheading", label: "Subheading", icon: Heading2, html: "<h2>Subheading</h2>" },
  { id: "paragraph", label: "Paragraph", icon: AlignLeft, html: "<p>Write your text here.</p>" },
  {
    id: "bullet-list",
    label: "Bullet list",
    icon: List,
    html: "<ul><li><p>First item</p></li><li><p>Second item</p></li></ul>",
  },
  {
    id: "numbered-list",
    label: "Numbered list",
    icon: ListOrdered,
    html: "<ol><li><p>First item</p></li><li><p>Second item</p></li></ol>",
  },
  { id: "quote", label: "Quote", icon: Quote, html: "<blockquote><p>Quoted text.</p></blockquote>" },
  {
    id: "table",
    label: "Table",
    icon: Table2,
    html: "<table><thead><tr><th><p>Item</p></th><th><p>Details</p></th></tr></thead><tbody><tr><td><p>First item</p></td><td><p>Description</p></td></tr><tr><td><p>Second item</p></td><td><p>Description</p></td></tr></tbody></table>",
  },
  { id: "divider", label: "Divider", icon: Minus, html: "<hr>" },
]

const LAYOUT_BLOCKS: readonly TemplateBlock[] = [
  {
    id: "section",
    label: "Section",
    icon: LayoutTemplate,
    html: '<section style="padding:16px;border:1px solid #d1d5db"><h2>Section heading</h2><p>Section content.</p></section>',
  },
  {
    id: "columns",
    label: "Two columns",
    icon: Columns2,
    html: '<table style="width:100%;border-collapse:collapse"><tbody><tr><td style="width:50%;padding:16px;vertical-align:top"><h2>Left column</h2><p>Column content.</p></td><td style="width:50%;padding:16px;vertical-align:top"><h2>Right column</h2><p>Column content.</p></td></tr></tbody></table>',
  },
]

const FRAME_POLICY = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"

type SelectionState = {
  name: string
  removable: boolean
  color: string
  background: string
  fontSize: string
  textAlign: string
  padding: string
  border: string
}

function readSelection(component: Component | undefined): SelectionState | null {
  if (!component || component.is("wrapper")) return null
  const style = component.getStyle()
  const value = (property: string) => String(style[property] ?? "")
  return {
    name: component.getName(),
    removable: Boolean(component.get("removable")),
    color: /^#[\da-f]{6}$/i.test(value("color")) ? value("color") : "#1f2937",
    background: /^#[\da-f]{6}$/i.test(value("background-color")) ? value("background-color") : "#ffffff",
    fontSize: value("font-size"),
    textAlign: value("text-align"),
    padding: value("padding").replace(/px$/, ""),
    border: value("border"),
  }
}

function initialProject(kind: DocumentDesignerKind) {
  return {
    assets: [],
    styles: [],
    pages: [
      {
        id: "template-page",
        frames: [{
          component: {
            type: "wrapper",
            components: [
              { type: "text", tagName: "h2", content: kind === "document" ? "Document title" : "Template heading" },
              { type: "text", tagName: "p", content: "Write your content here." },
            ],
          },
        }],
      },
    ],
  }
}

function textAsHtml(text: string): string {
  const element = document.createElement("p")
  element.textContent = text
  return element.innerHTML.replace(/\r\n?|\n/g, "<br>")
}

function currentProject(editor: Editor): unknown {
  const editing = editor.getEditing()
  const element = editing?.getEl()
  if (!editing || !element) return editor.getProjectData()

  // GrapesJS syncs its active rich-text DOM asynchronously. Project export can
  // therefore lag behind the last keystroke. Read a model clone and overlay the
  // active text without resetting the live DOM, caret, or native undo history.
  const page = editor.Pages.getSelected()
  const wrapper = editor.getWrapper()
  if (!page || !wrapper) throw new Error("The template page is unavailable.")
  const component: ComponentDefinition = JSON.parse(JSON.stringify(wrapper.toJSON()))
  const path: number[] = []
  let current = editing
  while (!current.is("wrapper")) {
    const parent = current.parent()
    if (!parent) throw new Error("The edited text is no longer on this page.")
    path.unshift(parent.components().indexOf(current))
    current = parent
  }
  let target = component
  for (const index of path) {
    const child = Array.isArray(target.components) ? target.components[index] : undefined
    if (!child || typeof child !== "object") throw new Error("The edited text could not be saved.")
    target = child
  }
  target.content = element.innerHTML
  target.components = []
  return {
    assets: [],
    styles: [],
    pages: [{ id: page.getId(), name: page.getName(), frames: [{ id: page.getMainFrame().get("id"), component }] }],
  }
}

const CONTROL_CLASS = "h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"

/** Visual template authoring; persistence and document generation belong to the caller. */
export function DocumentTemplateDesigner({
  kind,
  initialDesigner,
  onChange,
  onError,
  disabled = false,
}: DocumentTemplateDesignerProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const editorRef = React.useRef<Editor | null>(null)
  const endDragRef = React.useRef<((cancel?: boolean) => void) | null>(null)
  const suppressClickRef = React.useRef(false)
  const initialRef = React.useRef(initialDesigner)
  const callbacksRef = React.useRef({ onChange, onError, disabled })
  callbacksRef.current = { onChange, onError, disabled }
  const [ready, setReady] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [selection, setSelection] = React.useState<SelectionState | null>(null)
  const [history, setHistory] = React.useState({ undo: false, redo: false })
  const blocks = kind === "document" ? [...CONTENT_BLOCKS, ...LAYOUT_BLOCKS] : CONTENT_BLOCKS

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    let editor: Editor | undefined
    let mount: HTMLDivElement | undefined
    let frameDocument: Document | undefined
    const sanitize = kind === "document" ? sanitizeDocumentTemplateHtml : sanitizeRichTextTemplateHtml

    const reportError = (cause: unknown) => {
      if (disposed) return
      const message = cause instanceof Error ? cause.message : "The template designer could not load this content."
      setError(message)
      callbacksRef.current.onError?.(message)
    }
    const preventNavigation = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest?.("a")) event.preventDefault()
    }
    const updateSelection = () => {
      if (disposed || !editor) return
      setSelection(readSelection(editor.getSelected()))
      setHistory({ undo: editor.UndoManager.hasUndo(), redo: editor.UndoManager.hasRedo() })
    }
    const publish = () => {
      if (disposed || !editor || callbacksRef.current.disabled) return
      try {
        const snapshot = createDocumentDesignerSnapshot(kind, currentProject(editor))
        setError(null)
        callbacksRef.current.onChange(snapshot)
        updateSelection()
      } catch (cause) {
        reportError(cause)
      }
    }

    setReady(false)
    setError(null)
    void (async () => {
      const initial = initialRef.current
      if (initial && initial.kind !== kind) throw new Error("This template uses a different editor kind.")
      const snapshot = createDocumentDesignerSnapshot(kind, initial?.project ?? initialProject(kind))
      const { default: grapesjs } = await import("grapesjs")
      if (disposed) return
      mount = document.createElement("div")
      mount.style.height = "100%"
      container.replaceChildren(mount)
      const palette = kind === "document" ? [...CONTENT_BLOCKS, ...LAYOUT_BLOCKS] : CONTENT_BLOCKS
      const config: EditorConfig = {
        container: mount,
        projectData: snapshot.designer.project,
        height: "100%",
        width: "100%",
        telemetry: false,
        storageManager: false,
        noticeOnUnload: false,
        cssIcons: "",
        jsInHtml: false,
        forceClass: false,
        avoidInlineStyle: false,
        showToolbar: false,
        showDevices: false,
        panels: { defaults: [] },
        styleManager: { sectors: [] },
        blockManager: {
          custom: true,
          blocks: palette.map((block) => ({ id: block.id, label: block.label, content: block.html })),
        },
        canvas: {
          scripts: [],
          styles: [],
          frameStyle: DOCUMENT_TEMPLATE_CANVAS_CSS,
          allowExternalDrop: false,
        },
        assetManager: { assets: [], upload: false, embedAsBase64: false, showUrlInput: false },
        parser: {
          optionsHtml: {
            allowScripts: false,
            allowUnsafeAttr: false,
            allowUnsafeAttrValue: false,
            preParser: sanitize,
          },
        },
        richTextEditor: {
          actions: ["bold", "italic", "strikethrough"],
          onPaste: ({ ev, rte }) => {
            ev.preventDefault()
            if (callbacksRef.current.disabled) return
            const html = ev.clipboardData?.getData("text/html")
            rte.exec("insertHTML", sanitize(html || textAsHtml(ev.clipboardData?.getData("text/plain") ?? "")))
          },
        },
      }
      editor = grapesjs.init(config)
      editorRef.current = editor
      editor.on("update component:input rte:disable", publish)
      editor.on("component:selected component:deselected undo redo", updateSelection)
      editor.on("canvas:drop", (_data, component) => {
        if (!disposed && component) editor?.select(component)
      })
      // The core head renderer replaces frameContent's head. Apply the policy
      // after it runs and before the canvas body renders any components.
      editor.on("canvas:frame:load:head", ({ el }: { el: HTMLIFrameElement }) => {
        const doc = el.contentDocument
        if (!doc) return
        const policy = doc.createElement("meta")
        policy.httpEquiv = "Content-Security-Policy"
        policy.content = FRAME_POLICY
        doc.head.prepend(policy)
      })
      editor.onReady(() => {
        if (disposed || !editor) return
        frameDocument = editor.Canvas.getDocument() ?? undefined
        frameDocument?.addEventListener("click", preventNavigation, true)
        const frame = editor.Canvas.getFrameEl()
        frame?.setAttribute("title", "Template design canvas")
        setReady(true)
        updateSelection()
        publish()
      })
    })().catch(reportError)

    return () => {
      disposed = true
      endDragRef.current?.(true)
      frameDocument?.removeEventListener("click", preventNavigation, true)
      editor?.off("update component:input rte:disable", publish)
      editor?.off("component:selected component:deselected undo redo", updateSelection)
      mount?.remove()
      const instance = editor
      const view = instance?.getEditing()?.getView()
      // RTE shutdown is asynchronous in the core. Let it finish before the
      // parser is destroyed; the isolated mount is already detached from React.
      if (view && "disableEditing" in view && typeof view.disableEditing === "function") {
        void Promise.resolve(view.disableEditing()).then(
          () => instance?.destroy(),
          () => instance?.destroy()
        )
      } else instance?.destroy()
      if (editorRef.current === editor) editorRef.current = null
    }
  }, [kind])

  const unavailable = disabled || !ready
  const addBlock = (id: string) => {
    const editor = editorRef.current
    if (unavailable || !editor) return
    const block = blocks.find((candidate) => candidate.id === id)
    if (!block) return
    const added = editor.addComponents(block.html)
    if (added[0]) editor.select(added[0])
  }
  const setStyle = (property: string, value: string) => {
    if (unavailable || kind !== "document") return
    const component = editorRef.current?.getSelected()
    if (!component || component.is("wrapper")) return
    const style = { ...component.getStyle() }
    // Parsed HTML can expand shorthands. Remove those authored side values so
    // a new inspector shorthand has the same meaning in canvas and export.
    for (const key of Object.keys(style)) {
      if ((property === "padding" && key.startsWith("padding-")) ||
        (property === "border" && /^border-(?!collapse$|spacing$)/.test(key))) delete style[key]
    }
    if (value) style[property] = value
    else delete style[property]
    component.setStyle(style)
    setSelection(readSelection(component))
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border bg-background" data-testid="document-template-designer">
      <div className="flex min-w-0 flex-wrap items-center gap-1 border-b px-3 py-2" role="toolbar" aria-label="Template design actions">
        <span className="mr-auto truncate text-xs font-medium">{kind === "document" ? "Document layout" : "Rich-text template"}</span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Undo design change" title="Undo" disabled={unavailable || !history.undo} onClick={() => editorRef.current?.UndoManager.undo()}><Undo2 /></Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Redo design change" title="Redo" disabled={unavailable || !history.redo} onClick={() => editorRef.current?.UndoManager.redo()}><Redo2 /></Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Delete selected block" title="Delete selected block" disabled={unavailable || !selection?.removable} onClick={() => editorRef.current?.getSelected()?.remove()}><Trash2 /></Button>
      </div>
      {error ? <p role="alert" className="border-b bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      <div className="grid min-w-0 grid-cols-1 sm:h-[min(62vh,42rem)] sm:min-h-96 sm:grid-cols-[11rem_minmax(0,1fr)]">
        <aside className="min-w-0 overflow-y-auto border-b bg-muted/20 p-3 sm:border-r sm:border-b-0" aria-label="Template blocks and properties">
          <p className="mb-2 text-xs font-medium">Add content</p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-1">
            {blocks.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                type="button"
                variant="outline"
                size="sm"
                className="h-auto min-h-8 justify-start whitespace-normal text-left"
                disabled={unavailable}
                draggable={false}
                onClick={(event) => {
                  if (event.detail > 0 && suppressClickRef.current) {
                    suppressClickRef.current = false
                    return
                  }
                  addBlock(id)
                }}
                onPointerDown={(event) => {
                  const editor = editorRef.current
                  const block = editor?.Blocks.get(id)
                  if (unavailable || !editor || !block || event.button !== 0) return
                  endDragRef.current?.(true)
                  suppressClickRef.current = false
                  const startX = event.clientX
                  const startY = event.clientY
                  const finish = (cancel = false) => {
                    document.removeEventListener("pointermove", onPointerMove)
                    document.removeEventListener("pointerup", onPointerUp)
                    document.removeEventListener("pointercancel", onCancel)
                    window.removeEventListener("blur", onCancel)
                    editor.Blocks.endDrag(cancel)
                    if (endDragRef.current === finish) endDragRef.current = null
                  }
                  const onPointerMove = (moveEvent: PointerEvent) => {
                    if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 4) suppressClickRef.current = true
                  }
                  const onPointerUp = (endEvent: PointerEvent) => {
                    onPointerMove(endEvent)
                    finish()
                  }
                  const onCancel = () => {
                    suppressClickRef.current = true
                    finish(true)
                  }
                  editor.refresh()
                  // The public block API uses pointer events. Mixing it with
                  // native HTML drag events prevents the canvas sorter moving.
                  editor.Blocks.startDrag(block, event.nativeEvent)
                  document.addEventListener("pointermove", onPointerMove)
                  document.addEventListener("pointerup", onPointerUp)
                  document.addEventListener("pointercancel", onCancel)
                  window.addEventListener("blur", onCancel)
                  endDragRef.current = finish
                }}
              >
                <Icon className="shrink-0" />{label}
              </Button>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Click to add, or drag a block onto the page. Double-click text to edit it.</p>
          {kind === "document" ? (
            <fieldset className="mt-4 space-y-2 border-t pt-3" disabled={unavailable || !selection}>
              <legend className="sr-only">Selected block properties</legend>
              <p className="truncate text-xs font-medium">{selection?.name ?? "Select a block to style"}</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-xs">Text<input aria-label="Text color" type="color" className="h-8 w-full rounded border border-input bg-background p-1" value={selection?.color ?? "#1f2937"} onChange={(event) => setStyle("color", event.target.value)} /></label>
                <label className="grid gap-1 text-xs">Fill<input aria-label="Background color" type="color" className="h-8 w-full rounded border border-input bg-background p-1" value={selection?.background ?? "#ffffff"} onChange={(event) => setStyle("background-color", event.target.value)} /></label>
              </div>
              <label className="grid gap-1 text-xs">Text size<select className={CONTROL_CLASS} value={selection?.fontSize ?? ""} onChange={(event) => setStyle("font-size", event.target.value)}><option value="">Default</option>{[12, 14, 16, 20, 24, 32, 40].map((size) => <option key={size} value={`${size}px`}>{size} px</option>)}</select></label>
              <label className="grid gap-1 text-xs">Alignment<select className={CONTROL_CLASS} value={selection?.textAlign ?? ""} onChange={(event) => setStyle("text-align", event.target.value)}><option value="">Default</option><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
              <label className="grid gap-1 text-xs">Padding<select className={CONTROL_CLASS} value={selection?.padding ?? ""} onChange={(event) => setStyle("padding", event.target.value ? `${event.target.value}px` : "")}><option value="">Default</option>{[0, 4, 8, 12, 16, 24, 32].map((size) => <option key={size} value={String(size)}>{size} px</option>)}</select></label>
              <label className="grid gap-1 text-xs">Border<select className={CONTROL_CLASS} value={selection?.border ?? ""} onChange={(event) => setStyle("border", event.target.value)}><option value="">Default</option><option value="none">None</option><option value="1px solid #d1d5db">Light</option><option value="2px solid #1f2937">Strong</option></select></label>
            </fieldset>
          ) : <p className="mt-4 border-t pt-3 text-xs leading-relaxed text-muted-foreground">Headings, lists and tables stay editable when inserted into a text field.</p>}
        </aside>
        <div className="relative h-[28rem] min-w-0 bg-muted/30 sm:h-auto" aria-busy={!ready && !error}>
          {!ready && !error ? <p className="absolute inset-0 z-10 grid place-items-center bg-background/80 text-sm text-muted-foreground" role="status">Loading template designer…</p> : null}
          <div
            ref={containerRef}
            inert={disabled || undefined}
            aria-disabled={disabled || undefined}
            className="h-full min-w-0 [&_.gjs-cv-canvas]:top-0 [&_.gjs-cv-canvas]:h-full [&_.gjs-cv-canvas]:w-full"
          />
        </div>
      </div>
    </div>
  )
}

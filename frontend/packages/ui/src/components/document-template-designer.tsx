"use client"

import * as React from "react"
import { useTranslation } from "@lumiere/i18n"
import type {
  Component,
  ComponentDefinition,
  Editor,
  EditorConfig,
} from "grapesjs"
import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  Braces,
  Pencil,
  Blocks,
  Columns2,
  FileText,
  Heading1,
  Heading2,
  LayoutTemplate,
  List,
  ListOrdered,
  Maximize,
  Minus,
  MousePointer2,
  PanelLeft,
  Plus,
  Quote,
  Redo2,
  Search,
  SlidersHorizontal,
  Table2,
  Trash2,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react"

import "grapesjs/dist/css/grapes.min.css"
import "./document-template-designer.css"

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
  {
    id: "subheading",
    label: "Subheading",
    icon: Heading2,
    html: "<h2>Subheading</h2>",
  },
  {
    id: "paragraph",
    label: "Paragraph",
    icon: AlignLeft,
    html: "<p>Write your text here.</p>",
  },
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
  {
    id: "quote",
    label: "Quote",
    icon: Quote,
    html: "<blockquote><p>Quoted text.</p></blockquote>",
  },
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

const FRAME_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"

type SelectionState = {
  id: string
  editable: boolean
  previous: boolean
  next: boolean
  name: string
  tagName: string
  removable: boolean
  color: string
  background: string
  fontSize: string
  textAlign: string
  padding: string
  border: string
}

const CUSTOM_SIDES = "__custom-sides__"
const TEXT_SIZES = [12, 14, 16, 20, 24, 32, 40].map((size) => `${size}px`)
const PADDING_VALUES = [0, 4, 8, 12, 16, 24, 32].map((size) => `${size}px`)
const BORDER_VALUES = ["none", "1px solid #d1d5db", "2px solid #1f2937"]

function readBoxStyle(
  value: (property: string) => string,
  property: "padding" | "border",
) {
  if (value(property)) return value(property)
  const sides = ["top", "right", "bottom", "left"].map((side) => {
    const key = `${property}-${side}`
    if (property === "padding" || value(key)) return value(key)
    return ["width", "style", "color"]
      .map((part) => value(`${key}-${part}`) || value(`border-${part}`))
      .filter(Boolean)
      .join(" ")
  })
  if (!sides.some(Boolean)) return ""
  if (sides.every((side) => side === sides[0])) return sides[0] ?? ""
  if (property === "border" || !sides.every(Boolean)) return CUSTOM_SIDES
  return sides.join(" ")
}

function readSelection(
  component: Component | undefined,
): SelectionState | null {
  if (!component || component.is("wrapper")) return null
  const style = component.getStyle()
  const value = (property: string) => String(style[property] ?? "")
  return {
    id: component.getId(),
    editable:
      component.isInstanceOf("text") && Boolean(component.get("editable")),
    previous: component.index() > 0,
    next:
      component.index() < (component.parent()?.components().length ?? 0) - 1,
    name: component.getName(),
    tagName: component.get("tagName") ?? "div",
    removable: Boolean(component.get("removable")),
    color: /^#[\da-f]{6}$/i.test(value("color")) ? value("color") : "#1f2937",
    background: /^#[\da-f]{6}$/i.test(value("background-color"))
      ? value("background-color")
      : "#ffffff",
    fontSize: value("font-size"),
    textAlign: value("text-align"),
    padding: readBoxStyle(value, "padding"),
    border: readBoxStyle(value, "border"),
  }
}

type TemplateTranslator = ReturnType<typeof useTranslation>["t"]
export type TextTemplateStarter = "blank" | "proposal" | "scope" | "terms"

function projectWithContent(components: ComponentDefinition[]) {
  return {
    assets: [],
    styles: [],
    pages: [
      {
        id: "template-page",
        frames: [{ component: { type: "wrapper", components } }],
      },
    ],
  }
}

function initialProject() {
  return projectWithContent([{ type: "text", tagName: "p", content: "" }])
}

/** Starters contain real editable prose. Blank never includes sample text that can be saved unnoticed. */
export function createTextTemplateStarter(
  starter: TextTemplateStarter,
  t: TemplateTranslator,
): DocumentDesignerState {
  const block = (tagName: string, content: string): ComponentDefinition => ({
    type: "text",
    tagName,
    content: escapeText(content),
  })
  const components =
    starter === "proposal"
      ? [
          block(
            "h2",
            t("documents.designer.starterContent.proposalTitle", {
              defaultValue: "Our proposal",
            }),
          ),
          block(
            "p",
            t("documents.designer.starterContent.proposalIntro", {
              defaultValue:
                "Thank you for the opportunity to work together. This proposal outlines the objectives, deliverables and next steps for your project.",
            }),
          ),
          block(
            "p",
            t("documents.designer.starterContent.proposalNext", {
              defaultValue:
                "Review the scope below and let us know which details you would like to discuss before we begin.",
            }),
          ),
        ]
      : starter === "scope"
        ? [
            block(
              "h2",
              t("documents.designer.starterContent.scopeTitle", {
                defaultValue: "Scope of work",
              }),
            ),
            block(
              "p",
              t("documents.designer.starterContent.scopeIntro", {
                defaultValue:
                  "Describe the agreed objectives and the work included in this project.",
              }),
            ),
            {
              tagName: "ul",
              components: [
                "scopeDeliverables",
                "scopeSchedule",
                "scopeResponsibilities",
              ].map((key) => ({
                tagName: "li",
                components: [
                  block(
                    "p",
                    t(`documents.designer.starterContent.${key}`, {
                      defaultValue:
                        key === "scopeDeliverables"
                          ? "Deliverables and acceptance criteria"
                          : key === "scopeSchedule"
                            ? "Milestones and expected schedule"
                            : "Responsibilities and required information",
                    }),
                  ),
                ],
              })),
            },
          ]
        : starter === "terms"
          ? [
              block(
                "h2",
                t("documents.designer.starterContent.termsTitle", {
                  defaultValue: "Working terms",
                }),
              ),
              block(
                "p",
                t("documents.designer.starterContent.termsIntro", {
                  defaultValue:
                    "Confirm the scope, schedule and payment arrangements with the customer before starting work.",
                }),
              ),
              block(
                "p",
                t("documents.designer.starterContent.termsChanges", {
                  defaultValue:
                    "Changes to the agreed scope will be discussed and confirmed in writing before additional work begins.",
                }),
              ),
              block(
                "p",
                t("documents.designer.starterContent.termsContact", {
                  defaultValue:
                    "Please contact us with questions or changes so we can agree on the next steps.",
                }),
              ),
            ]
          : [{ type: "text", tagName: "p", content: "" }]
  return createDocumentDesignerSnapshot(
    "rich-text",
    projectWithContent(components),
  ).designer
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

const QUOTATION_FIELDS = [
  ["company.name", "Company name"],
  ["company.address", "Company address"],
  ["company.tax_id", "Company tax ID"],
  ["customer.name", "Customer name"],
  ["customer.address", "Customer address"],
  ["customer.email", "Customer email"],
  ["quotation.reference", "Quotation reference"],
  ["quotation.date", "Quotation date"],
  ["quotation.valid_until", "Valid until"],
  ["quotation.currency", "Currency"],
  ["quotation.subtotal", "Subtotal"],
  ["quotation.tax", "Tax"],
  ["quotation.total", "Total"],
  ["quotation.notes", "Quotation notes"],
  ["quotation.terms", "Quotation terms"],
  ["quotation.line_items", "Line items"],
  ["company.logo", "Brand logo"],
] as const

function templateBlocks(
  kind: DocumentDesignerKind,
  t: TemplateTranslator,
): TemplateBlock[] {
  const content = (
    kind === "document" ? [...CONTENT_BLOCKS, ...LAYOUT_BLOCKS] : CONTENT_BLOCKS
  ).map((block) => ({
    ...block,
    label: t(`documents.studio.blockLabels.${block.id}`, {
      defaultValue: block.label,
    }),
    html: t(`documents.studio.blockContent.${block.id}`, {
      defaultValue: block.html,
    }),
  }))
  if (kind === "document")
    content.push(
      ...QUOTATION_FIELDS.map(([field, label]) => ({
        id: `field-${field}`,
        label: t(`documents.studio.fields.${field.replace(".", "_")}`, {
          defaultValue: label,
        }),
        icon: Braces,
        html: `<p>{{${field}}}</p>`,
      })),
    )
  return content
}

export function createQuotationTemplateStarter(
  t: TemplateTranslator,
): DocumentDesignerState {
  const block = (
    tagName: string,
    content: string,
    style?: Record<string, string>,
  ): ComponentDefinition => ({
    type: "text",
    tagName,
    content: escapeText(content),
    ...(style ? { style } : {}),
  })
  return createDocumentDesignerSnapshot(
    "document",
    projectWithContent([
      block("p", "{{company.logo}}"),
      block("h1", "{{company.name}}", {
        color: "#18594d",
        "font-size": "32px",
      }),
      block("p", "{{company.address}}"),
      block("p", "{{company.tax_id}}"),
      block(
        "h2",
        `${t("documents.designer.starterContent.quotationTitle", { defaultValue: "Quotation" })} {{quotation.reference}}`,
      ),
      block(
        "p",
        `${t("documents.designer.starterContent.quotationDate", { defaultValue: "Date" })}: {{quotation.date}}`,
      ),
      block(
        "p",
        `${t("documents.designer.starterContent.quotationValidity", { defaultValue: "Valid until" })}: {{quotation.valid_until}}`,
      ),
      block("h2", "{{customer.name}}"),
      block("p", "{{customer.address}}"),
      block("p", "{{customer.email}}"),
      block("p", "{{quotation.line_items}}"),
      block(
        "p",
        `${t("documents.designer.starterContent.quotationSubtotal", { defaultValue: "Subtotal" })}: {{quotation.subtotal}}`,
      ),
      block(
        "p",
        `${t("documents.designer.starterContent.quotationTax", { defaultValue: "Tax" })}: {{quotation.tax}}`,
      ),
      block(
        "h2",
        `${t("documents.designer.starterContent.quotationTotal", { defaultValue: "Total" })}: {{quotation.total}} {{quotation.currency}}`,
      ),
      block("p", "{{quotation.notes}}"),
      block("p", "{{quotation.terms}}"),
    ]),
  ).designer
}

type OutlineBlock = {
  id: string
  name: string
  depth: number
  component: Component
}
function readOutline(editor: Editor): OutlineBlock[] {
  const result: OutlineBlock[] = []
  const visit = (component: Component, depth: number) => {
    const tag = component.get("tagName") ?? ""
    if (
      !component.is("textnode") &&
      /^(?:h[1-3]|p|ul|ol|li|blockquote|table|section|div|hr)$/.test(tag)
    ) {
      const content = document.createElement("div")
      content.innerHTML = component.toHTML()
      const text = content.textContent?.replace(/\s+/g, " ").trim().slice(0, 60)
      result.push({
        id: component.getId(),
        name: text || component.getName(),
        depth,
        component,
      })
    }
    if (!component.isInstanceOf("text"))
      component
        .components()
        .forEach((child: Component) => visit(child, depth + 1))
  }
  editor
    .getWrapper()
    ?.components()
    .forEach((component: Component) => visit(component, 0))
  return result
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
  const component: ComponentDefinition = JSON.parse(
    JSON.stringify(wrapper.toJSON()),
  )
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
    const child = Array.isArray(target.components)
      ? target.components[index]
      : undefined
    if (!child || typeof child !== "object")
      throw new Error("The edited text could not be saved.")
    target = child
  }
  target.content = element.innerHTML
  target.components = []
  return {
    assets: [],
    styles: [],
    pages: [
      {
        id: page.getId(),
        name: page.getName(),
        frames: [{ id: page.getMainFrame().get("id"), component }],
      },
    ],
  }
}

const CONTROL_CLASS = "template-studio-control"
const STRUCTURE_BLOCK_IDS = new Set(["table", "divider", "section", "columns"])
const ZOOM_LEVELS = [25, 50, 75, 100, 125, 150]

function BlockPreview({ id }: { id: string }) {
  return (
    <span
      className="template-studio-block-preview"
      data-block={id}
      aria-hidden="true"
    >
      {id === "heading" || id === "subheading" ? (
        <span className="template-studio-preview-heading">Aa</span>
      ) : id === "table" ? (
        <span className="template-studio-preview-table">
          {Array.from({ length: 6 }, (_, index) => (
            <i key={index} />
          ))}
        </span>
      ) : id === "divider" ? (
        <span className="template-studio-preview-divider" />
      ) : id === "columns" ? (
        <span className="template-studio-preview-columns">
          <i />
          <i />
        </span>
      ) : (
        <span className="template-studio-preview-lines">
          {[0, 1, 2].map((index) => (
            <span key={index}>
              {id === "bullet-list" ? (
                <b>•</b>
              ) : id === "numbered-list" ? (
                <b>{index + 1}.</b>
              ) : null}
              <i />
            </span>
          ))}
        </span>
      )}
    </span>
  )
}

function fitCanvas(editor: Editor, ignoreHeight = false) {
  // Viewport settings belong to the canvas, never the saved document body.
  if (!editor.Canvas.getFrameEl()) return
  editor.Canvas.fitViewport({
    gap: 32,
    ignoreHeight,
    zoom: (value) => Math.max(25, Math.min(100, value)),
  })
}

/** Visual template authoring; persistence and document generation belong to the caller. */
export function DocumentTemplateDesigner({
  kind,
  initialDesigner,
  onChange,
  onError,
  disabled = false,
}: DocumentTemplateDesignerProps) {
  const { t } = useTranslation()
  const translationRef = React.useRef(t)
  translationRef.current = t
  const containerRef = React.useRef<HTMLDivElement>(null)
  const editButtonRef = React.useRef<HTMLButtonElement>(null)
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
  const [search, setSearch] = React.useState("")
  const [category, setCategory] = React.useState<
    "all" | "text" | "structure" | "data"
  >("all")
  const [panel, setPanel] = React.useState<"canvas" | "blocks" | "properties">(
    "canvas",
  )
  const [zoom, setZoom] = React.useState(100)
  const [outline, setOutline] = React.useState<OutlineBlock[]>([])
  const [libraryTab, setLibraryTab] = React.useState<"blocks" | "outline">(
    "blocks",
  )
  const [announcement, setAnnouncement] = React.useState("")
  const blocks = templateBlocks(kind, t)
  const visibleBlocks = blocks.filter((block) => {
    const matchesCategory =
      category === "all" ||
      (category === "data"
        ? block.id.startsWith("field-")
        : !block.id.startsWith("field-") &&
          (category === "structure") === STRUCTURE_BLOCK_IDS.has(block.id))
    return (
      matchesCategory &&
      block.label.toLowerCase().includes(search.trim().toLowerCase())
    )
  })

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    let editor: Editor | undefined
    let mount: HTMLDivElement | undefined
    let frameDocument: Document | undefined
    let resizeObserver: ResizeObserver | undefined
    let fitRequest: number | undefined
    const sanitize =
      kind === "document"
        ? sanitizeDocumentTemplateHtml
        : sanitizeRichTextTemplateHtml

    const reportError = (cause: unknown) => {
      if (disposed) return
      const message =
        cause instanceof Error
          ? cause.message
          : t("documents.studio.loadError", {
              defaultValue:
                "The template designer could not load this content.",
            })
      setError(message)
      callbacksRef.current.onError?.(message)
    }
    const preventNavigation = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest?.("a"))
        event.preventDefault()
    }
    const onFrameKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !editor?.getEditing()) return
      event.preventDefault()
      event.stopPropagation()
      const view = editor.getEditing()?.getView()
      if (
        view &&
        "disableEditing" in view &&
        typeof view.disableEditing === "function"
      ) {
        void Promise.resolve(view.disableEditing())
          .then(() => {
            if (disposed) return
            setPanel("properties")
            editButtonRef.current?.focus()
          })
          .catch(reportError)
      }
    }
    const updateSelection = () => {
      if (disposed || !editor) return
      setSelection(readSelection(editor.getSelected()))
      setOutline(readOutline(editor))
      setHistory({
        undo: editor.UndoManager.hasUndo(),
        redo: editor.UndoManager.hasRedo(),
      })
    }
    const updateZoom = () => {
      if (!disposed && editor) setZoom(Math.round(editor.Canvas.getZoom()))
    }
    const publish = () => {
      if (disposed || !editor || callbacksRef.current.disabled) return
      try {
        const snapshot = createDocumentDesignerSnapshot(
          kind,
          currentProject(editor),
        )
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
      if (initial && initial.kind !== kind)
        throw new Error(
          t("documents.studio.kindError", {
            defaultValue: "This template uses a different editor kind.",
          }),
        )
      const snapshot = createDocumentDesignerSnapshot(
        kind,
        initial?.project ?? initialProject(),
      )
      const { default: grapesjs } = await import("grapesjs")
      if (disposed) return
      mount = document.createElement("div")
      mount.style.height = "100%"
      container.replaceChildren(mount)
      const palette = templateBlocks(kind, translationRef.current)
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
        deviceManager: {
          devices: [
            {
              id: "template-page",
              name: t("documents.studio.page", { defaultValue: "Page" }),
              width: "720px",
              height: "960px",
            },
          ],
        },
        panels: { defaults: [] },
        styleManager: { sectors: [] },
        blockManager: {
          custom: true,
          blocks: palette.map((block) => ({
            id: block.id,
            label: block.label,
            content: block.html,
          })),
        },
        canvas: {
          scripts: [],
          styles: [],
          // The core wrapper adds 100vh inside the shared 24px page padding.
          // Keep the canvas-only drop surface within the page's content box.
          frameStyle: `${DOCUMENT_TEMPLATE_CANVAS_CSS}\nbody > [data-gjs-type="wrapper"] { min-height: calc(100vh - 48px); }`,
          allowExternalDrop: false,
          scrollableCanvas: true,
        },
        assetManager: {
          assets: [],
          upload: false,
          embedAsBase64: false,
          showUrlInput: false,
        },
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
            rte.exec(
              "insertHTML",
              sanitize(
                html ||
                  textAsHtml(ev.clipboardData?.getData("text/plain") ?? ""),
              ),
            )
          },
        },
      }
      editor = grapesjs.init(config)
      // In this core version, storageManager:false disables the destination
      // but leaves autosave enabled. Its background store still syncs active
      // text into the model, resetting the caret during typing.
      editor.Storage.setAutosave(false)
      editorRef.current = editor
      editor.on("update component:input rte:disable", publish)
      editor.on(
        "component:selected component:deselected undo redo",
        updateSelection,
      )
      editor.on("canvas:zoom", updateZoom)
      editor.on("canvas:drop", (_data, component) => {
        if (!disposed && component) {
          editor?.select(component)
          setPanel("canvas")
        }
      })
      // The core head renderer replaces frameContent's head. Apply the policy
      // after it runs and before the canvas body renders any components.
      editor.on(
        "canvas:frame:load:head",
        ({ el }: { el: HTMLIFrameElement }) => {
          const doc = el.contentDocument
          if (!doc) return
          const policy = doc.createElement("meta")
          policy.httpEquiv = "Content-Security-Policy"
          policy.content = FRAME_POLICY
          doc.head.prepend(policy)
        },
      )
      editor.onReady(() => {
        if (disposed || !editor) return
        frameDocument = editor.Canvas.getDocument() ?? undefined
        frameDocument?.addEventListener("click", preventNavigation, true)
        frameDocument?.addEventListener("keydown", onFrameKeyDown, true)
        const frame = editor.Canvas.getFrameEl()
        frame?.setAttribute(
          "title",
          t("documents.studio.canvasTitle", {
            defaultValue: "Template design canvas",
          }),
        )
        setReady(true)
        updateSelection()
        publish()
        const resize = () => {
          if (fitRequest !== undefined) cancelAnimationFrame(fitRequest)
          fitRequest = requestAnimationFrame(() => {
            if (!disposed && editor) fitCanvas(editor, true)
          })
        }
        resize()
        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(resize)
          resizeObserver.observe(container)
        }
      })
    })().catch(reportError)

    return () => {
      disposed = true
      endDragRef.current?.(true)
      resizeObserver?.disconnect()
      if (fitRequest !== undefined) cancelAnimationFrame(fitRequest)
      frameDocument?.removeEventListener("click", preventNavigation, true)
      frameDocument?.removeEventListener("keydown", onFrameKeyDown, true)
      editor?.off("update component:input rte:disable", publish)
      editor?.off(
        "component:selected component:deselected undo redo",
        updateSelection,
      )
      editor?.off("canvas:zoom", updateZoom)
      mount?.remove()
      const instance = editor
      const view = instance?.getEditing()?.getView()
      // RTE shutdown is asynchronous in the core. Let it finish before the
      // parser is destroyed; the isolated mount is already detached from React.
      if (
        view &&
        "disableEditing" in view &&
        typeof view.disableEditing === "function"
      ) {
        void Promise.resolve(view.disableEditing()).then(
          () => instance?.destroy(),
          () => instance?.destroy(),
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
    setPanel("canvas")
  }
  const setStyle = (property: string, value: string) => {
    if (unavailable || kind !== "document") return
    const component = editorRef.current?.getSelected()
    if (!component || component.is("wrapper")) return
    const style = { ...component.getStyle() }
    // Parsed HTML can expand shorthands. Remove those authored side values so
    // a new inspector shorthand has the same meaning in canvas and export.
    for (const key of Object.keys(style)) {
      if (
        (property === "padding" && key.startsWith("padding-")) ||
        (property === "border" && /^border-(?!collapse$|spacing$)/.test(key))
      )
        delete style[key]
    }
    if (value) style[property] = value
    else delete style[property]
    component.setStyle(style)
    setSelection(readSelection(component))
  }

  const startBlockDrag = (
    id: string,
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    const editor = editorRef.current
    const block = editor?.Blocks.get(id)
    if (unavailable || !editor || !block || event.button !== 0) return
    if (event.pointerType === "touch") {
      suppressClickRef.current = false
      return
    }
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
      if (
        Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 4
      )
        suppressClickRef.current = true
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
  }
  const moveSelected = (direction: -1 | 1) => {
    const editor = editorRef.current
    const selected = editor?.getSelected()
    const parent = selected?.parent()
    if (
      unavailable ||
      !editor ||
      !selected ||
      !parent ||
      !selected.get("draggable")
    )
      return
    const index = selected.index()
    const next = index + direction
    if (next < 0 || next >= parent.components().length) return
    selected.move(parent, { at: direction > 0 ? index + 2 : index - 1 })
    editor.select(selected)
    setSelection(readSelection(selected))
    setOutline(readOutline(editor))
    setAnnouncement(
      t("documents.studio.moved", {
        defaultValue: "Block moved to position {{position}}.",
        position: next + 1,
      }),
    )
  }
  const editSelected = async () => {
    const editor = editorRef.current
    const selected = editor?.getSelected()
    if (
      unavailable ||
      !editor ||
      !selected?.isInstanceOf("text") ||
      !selected.get("editable")
    )
      return
    const focusText = () => {
      if (editorRef.current !== editor || callbacksRef.current.disabled) return
      const element = selected.getEl()
      const label = t("documents.studio.editingText", {
        defaultValue: "Editing selected block text",
      })
      if (element && element.getAttribute("aria-label") !== label) {
        const attributes = ["role", "aria-label", "aria-multiline"] as const
        const previous = attributes.map((name) => element.getAttribute(name))
        element.setAttribute("role", "textbox")
        element.setAttribute("aria-label", label)
        element.setAttribute("aria-multiline", "true")
        selected.once("rte:disable", () => {
          attributes.forEach((name, index) => {
            const value = previous[index]
            if (value == null) element.removeAttribute(name)
            else element.setAttribute(name, value)
          })
        })
      }
      element?.focus()
    }
    try {
      const editing = editor.getEditing()
      const view = editing?.getView()
      if (
        editing &&
        editing !== selected &&
        view &&
        "disableEditing" in view &&
        typeof view.disableEditing === "function"
      ) {
        await view.disableEditing()
      }
      if (
        editorRef.current !== editor ||
        callbacksRef.current.disabled ||
        editor.getSelected() !== selected
      )
        return
      setPanel("canvas")
      if (editor.getEditing() === selected) {
        focusText()
        return
      }
      // The model event follows toggleEvents(), after getEditing() is current.
      // The editor-level event fires earlier and can race the first keystroke.
      selected.once("rte:enable", focusText)
      selected.trigger("focus")
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : t("documents.studio.loadError", {
              defaultValue:
                "The template designer could not load this content.",
            })
      setError(message)
      callbacksRef.current.onError?.(message)
    }
  }

  const changeZoom = (value: number) => {
    const editor = editorRef.current
    if (unavailable || !editor) return
    const next = Math.max(25, Math.min(150, value))
    editor.Canvas.setZoom(next)
    if (editor.Canvas.getFrameEl())
      editor.Canvas.fitViewport({ gap: 32, ignoreHeight: true, zoom: next })
  }

  return (
    <div
      className="lumiere-template-studio"
      data-testid="document-template-designer"
      data-panel={panel}
    >
      <div
        className="template-studio-toolbar"
        role="toolbar"
        aria-label={t("documents.studio.templateDesignActions", {
          defaultValue: "Template design actions",
        })}
      >
        <div className="template-studio-toolbar-group">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="template-studio-blocks-toggle"
            aria-label={t("documents.studio.toggleBlockLibrary", {
              defaultValue: "Toggle block library",
            })}
            aria-expanded={panel === "blocks"}
            onClick={() => setPanel(panel === "blocks" ? "canvas" : "blocks")}
          >
            <PanelLeft />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("documents.studio.undoDesignChange", {
              defaultValue: "Undo design change",
            })}
            title={t("documents.studio.undo", { defaultValue: "Undo" })}
            disabled={unavailable || !history.undo}
            onClick={() => editorRef.current?.UndoManager.undo()}
          >
            <Undo2 />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("documents.studio.redoDesignChange", {
              defaultValue: "Redo design change",
            })}
            title={t("documents.studio.redo", { defaultValue: "Redo" })}
            disabled={unavailable || !history.redo}
            onClick={() => editorRef.current?.UndoManager.redo()}
          >
            <Redo2 />
          </Button>
          <span className="template-studio-toolbar-divider" />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("documents.studio.deleteSelectedBlock", {
              defaultValue: "Delete selected block",
            })}
            title={t("documents.studio.deleteSelectedBlock", {
              defaultValue: "Delete selected block",
            })}
            disabled={unavailable || !selection?.removable}
            onClick={() => editorRef.current?.getSelected()?.remove()}
          >
            <Trash2 />
          </Button>
        </div>
        <span className="template-studio-toolbar-hint">
          <MousePointer2 />
          {t("documents.studio.doubleClickTextToEdit", {
            defaultValue: "Double-click text to edit",
          })}
        </span>
        <div
          className="template-studio-toolbar-group template-studio-zoom"
          aria-label={t("documents.studio.canvasZoomControls", {
            defaultValue: "Canvas zoom controls",
          })}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("documents.studio.zoomOut", {
              defaultValue: "Zoom out",
            })}
            disabled={unavailable || zoom <= 25}
            onClick={() => changeZoom(zoom - 10)}
          >
            <Minus />
          </Button>
          <select
            aria-label={t("documents.studio.canvasZoom", {
              defaultValue: "Canvas zoom",
            })}
            value={zoom}
            disabled={unavailable}
            onChange={(event) => changeZoom(Number(event.target.value))}
          >
            {!ZOOM_LEVELS.includes(zoom) ? (
              <option value={zoom}>{zoom}%</option>
            ) : null}
            {ZOOM_LEVELS.map((value) => (
              <option key={value} value={value}>
                {value}%
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("documents.studio.zoomIn", {
              defaultValue: "Zoom in",
            })}
            disabled={unavailable || zoom >= 150}
            onClick={() => changeZoom(zoom + 10)}
          >
            <Plus />
          </Button>
          <span className="template-studio-toolbar-divider" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="template-studio-fit"
            aria-label={t("documents.studio.fitPageToCanvas", {
              defaultValue: "Fit page to canvas",
            })}
            disabled={unavailable}
            onClick={() => {
              if (editorRef.current) fitCanvas(editorRef.current)
            }}
          >
            <Maximize />
            <span>{t("documents.studio.fit", { defaultValue: "Fit" })}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="template-studio-properties-toggle"
            aria-label={t("documents.studio.togglePropertiesPanel", {
              defaultValue: "Toggle properties panel",
            })}
            aria-expanded={panel === "properties"}
            onClick={() =>
              setPanel(panel === "properties" ? "canvas" : "properties")
            }
          >
            <SlidersHorizontal />
          </Button>
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {error ? (
        <p role="alert" className="template-studio-error">
          {error}
        </p>
      ) : null}
      <div className="template-studio-body">
        <aside
          className="template-studio-library"
          aria-label={t("documents.studio.templateBlocks", {
            defaultValue: "Template blocks",
          })}
        >
          <div className="template-studio-panel-heading">
            <span>
              <Blocks />
              {t("documents.studio.blocks", { defaultValue: "Blocks" })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="template-studio-library-close"
              aria-label={t("documents.studio.closeBlockLibrary", {
                defaultValue: "Close block library",
              })}
              onClick={() => setPanel("canvas")}
            >
              <X />
            </Button>
          </div>
          <div
            className="template-studio-library-tabs"
            role="group"
            aria-label={t("documents.studio.libraryView", {
              defaultValue: "Library view",
            })}
          >
            <button
              type="button"
              aria-pressed={libraryTab === "blocks"}
              onClick={() => setLibraryTab("blocks")}
            >
              {t("documents.studio.blocks", { defaultValue: "Blocks" })}
            </button>
            <button
              type="button"
              aria-pressed={libraryTab === "outline"}
              onClick={() => setLibraryTab("outline")}
            >
              {t("documents.studio.outline", { defaultValue: "Outline" })}
            </button>
          </div>
          {libraryTab === "outline" ? (
            <div className="template-studio-outline">
              <p>
                {t("documents.studio.outlineHint", {
                  defaultValue:
                    "Select a block here, then use Edit text or Move up/down in its properties.",
                })}
              </p>
              <ol
                aria-label={t("documents.studio.documentOutline", {
                  defaultValue: "Document outline",
                })}
              >
                {outline.map((block, index) => (
                  <li key={block.id}>
                    <button
                      type="button"
                      disabled={unavailable}
                      aria-pressed={selection?.id === block.id}
                      style={{
                        paddingInlineStart: `${12 + Math.min(block.depth, 4) * 10}px`,
                      }}
                      onClick={() => {
                        editorRef.current?.select(block.component)
                        setPanel("properties")
                      }}
                    >
                      <span>{index + 1}</span>
                      {block.name}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <>
              <div className="template-studio-library-tools">
                <div className="template-studio-search">
                  <Search aria-hidden="true" />
                  <input
                    type="search"
                    aria-label={t("documents.studio.searchBlocks", {
                      defaultValue: "Search blocks",
                    })}
                    placeholder={t("documents.studio.searchBlocksPlaceholder", {
                      defaultValue: "Search blocks…",
                    })}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  {search ? (
                    <button
                      type="button"
                      aria-label={t("documents.studio.clearBlockSearch", {
                        defaultValue: "Clear block search",
                      })}
                      onClick={() => setSearch("")}
                    >
                      <X />
                    </button>
                  ) : null}
                </div>
                <div
                  className="template-studio-categories"
                  aria-label={t("documents.studio.blockCategories", {
                    defaultValue: "Block categories",
                  })}
                >
                  {(
                    [
                      [
                        "all",
                        t("documents.studio.all", { defaultValue: "All" }),
                      ],
                      [
                        "text",
                        t("documents.studio.text", { defaultValue: "Text" }),
                      ],
                      [
                        "structure",
                        kind === "document"
                          ? t("documents.studio.layout", {
                              defaultValue: "Layout",
                            })
                          : t("documents.studio.structure", {
                              defaultValue: "Structure",
                            }),
                      ],
                      ...(kind === "document"
                        ? [
                            [
                              "data",
                              t("documents.studio.quotation", {
                                defaultValue: "Quotation",
                              }),
                            ] as const,
                          ]
                        : []),
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={category === value}
                      onClick={() => setCategory(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="template-studio-library-content">
                <p className="template-studio-section-label">
                  {category === "text"
                    ? t("documents.studio.textBlocks", {
                        defaultValue: "Text blocks",
                      })
                    : category === "structure"
                      ? t("documents.studio.buildStructure", {
                          defaultValue: "Build a structure",
                        })
                      : t("documents.studio.startBlock", {
                          defaultValue: "Start with a block",
                        })}
                  <span>{visibleBlocks.length}</span>
                </p>
                {visibleBlocks.length ? (
                  <div className="template-studio-block-grid">
                    {visibleBlocks.map(({ id, label, icon: Icon }) => (
                      <button
                        key={id}
                        type="button"
                        className="template-studio-block"
                        aria-label={label}
                        disabled={unavailable}
                        draggable={false}
                        onClick={(event) => {
                          if (event.detail > 0 && suppressClickRef.current) {
                            suppressClickRef.current = false
                            return
                          }
                          addBlock(id)
                        }}
                        onPointerDown={(event) => startBlockDrag(id, event)}
                      >
                        <BlockPreview id={id} />
                        <span className="template-studio-block-label">
                          <Icon />
                          <span>{label}</span>
                        </span>
                        <Plus
                          className="template-studio-block-add"
                          aria-hidden="true"
                        />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="template-studio-search-empty" role="status">
                    <Search />
                    <strong>
                      {t("documents.studio.noMatchingBlocks", {
                        defaultValue: "No matching blocks",
                      })}
                    </strong>
                    <span>
                      {t("documents.studio.tryAnotherWordOrCategory", {
                        defaultValue: "Try another word or category.",
                      })}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSearch("")
                        setCategory("all")
                      }}
                    >
                      {t("documents.studio.showAllBlocks", {
                        defaultValue: "Show all blocks",
                      })}
                    </button>
                  </div>
                )}
              </div>
              {kind === "document" ? (
                <p className="template-studio-data-hint">
                  {t("documents.studio.dataHint", {
                    defaultValue:
                      "Quotation fields are filled from the selected quotation when you preview or generate output. Line items and Brand logo must stay in their own blocks.",
                  })}
                </p>
              ) : null}
            </>
          )}
          <div className="template-studio-library-tip">
            <MousePointer2 />
            <p>
              {t("documents.studio.clickToAddABlock", {
                defaultValue: "Click to add a block.",
              })}
              <br />
              {t("documents.studio.dragToPlaceItOnThePage", {
                defaultValue: "Drag to place it on the page.",
              })}
            </p>
          </div>
        </aside>
        <div className="template-studio-workspace" aria-busy={!ready && !error}>
          {!ready && !error ? (
            <div className="template-studio-loading" role="status">
              <span />
              <p>
                {t("documents.studio.preparingYourCanvas", {
                  defaultValue: "Preparing your canvas…",
                })}
              </p>
            </div>
          ) : null}
          <div
            ref={containerRef}
            inert={disabled || undefined}
            aria-disabled={disabled || undefined}
            className="template-studio-canvas"
          />
          <div className="template-studio-canvas-caption">
            <FileText />
            <span>
              {kind === "document"
                ? t("documents.studio.documentLayout", {
                    defaultValue: "Document layout",
                  })
                : t("documents.studio.textTemplate", {
                    defaultValue: "Text template",
                  })}
            </span>
          </div>
        </div>
        <aside
          className="template-studio-inspector"
          aria-label={t("documents.studio.blockProperties", {
            defaultValue: "Block properties",
          })}
        >
          <div className="template-studio-panel-heading">
            <span>
              <SlidersHorizontal />
              {t("documents.studio.design", { defaultValue: "Design" })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="template-studio-inspector-close"
              aria-label={t("documents.studio.closePropertiesPanel", {
                defaultValue: "Close properties panel",
              })}
              onClick={() => setPanel("canvas")}
            >
              <X />
            </Button>
          </div>
          {selection ? (
            <>
              <div className="template-studio-selection">
                <span className="template-studio-selection-icon">
                  <MousePointer2 />
                </span>
                <div>
                  <span>
                    {t("documents.studio.selectedBlock", {
                      defaultValue: "Selected block",
                    })}
                  </span>
                  <strong>{selection.name}</strong>
                </div>
                <span className="template-studio-tag">{selection.tagName}</span>
              </div>
              <div className="template-studio-selection-actions">
                <Button
                  ref={editButtonRef}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={unavailable || !selection.editable}
                  onClick={editSelected}
                >
                  <Pencil />
                  {t("documents.studio.editText", {
                    defaultValue: "Edit text",
                  })}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={t("documents.studio.moveUp", {
                    defaultValue: "Move selected block up",
                  })}
                  disabled={unavailable || !selection.previous}
                  onClick={() => moveSelected(-1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={t("documents.studio.moveDown", {
                    defaultValue: "Move selected block down",
                  })}
                  disabled={unavailable || !selection.next}
                  onClick={() => moveSelected(1)}
                >
                  <ArrowDown />
                </Button>
              </div>
              {kind === "document" ? (
                <fieldset
                  className="template-studio-properties"
                  disabled={unavailable}
                >
                  <legend className="sr-only">
                    {t("documents.studio.selectedBlockProperties", {
                      defaultValue: "Selected block properties",
                    })}
                  </legend>
                  <section className="template-studio-property-group">
                    <h3>
                      {t("documents.studio.typography", {
                        defaultValue: "Typography",
                      })}
                    </h3>
                    <label>
                      {t("documents.studio.textSize", {
                        defaultValue: "Text size",
                      })}
                      <select
                        aria-label={t("documents.studio.textSize", {
                          defaultValue: "Text size",
                        })}
                        className={CONTROL_CLASS}
                        value={selection.fontSize}
                        onChange={(event) =>
                          setStyle("font-size", event.target.value)
                        }
                      >
                        <option value="">
                          {t("documents.studio.default", {
                            defaultValue: "Default",
                          })}
                        </option>
                        {selection.fontSize &&
                        !TEXT_SIZES.includes(selection.fontSize) ? (
                          <option value={selection.fontSize}>
                            {selection.fontSize}
                          </option>
                        ) : null}
                        {TEXT_SIZES.map((size) => (
                          <option key={size} value={size}>
                            {size.replace("px", " px")}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t("documents.studio.alignment", {
                        defaultValue: "Alignment",
                      })}
                      <select
                        aria-label={t("documents.studio.alignment", {
                          defaultValue: "Alignment",
                        })}
                        className={CONTROL_CLASS}
                        value={selection.textAlign}
                        onChange={(event) =>
                          setStyle("text-align", event.target.value)
                        }
                      >
                        <option value="">
                          {t("documents.studio.default", {
                            defaultValue: "Default",
                          })}
                        </option>
                        <option value="left">
                          {t("documents.studio.left", { defaultValue: "Left" })}
                        </option>
                        <option value="center">
                          {t("documents.studio.center", {
                            defaultValue: "Center",
                          })}
                        </option>
                        <option value="right">
                          {t("documents.studio.right", {
                            defaultValue: "Right",
                          })}
                        </option>
                      </select>
                    </label>
                  </section>
                  <section className="template-studio-property-group">
                    <h3>
                      {t("documents.studio.color", { defaultValue: "Color" })}
                    </h3>
                    <label>
                      {t("documents.studio.text", { defaultValue: "Text" })}
                      <div className="template-studio-color-control">
                        <input
                          aria-label={t("documents.studio.textColor", {
                            defaultValue: "Text color",
                          })}
                          type="color"
                          value={selection.color}
                          onChange={(event) =>
                            setStyle("color", event.target.value)
                          }
                        />
                        <span>{selection.color.toUpperCase()}</span>
                      </div>
                    </label>
                    <label>
                      {t("documents.studio.background", {
                        defaultValue: "Background",
                      })}
                      <div className="template-studio-color-control">
                        <input
                          aria-label={t("documents.studio.backgroundColor", {
                            defaultValue: "Background color",
                          })}
                          type="color"
                          value={selection.background}
                          onChange={(event) =>
                            setStyle("background-color", event.target.value)
                          }
                        />
                        <span>{selection.background.toUpperCase()}</span>
                      </div>
                    </label>
                  </section>
                  <section className="template-studio-property-group">
                    <h3>
                      {t("documents.studio.spacingBorder", {
                        defaultValue: "Spacing & border",
                      })}
                    </h3>
                    <label>
                      {t("documents.studio.padding", {
                        defaultValue: "Padding",
                      })}
                      <select
                        aria-label={t("documents.studio.padding", {
                          defaultValue: "Padding",
                        })}
                        className={CONTROL_CLASS}
                        value={selection.padding}
                        onChange={(event) =>
                          setStyle("padding", event.target.value)
                        }
                      >
                        <option value="">
                          {t("documents.studio.default", {
                            defaultValue: "Default",
                          })}
                        </option>
                        {selection.padding &&
                        !PADDING_VALUES.includes(selection.padding) ? (
                          <option
                            value={selection.padding}
                            disabled={selection.padding === CUSTOM_SIDES}
                          >
                            {selection.padding === CUSTOM_SIDES
                              ? t("documents.studio.customSides", {
                                  defaultValue: "Custom sides",
                                })
                              : selection.padding}
                          </option>
                        ) : null}
                        {PADDING_VALUES.map((size) => (
                          <option key={size} value={size}>
                            {size.replace("px", " px")}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t("documents.studio.border", { defaultValue: "Border" })}
                      <select
                        aria-label={t("documents.studio.border", {
                          defaultValue: "Border",
                        })}
                        className={CONTROL_CLASS}
                        value={selection.border}
                        onChange={(event) =>
                          setStyle("border", event.target.value)
                        }
                      >
                        <option value="">
                          {t("documents.studio.default", {
                            defaultValue: "Default",
                          })}
                        </option>
                        {selection.border &&
                        !BORDER_VALUES.includes(selection.border) ? (
                          <option
                            value={selection.border}
                            disabled={selection.border === CUSTOM_SIDES}
                          >
                            {selection.border === CUSTOM_SIDES
                              ? t("documents.studio.customSides", {
                                  defaultValue: "Custom sides",
                                })
                              : selection.border}
                          </option>
                        ) : null}
                        <option value="none">
                          {t("documents.studio.none", { defaultValue: "None" })}
                        </option>
                        <option value="1px solid #d1d5db">
                          {t("documents.studio.light", {
                            defaultValue: "Light",
                          })}
                        </option>
                        <option value="2px solid #1f2937">
                          {t("documents.studio.strong", {
                            defaultValue: "Strong",
                          })}
                        </option>
                      </select>
                    </label>
                  </section>
                </fieldset>
              ) : (
                <div className="template-studio-rich-details">
                  <h3>
                    {t("documents.studio.editOnThePage", {
                      defaultValue: "Edit on the page",
                    })}
                  </h3>
                  <p>
                    {t(
                      "documents.studio.doubleClickTextToWriteAndApplyBoldItalicOrStrikethrough",
                      {
                        defaultValue:
                          "Double-click text or choose Edit text. Press Escape to return to the properties panel.",
                      },
                    )}
                  </p>
                  <div>
                    <FileText />
                    <strong>
                      {t("documents.studio.readyForTextFields", {
                        defaultValue: "Ready for text fields",
                      })}
                    </strong>
                    <p>
                      {t(
                        "documents.studio.headingsListsAndTablesStayEditableWhenThisTemplateIsInserted",
                        {
                          defaultValue:
                            "Headings, lists and tables stay editable when this template is inserted.",
                        },
                      )}
                    </p>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="template-studio-empty-selection">
              <div className="template-studio-empty-graphic">
                <span />
                <MousePointer2 />
              </div>
              <h3>
                {t("documents.studio.aLittleDetailGoesALongWay", {
                  defaultValue: "A little detail goes a long way",
                })}
              </h3>
              <p>
                {kind === "document"
                  ? t("documents.studio.selectDocumentHint", {
                      defaultValue:
                        "Select a block on the page or in the outline to adjust typography, colors and spacing.",
                    })
                  : t("documents.studio.selectTextHint", {
                      defaultValue:
                        "Select a block on the page or in the outline to edit or reorder it.",
                    })}
              </p>
              <div>
                <span>1</span>
                <p>
                  {t("documents.studio.addBlocksFromTheLibrary", {
                    defaultValue: "Add blocks from the library",
                  })}
                </p>
              </div>
              <div>
                <span>2</span>
                <p>
                  {t("documents.studio.doubleClickTextToEdit", {
                    defaultValue: "Double-click text to edit",
                  })}
                </p>
              </div>
              <div>
                <span>3</span>
                <p>
                  {kind === "document"
                    ? t("documents.studio.shapeLayout", {
                        defaultValue: "Shape your layout here",
                      })
                    : t("documents.studio.saveReuse", {
                        defaultValue: "Save and reuse your text",
                      })}
                </p>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

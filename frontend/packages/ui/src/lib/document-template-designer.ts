import { i18n as uiI18n } from "@lumiere/i18n"
import DOMPurify from "dompurify"
import { z } from "zod"

/** The stored project is the source; bodyHtml is a projection of this version. */
export type DocumentDesignerKind = "rich-text" | "document"

const MAX_PROJECT_BYTES = 1_000_000
const MAX_COMPONENTS = 2_000
const MAX_DEPTH = 32
const semanticTags = [
  "p", "h1", "h2", "h3", "strong", "b", "em", "i", "s", "strike", "del",
  "code", "pre", "blockquote", "ul", "ol", "li", "table", "thead", "tbody",
  "tfoot", "tr", "td", "th", "hr", "br", "a", "span", "div",
] as const
const documentTags = [...semanticTags, "section", "header", "footer"] as const
const componentTypes = [
  "", "default", "wrapper", "text", "textnode", "link", "table", "thead",
  "tbody", "tfoot", "row", "cell",
] as const

type DesignerTag = (typeof documentTags)[number]
type DesignerComponentType = (typeof componentTypes)[number]

export interface DocumentDesignerComponent {
  type?: DesignerComponentType
  tagName?: DesignerTag
  name?: string
  content?: string
  components?: DocumentDesignerComponent[]
  attributes?: Record<string, string>
  style?: Record<string, string>
}

export interface DocumentDesignerProject {
  assets: never[]
  styles: never[]
  pages: {
    id?: string
    name?: string
    frames: { id?: string; component: DocumentDesignerComponent }[]
  }[]
}

export interface DocumentDesignerState {
  schemaVersion: 1
  engine: "grapesjs"
  kind: DocumentDesignerKind
  project: DocumentDesignerProject
}

export interface DocumentDesignerSnapshot {
  designer: DocumentDesignerState
  bodyHtml: string
}

// Versioned rendering defaults are shared by the canvas and HTML projection.
// Keep page presentation out of rich-text fields, which retain their own theme.
const documentDefaultStyles: Partial<Record<DesignerTag | "body", Record<string, string>>> = {
  body: { margin: "0", padding: "24px", "background-color": "#ffffff", color: "#1f2937", "font-family": "Arial, sans-serif", "font-size": "14px", "line-height": "1.6" },
  h1: { "line-height": "1.3" },
  h2: { "line-height": "1.3" },
  h3: { "line-height": "1.3" },
  p: { margin: "0.5em 0" },
  table: { width: "100%", "border-collapse": "collapse" },
  th: { border: "1px solid #d1d5db", padding: "8px", "text-align": "left", "vertical-align": "top", "background-color": "#f3f4f6" },
  td: { border: "1px solid #d1d5db", padding: "8px", "text-align": "left", "vertical-align": "top" },
  blockquote: { "border-left": "3px solid #d1d5db", "margin-left": "0", "padding-left": "16px" },
  hr: { border: "0", "border-top": "1px solid #d1d5db", margin: "16px 0" },
}

export const DOCUMENT_TEMPLATE_CANVAS_CSS = "*{box-sizing:border-box}" + Object.entries(documentDefaultStyles)
  .map(([tag, style]) => `${tag}{${styleText(style)}}`).join("")

const attributeValue = z.union([z.string(), z.number(), z.boolean()]).transform(String)
const componentSchema: z.ZodType<DocumentDesignerComponent, z.ZodTypeDef, unknown> = z.lazy(() => z.object({
  type: z.enum(componentTypes).optional(),
  tagName: z.enum(documentTags).optional(),
  name: z.string().max(120).optional(),
  content: z.string().max(MAX_PROJECT_BYTES).optional(),
  components: z.array(componentSchema).max(MAX_COMPONENTS).optional(),
  attributes: z.record(attributeValue).optional(),
  style: z.record(z.union([z.string(), z.number()]).transform(String)).optional(),
  // Project JSON bypasses the HTML parser. Never pass scripts to loadProjectData.
  script: z.never().optional(),
  "script-export": z.never().optional(),
  "script-props": z.never().optional(),
  // Other model settings (head/docEl, traits, classes, custom behaviors) are
  // intentionally stripped. GrapesJS restores its built-in defaults on load.
}))

const safeId = z.string().regex(/^[\w-]{1,120}$/)
const projectSchema = z.object({
  assets: z.array(z.never()).default([]),
  styles: z.array(z.never()).default([]),
  pages: z.array(z.object({
    id: safeId.optional(),
    name: z.string().max(120).optional(),
    frames: z.array(z.object({
      id: safeId.optional(),
      component: componentSchema,
    })).length(1),
  })).length(1),
  symbols: z.array(z.never()).optional(),
  dataSources: z.array(z.never()).optional(),
})

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
const jsonValue: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.array(jsonValue), z.record(jsonValue),
]))
const metadataSchema = z.record(jsonValue)

function assertBoundedJson(value: unknown): void {
  let serialized: string | undefined
  try { serialized = JSON.stringify(value) } catch { throw new Error(uiI18n.t("documents.builtIn.documentTemplateDesigner.assertBoundedJson.error", { defaultValue: "Template data is not valid JSON." })) }
  if (!serialized || new TextEncoder().encode(serialized).length > MAX_PROJECT_BYTES) {
    throw new Error(uiI18n.t("documents.builtIn.documentTemplateDesigner.assertBoundedJson.errortemplateDataExceedsThe1MBLimit", { defaultValue: "Template data exceeds the 1 MB limit." }))
  }
  const visit = (node: unknown, depth: number): void => {
    if (depth > MAX_DEPTH * 3) throw new Error(uiI18n.t("documents.builtIn.documentTemplateDesigner.visit.error", { defaultValue: "Template data is nested too deeply." }))
    if (Array.isArray(node)) node.forEach((child) => visit(child, depth + 1))
    else if (typeof node === "object" && node !== null) {
      Object.values(node).forEach((child) => visit(child, depth + 1))
    }
  }
  visit(value, 0)
}

const length = /^(?:0|\d{1,4}(?:\.\d{1,2})?(?:px|pt|em|rem|%|mm|cm))$/
const color = /^(?:#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})|transparent|black|white|gray|grey|red|green|blue|navy|inherit)$/i
const border = /^(?:0|none|\d{1,2}(?:px|pt) (?:solid|dashed|dotted) (?:#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})|black|white|gray|grey))$/i

/** Browsers serialize pasted hex colors as rgb(); keep those stable on reload. */
function normalizeCssColors(value: string): string {
  return value.replace(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)/gi,
    (match: string, red: string, green: string, blue: string, alpha: string | undefined) => {
      const channels = [Number(red), Number(green), Number(blue)]
      if (channels.some((channel) => channel > 255) || (alpha !== undefined && Number(alpha) > 1)) return match
      if (alpha !== undefined && Number(alpha) < 1) channels.push(Math.round(Number(alpha) * 255))
      return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`
    })
}

/** No URLs, custom properties, selectors, @rules or executable CSS are accepted. */
function safeStyleValue(property: string, value: string): boolean {
  if (value.length > 120) return false
  if (/^(?:color|background-color|border-color)$/.test(property)) return color.test(value)
  if (/^(?:width|min-width|max-width|height|min-height|max-height|font-size|border-width|border-spacing)$/.test(property)) {
    return length.test(value) || (property !== "font-size" && value === "auto")
  }
  if (/^(?:padding|margin)(?:-(?:top|right|bottom|left))?$/.test(property)) {
    const values = value.split(/\s+/)
    return values.length <= 4 && values.every((item) => length.test(item) || (property.startsWith("margin") && item === "auto"))
  }
  if (/^border(?:-(?:top|right|bottom|left))?$/.test(property)) return border.test(value)
  if (property === "font-family") return /^(?:Arial|Georgia|Verdana|Times New Roman|sans-serif|serif|monospace)(?:, (?:sans-serif|serif|monospace))?$/.test(value)
  if (property === "font-weight") return /^(?:normal|bold|[1-9]00)$/.test(value)
  if (property === "line-height") return /^(?:normal|[0-3](?:\.\d{1,2})?)$/.test(value) || length.test(value)
  if (property === "text-align") return /^(?:left|center|right|justify)$/.test(value)
  if (property === "vertical-align") return /^(?:top|middle|bottom|baseline)$/.test(value)
  if (property === "border-collapse") return /^(?:collapse|separate)$/.test(value)
  if (property === "border-style") return /^(?:none|solid|dashed|dotted)$/.test(value)
  if (property === "display") return /^(?:block|inline|inline-block|table|table-row|table-cell)$/.test(value)
  return false
}

function normalizeStyles(style: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(Object.entries(style).flatMap(([property, raw]) => {
    const value = normalizeCssColors(raw.trim())
    return safeStyleValue(property, value) ? [[property, value]] : []
  }))
}

function styleText(style: Record<string, string>): string {
  return Object.entries(style).map(([property, value]) => `${property}:${value}`).join(";")
}

function safeHref(value: string): boolean {
  return !/[\u0000-\u0020\u007f]/.test(value) && /^(?:https?:\/\/|mailto:|tel:|\/|#)/i.test(value)
}

function normalizeAttributes(attributes: Record<string, string> = {}): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (key === "href" && safeHref(value)) result.href = value
    if (key === "title" && value.length <= 500) result.title = value
    if ((key === "colspan" || key === "rowspan") && /^(?:[1-9]|[1-9]\d)$/.test(value)) result[key] = value
    if (key === "start" && /^\d{1,6}$/.test(value)) result.start = value
    if (key === "data-type" && /^(?:taskList|taskItem)$/.test(value)) result[key] = value
    if (key === "data-checked" && /^(?:true|false)$/.test(value)) result[key] = value
    // Retain generated IDs only in the project, never in the exported fragment.
    if (key === "id" && /^[\w-]{1,120}$/.test(value)) result.id = value
  }
  if (result.href) {
    result.target = "_blank"
    result.rel = "noopener noreferrer nofollow"
  }
  return result
}

function sanitizeTemplateHtml(html: string, kind: DocumentDesignerKind): string {
  if (new TextEncoder().encode(html).length > MAX_PROJECT_BYTES) throw new Error(uiI18n.t("documents.builtIn.documentTemplateDesigner.sanitizeTemplateHtml.error", { defaultValue: "Template content exceeds the 1 MB limit." }))
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...(kind === "document" ? documentTags : semanticTags)],
    ALLOWED_ATTR: ["href", "title", "colspan", "rowspan", "start", "data-type", "data-checked", ...(kind === "document" ? ["style"] : [])],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  })
  for (const element of fragment.querySelectorAll("*")) {
    const attrs = normalizeAttributes(Object.fromEntries(Array.from(element.attributes, (attr) => [attr.name, attr.value])))
    let styles = ""
    if (kind === "document" && element instanceof HTMLElement && element.hasAttribute("style")) {
      styles = styleText(normalizeStyles(Object.fromEntries(Array.from(element.style, (property) => [property, element.style.getPropertyValue(property)]))))
    }
    for (const attr of Array.from(element.attributes)) element.removeAttribute(attr.name)
    for (const [key, value] of Object.entries(attrs)) if (key !== "id") element.setAttribute(key, value)
    if (styles) element.setAttribute("style", styles)
  }
  const host = document.createElement("div")
  host.append(fragment)
  return host.innerHTML
}

export function sanitizeRichTextTemplateHtml(html: string): string {
  return sanitizeTemplateHtml(html, "rich-text")
}

export function sanitizeDocumentTemplateHtml(html: string): string {
  return sanitizeTemplateHtml(html, "document")
}

function normalizeProject(input: unknown, kind: DocumentDesignerKind): DocumentDesignerProject {
  assertBoundedJson(input)
  const parsed = projectSchema.safeParse(input)
  if (!parsed.success) throw new Error(uiI18n.t("documents.builtIn.documentTemplateDesigner.normalizeProject.error", { defaultValue: "This template contains unsupported project data. Only built-in text and page blocks are supported." }))
  let count = 0
  const normalize = (component: DocumentDesignerComponent, depth: number): DocumentDesignerComponent => {
    if (++count > MAX_COMPONENTS || depth > MAX_DEPTH) throw new Error(uiI18n.t("documents.builtIn.documentTemplateDesigner.normalize.error", { defaultValue: "This template has too many nested blocks." }))
    if (kind === "rich-text" && component.tagName && !semanticTags.some((tag) => tag === component.tagName)) {
      throw new Error(uiI18n.t("documents.builtIn.documentTemplateDesigner.normalize.erroraTextTemplateCannotContainPageLayout", { defaultValue: "A text template cannot contain page layout blocks." }))
    }
    return {
      ...component,
      attributes: normalizeAttributes(component.attributes),
      style: kind === "document" ? normalizeStyles(component.style) : {},
      content: component.content === undefined ? undefined : component.type === "textnode"
        ? component.content
        : sanitizeTemplateHtml(component.content, kind),
      components: component.components?.map((child) => normalize(child, depth + 1)),
    }
  }
  const page = parsed.data.pages[0]!
  const frame = page.frames[0]!
  if (frame.component.type !== "wrapper") throw new Error(uiI18n.t("documents.builtIn.documentTemplateDesigner.normalizeProject.errortheTemplateMustContainOnePageWrapper", { defaultValue: "The template must contain one page wrapper." }))
  return { assets: [], styles: [], pages: [{
    id: page.id,
    name: page.name,
    frames: [{ id: frame.id, component: normalize(frame.component, 0) }],
  }] }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!)
}

function renderDocumentContent(html: string): string {
  if (!html) return ""
  const host = document.createElement("div")
  host.innerHTML = html // Already sanitized while normalizing the project.
  for (const element of host.querySelectorAll<HTMLElement>("*")) {
    const defaults = documentDefaultStyles[element.tagName.toLowerCase() as DesignerTag]
    const authored = Object.fromEntries(Array.from(element.style, (property) => [property, element.style.getPropertyValue(property)]))
    element.setAttribute("style", styleText({ "box-sizing": "border-box", ...defaults, ...authored }))
  }
  return host.innerHTML
}

function renderComponent(component: DocumentDesignerComponent, kind: DocumentDesignerKind): string {
  if (component.type === "textnode") return escapeHtml(component.content ?? "")
  const content = kind === "document" ? renderDocumentContent(component.content ?? "") : component.content ?? ""
  const children = content + (component.components ?? []).map((child) => renderComponent(child, kind)).join("")
  if (component.type === "wrapper" && kind === "rich-text") return children
  const defaultTags: Partial<Record<DesignerComponentType, DesignerTag>> = {
    wrapper: "div", link: "a", table: "table", thead: "thead", tbody: "tbody", tfoot: "tfoot", row: "tr", cell: "td",
  }
  const tag = component.tagName ?? defaultTags[component.type ?? ""] ?? "div"
  const attrs = Object.entries(component.attributes ?? {}).filter(([key]) => key !== "id").map(([key, value]) => ` ${key}="${escapeHtml(value)}"`).join("")
  const styles = kind === "document" ? styleText({
    "box-sizing": "border-box",
    ...documentDefaultStyles[component.type === "wrapper" ? "body" : tag],
    ...component.style,
  }) : ""
  const open = `<${tag}${attrs}${styles ? ` style="${escapeHtml(styles)}"` : ""}>`
  return tag === "br" || tag === "hr" ? open : `${open}${children}</${tag}>`
}

export function createDocumentDesignerSnapshot(kind: DocumentDesignerKind, project: unknown): DocumentDesignerSnapshot {
  const normalized = normalizeProject(project, kind)
  return {
    designer: { schemaVersion: 1, engine: "grapesjs", kind, project: normalized },
    bodyHtml: renderComponent(normalized.pages[0]!.frames[0]!.component, kind),
  }
}

function readMetadata(metadata: string | null | undefined): z.infer<typeof metadataSchema> {
  if (!metadata?.trim()) return {}
  if (metadata.length > MAX_PROJECT_BYTES) throw new Error(uiI18n.t("documents.builtIn.documentTemplateDesigner.readMetadata.error", { defaultValue: "Template metadata exceeds the 1 MB limit." }))
  let parsed: unknown
  try { parsed = JSON.parse(metadata) } catch { throw new Error(uiI18n.t("documents.builtIn.documentTemplateDesigner.readMetadata.errortemplateMetadataIsNotValidJSON", { defaultValue: "Template metadata is not valid JSON." })) }
  assertBoundedJson(parsed)
  const result = metadataSchema.safeParse(parsed)
  if (!result.success) throw new Error(uiI18n.t("documents.builtIn.documentTemplateDesigner.readMetadata.errortemplateMetadataMustBeAJSONObject", { defaultValue: "Template metadata must be a JSON object." }))
  return result.data
}

const designerSchema = z.object({
  schemaVersion: z.literal(1),
  engine: z.literal("grapesjs"),
  kind: z.enum(["rich-text", "document"]),
  project: z.unknown(),
})

/** Missing designer metadata is a legacy template; malformed/newer data is never overwritten. */
export function readDocumentDesignerMetadata(metadata: string | null | undefined): DocumentDesignerState | null {
  const envelope = readMetadata(metadata)
  if (!("documentDesigner" in envelope)) return null
  const parsed = designerSchema.safeParse(envelope.documentDesigner)
  if (!parsed.success) throw new Error(uiI18n.t("documents.builtIn.documentTemplateDesigner.readDocumentDesignerMetadata.error", { defaultValue: "This template uses an unsupported designer format." }))
  return createDocumentDesignerSnapshot(parsed.data.kind, parsed.data.project).designer
}

/** Text fields consume the validated project, never an independently edited HTML cache. */
export function readRichTextTemplateHtml(metadata: string | null | undefined): string | null {
  const designer = readDocumentDesignerMetadata(metadata)
  return designer?.kind === "rich-text"
    ? renderComponent(designer.project.pages[0]!.frames[0]!.component, "rich-text")
    : null
}

export function mergeDocumentDesignerMetadata(metadata: string | null | undefined, designer: DocumentDesignerState): string {
  const envelope = readMetadata(metadata)
  // Validate an existing namespace before replacing it, including future versions.
  if ("documentDesigner" in envelope) readDocumentDesignerMetadata(metadata)
  const validated = createDocumentDesignerSnapshot(designer.kind, designer.project).designer
  const result = JSON.stringify({ ...envelope, documentDesigner: validated })
  if (new TextEncoder().encode(result).length > MAX_PROJECT_BYTES) throw new Error(uiI18n.t("documents.builtIn.documentTemplateDesigner.readMetadata.error", { defaultValue: "Template metadata exceeds the 1 MB limit." }))
  return result
}

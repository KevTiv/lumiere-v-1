import { describe, expect, it } from "vitest"
import {
  createDocumentDesignerSnapshot,
  mergeDocumentDesignerMetadata,
  readDocumentDesignerMetadata,
  readRichTextTemplateHtml,
  sanitizeDocumentTemplateHtml,
  sanitizeRichTextTemplateHtml,
} from "./document-template-designer"

const project = (components: unknown[], style = {}) => ({
  assets: [], styles: [], dataSources: [], symbols: [],
  pages: [{ id: "page-1", frames: [{ id: "frame-1", component: { type: "wrapper", style, components } }] }],
})

describe("document designer project persistence", () => {
  it("saves and reopens one canonical project without losing semantic content", () => {
    const input = project([
      { type: "text", tagName: "h2", components: [{ type: "textnode", content: "R&D < review" }] },
      { type: "text", tagName: "p", content: "Hello <strong>{{customer.name}}</strong>" },
      { type: "table", components: [{ type: "tbody", components: [{ type: "row", components: [
        { type: "cell", content: "Terms" }, { type: "cell", content: "30 days" },
      ] }] }] },
    ])
    const snapshot = createDocumentDesignerSnapshot("rich-text", input)
    const metadata = mergeDocumentDesignerMetadata('{"ownerNote":"keep me","source":{"version":2}}', snapshot.designer)
    expect(JSON.parse(metadata).ownerNote).toBe("keep me")
    expect(JSON.parse(metadata).source).toEqual({ version: 2 })
    const restored = readDocumentDesignerMetadata(metadata)!
    expect(createDocumentDesignerSnapshot(restored.kind, restored.project)).toEqual(snapshot)
    expect(readRichTextTemplateHtml(metadata)).toBe(snapshot.bodyHtml)
    expect(snapshot.bodyHtml).toContain("<h2>R&amp;D &lt; review</h2>")
    expect(snapshot.bodyHtml).toContain("<strong>{{customer.name}}</strong>")
    expect(snapshot.bodyHtml).toContain("<table><tbody><tr><td>Terms</td><td>30 days</td></tr></tbody></table>")
  })

  it("preserves supported page styles separately from text templates", () => {
    const input = project([{ type: "text", tagName: "h1", content: "Proposal", style: {
      color: "#172554", "font-size": "24px", "text-align": "center", padding: "12px 0",
    }, attributes: { id: "heading-1", style: "background:url(https://tracker.example)" } }], { padding: "24px", width: "100%" })
    const layout = createDocumentDesignerSnapshot("document", input)
    const host = document.createElement("div")
    host.innerHTML = layout.bodyHtml
    expect(host.querySelector("div")?.style.padding).toBe("24px")
    expect(host.querySelector("div")?.style.width).toBe("100%")
    expect(host.querySelector("h1")?.style.color).toBe("rgb(23, 37, 84)")
    expect(host.querySelector("h1")?.style.fontSize).toBe("24px")
    expect(host.querySelector("h1")?.style.textAlign).toBe("center")
    expect(layout.bodyHtml).not.toContain("id=")
    expect(layout.bodyHtml).not.toContain("tracker")
    expect(readRichTextTemplateHtml(mergeDocumentDesignerMetadata(null, layout.designer))).toBeNull()
    const text = createDocumentDesignerSnapshot("rich-text", input)
    expect(text.bodyHtml).toBe("<h1>Proposal</h1>")
    expect(text.designer.project.pages[0]!.frames[0]!.component.components?.[0]?.style).toEqual({})
  })

  it("treats legacy metadata as non-designer data and rejects malformed or future namespaces", () => {
    expect(readDocumentDesignerMetadata(null)).toBeNull()
    expect(readDocumentDesignerMetadata('{"other":true}')).toBeNull()
    expect(() => readDocumentDesignerMetadata("{" )).toThrow("valid JSON")
    expect(() => readDocumentDesignerMetadata("[]")).toThrow("JSON object")
    const snapshot = createDocumentDesignerSnapshot("rich-text", project([]))
    expect(() => mergeDocumentDesignerMetadata('{"documentDesigner":{"schemaVersion":2}}', snapshot.designer)).toThrow("unsupported")
  })

  it.each([
    { type: "text", tagName: "p", script: "alert(1)" },
    { type: "text", tagName: "p", "script-export": "alert(1)" },
    { type: "image", attributes: { src: "https://tracker.example" } },
    { type: "text", tagName: "iframe" },
    { type: "custom-code", content: "<script>alert(1)</script>" },
  ])("rejects executable or unsupported project components: %j", (component) => {
    expect(() => createDocumentDesignerSnapshot("document", project([component]))).toThrow("unsupported project data")
  })

  it("rejects assets, global CSS and live data sources at the project boundary", () => {
    for (const extra of [
      { assets: [{ src: "https://tracker.example" }] },
      { styles: [{ selectors: ["body"], style: { background: "url(https://tracker.example)" } }] },
      { dataSources: [{ id: "remote", records: [] }] },
    ]) expect(() => createDocumentDesignerSnapshot("document", { ...project([]), ...extra })).toThrow("unsupported")
  })

  it("removes non-exportable model attributes, wrapper head and unsafe inline styles", () => {
    const input = project([{
      type: "text", tagName: "p", content: '<b onclick="alert(1)">Safe</b><script>alert(1)</script>',
      attributes: { onclick: "alert(1)", "data-gjs-script": "alert(1)", href: "javascript:alert(1)" },
      style: { color: "#112233", "background-image": "url(https://tracker.example)", position: "fixed", width: "expression(alert(1))" },
    }])
    Object.assign(input.pages[0]!.frames[0]!.component, { head: { components: [{ type: "script", content: "alert(1)" }] }, traits: [{ type: "custom" }] })
    const snapshot = createDocumentDesignerSnapshot("document", input)
    const host = document.createElement("div")
    host.innerHTML = snapshot.bodyHtml
    expect(host.querySelector("p")?.style.color).toBe("rgb(17, 34, 51)")
    expect(host.querySelector("b")?.textContent).toBe("Safe")
    expect(JSON.stringify(snapshot)).not.toMatch(/alert|tracker|head|traits|data-gjs|onclick|expression/)
  })

  it("bounds project size, nesting and block count before loading the editor", () => {
    expect(() => createDocumentDesignerSnapshot("rich-text", project([{ type: "textnode", content: "a".repeat(1_000_001) }]))).toThrow("1 MB")
    expect(() => createDocumentDesignerSnapshot("rich-text", project(Array.from({ length: 2_001 }, () => ({ tagName: "p", content: "a" }))))).toThrow()
    let child: unknown = { tagName: "p", content: "a" }
    for (let i = 0; i < 40; i++) child = { tagName: "div", components: [child] }
    expect(() => createDocumentDesignerSnapshot("document", project([child]))).toThrow(/nested|nesting/)
  })
})

describe("template HTML boundaries", () => {
  it("preserves supported prose and links while removing executable or resource-loading content", () => {
    const output = sanitizeRichTextTemplateHtml('<h2 style="color:red">Terms</h2><p><strong>Bold</strong> <a href="https://example.com" onclick="alert(1)">Details</a><a href="javascript:alert(1)">Bad</a></p><img src="https://tracker.example"><iframe src="https://tracker.example"></iframe><svg onload="alert(1)"></svg><script>alert(1)</script>')
    expect(output).toContain("<h2>Terms</h2>")
    expect(output).toContain("<strong>Bold</strong>")
    expect(output).toContain('href="https://example.com"')
    expect(output).toContain('rel="noopener noreferrer nofollow"')
    expect(output).not.toMatch(/script|style=|onclick|iframe|img|svg|tracker|alert/)
  })

  it("preserves list/table attributes without allowing arbitrary data attributes", () => {
    expect(sanitizeRichTextTemplateHtml('<ul data-type="taskList"><li data-type="taskItem" data-checked="true" data-gjs-script="alert(1)"><p>Done</p></li></ul><table><tbody><tr><td colspan="2">Total</td></tr></tbody></table>')).toContain('data-checked="true"')
    expect(sanitizeRichTextTemplateHtml('<p data-type="script" data-checked="no" data-other="x">Text</p>')).toBe("<p>Text</p>")
  })

  it("limits document HTML styles to local presentation properties", () => {
    const output = sanitizeDocumentTemplateHtml('<section style="padding:12px; background-image:url(https://tracker.example); position:fixed"><p style="font-size:20px; text-align:center">Text</p></section>')
    expect(output).toBe('<section style="padding:12px"><p style="font-size:20px;text-align:center">Text</p></section>')
  })

  it("preserves palette colors and borders after the browser canonicalizes their CSS", () => {
    const output = sanitizeDocumentTemplateHtml('<section style="border:1px solid #d1d5db"><p style="color:#172554;background-color:#f3f4f6">Hello</p></section>')
    const host = document.createElement("div")
    host.innerHTML = output
    expect(host.querySelector("section")?.style.border).toBe("1px solid rgb(209, 213, 219)")
    expect(host.querySelector("p")?.style.color).toBe("rgb(23, 37, 84)")
    expect(host.querySelector("p")?.style.backgroundColor).toBe("rgb(243, 244, 246)")
    expect(sanitizeDocumentTemplateHtml(output)).toBe(output)
  })

  it("applies the content size limit to UTF-8 bytes", () => {
    expect(() => sanitizeRichTextTemplateHtml(`<p>${"€".repeat(400_000)}</p>`)).toThrow("1 MB")
  })
})

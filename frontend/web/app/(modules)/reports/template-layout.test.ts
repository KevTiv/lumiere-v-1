import assert from "node:assert/strict"
import test from "node:test"
import {
  parseTemplateBlocks,
  serializeTemplateBlocks,
  templatePreviewDocument,
  type TemplateBlock,
} from "./template-layout"

const blocks: TemplateBlock[] = [
  { id: "heading", kind: "heading", text: 'Monthly <review> --> & "quoted"' },
  { id: "body", kind: "paragraph", text: "First line\nSecond line" },
  { id: "table", kind: "table", columns: ["number", "total"] },
]

test("section markup round trips text exactly without saving sample financial values", () => {
  const markup = serializeTemplateBlocks(blocks)
  assert.deepEqual(parseTemplateBlocks(markup), blocks)
  assert.match(markup, /Monthly &lt;review&gt; --&gt; &amp;/)
  assert.match(markup, /First line<br>Second line/)
  assert.equal(markup.includes("INV-EXAMPLE"), false)
  assert.equal(markup.includes("125.00"), false)
  assert.equal(markup.includes("<tbody></tbody>"), true)
})
test("only the preview supplies sample rows and restrictive external-content policy", () => {
  const document = templatePreviewDocument(serializeTemplateBlocks(blocks), "Portrait")
  assert.match(document, /INV-EXAMPLE/)
  assert.match(document, /125.00/)
  assert.match(document, /default-src 'none'/)
  assert.match(document, /form-action 'none'/)
})
test("legacy custom markup is preserved rather than silently converted", () => {
  const source = "<h1>Existing source</h1>"
  assert.equal(parseTemplateBlocks(source), null)
  assert.match(templatePreviewDocument(source, "Portrait"), /<h1>Existing source<\/h1>/)
  assert.deepEqual(parseTemplateBlocks(""), [])
})
test("raw edits below the metadata marker leave structured mode", () => {
  const markup = serializeTemplateBlocks(blocks)
  assert.equal(parseTemplateBlocks(markup.replace("Monthly &lt;review&gt;", "Changed HTML")), null)
  assert.equal(parseTemplateBlocks("<!--lumiere-layout-v1:[]-->different"), null)
})
test("invalid duplicate sections and unsupported columns do not get interpreted", () => {
  assert.equal(
    parseTemplateBlocks(
      '<!--lumiere-layout-v1:[{"id":"x","kind":"heading","text":"a"},{"id":"x","kind":"heading","text":"b"}]-->',
    ),
    null,
  )
  assert.equal(
    parseTemplateBlocks(
      '<!--lumiere-layout-v1:[{"id":"x","kind":"table","columns":["secret"]}]-->',
    ),
    null,
  )
  assert.equal(parseTemplateBlocks("<!--lumiere-layout-v1:broken-->"), null)
})

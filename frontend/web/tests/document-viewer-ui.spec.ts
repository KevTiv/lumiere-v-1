import { createHash } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import type { OfficeDocumentPreview } from "../lib/document-viewer"

test.describe.configure({ timeout: 60_000 })

function managedFile(
  id: string,
  fileName: string,
  mimetype: string,
  body: Buffer | string,
) {
  const bytes = typeof body === "string" ? Buffer.from(body) : body
  return {
    id,
    fileName,
    mimetype,
    bytes,
    fileSize: bytes.length,
    checksum: createHash("sha256").update(bytes).digest("hex"),
    url: `/api/documents/blobs/object/7/default/file-${id}`,
  }
}

const current = managedFile(
  "1",
  "records.csv",
  "text/csv",
  'Name,Amount,Notes\nCoffee,1200,"Mwaramutse, bonjour"\nTea,300,"First\nsecond"\n',
)
const older = managedFile(
  "10",
  "older.csv",
  "text/csv",
  "Name,Amount\nBeans,400\n",
)

function supplierPdf(): string {
  const content = "BT /F1 18 Tf 40 100 Td (Supplier statement) Tj ET"
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 160] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]
  let body = "%PDF-1.4\n"
  const offsets = objects.map((object, index) => {
    const offset = body.length
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
    return offset
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")
  return `${body}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
}

const pdf = managedFile("2", "supplier.pdf", "application/pdf", supplierPdf())
const image = managedFile(
  "3",
  "field.png",
  "image/png",
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=",
    "base64",
  ),
)
const notes = managedFile(
  "4",
  "notes.md",
  "text/markdown",
  "Field notes\n<script>window.fileExecuted = true</script>\n[External link](https://example.com)",
)
const workbook = managedFile(
  "7",
  "supplier.xlsx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "XLSX fixture",
)
const word = managedFile(
  "8",
  "supplier.docx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "DOCX fixture",
)
const previews = new Map<string, OfficeDocumentPreview>([
  [
    workbook.url,
    {
      kind: "xlsx",
      sheets: [
        {
          name: "Supplier ledger",
          columns: 2,
          rows: [["Coffee", "1200"]],
          truncated: false,
        },
        {
          name: "Reconciliation and supporting ledger for the distribution center",
          columns: 4,
          rows: [["Transport", "900", "Confirmed", "October"]],
          truncated: true,
        },
      ],
    },
  ],
  [
    word.url,
    {
      kind: "docx",
      truncated: false,
      blocks: [
        { kind: "paragraph", text: "Supplier statement for October" },
        {
          kind: "table",
          rows: [
            ["Account", "Balance"],
            ["North distribution center", "1200"],
          ],
        },
      ],
    },
  ],
])
const currentFiles = [current, pdf, image, notes, workbook, word]
const documents = currentFiles.map(({ bytes: _bytes, ...source }) => ({
  ...source,
  organizationId: 7,
  companyId: 3,
  name: source.fileName,
  isDeleted: false,
  currentVersionId: Number(source.id) + 10,
  versionCount: source.id === "1" ? 2 : 1,
}))
const versions = currentFiles.map(({ bytes: _bytes, ...source }) => ({
  ...source,
  id: String(Number(source.id) + 10),
  organizationId: 7,
  documentId: Number(source.id),
  versionNumber: source.id === "1" ? 2 : 1,
  isCurrent: true,
}))
versions.push({
  ...older,
  id: "10",
  documentId: 1,
  organizationId: 7,
  versionNumber: 1,
  isCurrent: false,
})

async function setup(page: Page) {
  const state = { denied: false, blobReads: [] as string[] }
  await page.route("**/api/query/documents?*", (route) =>
    state.denied
      ? route.fulfill({ status: 403, json: { error: "denied" } })
      : route.fulfill({ json: { data: documents } }),
  )
  await page.route("**/api/query/document-versions?*", (route) =>
    route.fulfill({ json: { data: versions } }),
  )
  await page.route("**/api/documents/blobs/object/**", (route) => {
    const url = new URL(route.request().url())
    state.blobReads.push(url.pathname)
    const source = [...currentFiles, older].find(
      (file) => file.url === url.pathname,
    )
    if (!source || source.checksum !== url.searchParams.get("sha256"))
      return route.fulfill({ status: 404 })
    if (url.searchParams.get("preview") === "true") {
      expect(url.searchParams.get("documentId")).toBe(source.id)
      expect(url.searchParams.get("companyId")).toBe("3")
      return route.fulfill({
        json: {
          sourceSha256: source.checksum,
          sourceSize: source.fileSize,
          preview: previews.get(source.url),
        },
        headers: { "cache-control": "private, no-store" },
      })
    }
    return route.fulfill({
      body: source.bytes,
      contentType: source.mimetype,
      headers: { "cache-control": "private, no-store" },
    })
  })
  await page.goto("/document-viewer", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("document-viewer-disclosure")).toHaveAttribute(
    "data-hydrated",
    "true",
  )
  return state
}

for (const width of [390, 1440]) {
  test(`file cards keep distinct original names at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await setup(page)
    await page.getByTestId("file-browser-layout-grid").click()
    const signed = page.getByTestId("file-browser-file-5")
    const exported = page.getByTestId("file-browser-file-6")
    await expect(
      signed.getByRole("button", { name: "Quarter-end evidence", exact: true }),
    ).toBeVisible()
    await expect(
      exported.getByRole("button", {
        name: "Quarter-end evidence",
        exact: true,
      }),
    ).toBeVisible()
    await expect(signed).toContainText("PDF · 1.5 KB")
    await expect(exported).toContainText("Spreadsheet · 400 B")

    const reveal = signed.getByRole("button", {
      name: /^Show original filename:/,
    })
    const extension = reveal.getByText(".PDF", { exact: true })
    const cardBounds = await signed.boundingBox()
    const extensionBounds = await extension.boundingBox()
    expect(
      cardBounds &&
        extensionBounds &&
        extensionBounds.x + extensionBounds.width <=
          cardBounds.x + cardBounds.width,
    ).toBe(true)
    await reveal.focus()
    await page.keyboard.press("Enter")
    const original = page.getByRole("dialog", { name: "Original filename" })
    await expect(original).toContainText(
      "Supplier reconciliation for the north distribution center ".repeat(4) +
        " signed.PDF",
    )
    await expect(
      page.getByRole("dialog", { name: "File preview" }),
    ).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(reveal).toBeFocused()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1)
  })

  test(`Documents and ERP attachments share versioned CSV preview at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 })
    await setup(page)
    const trigger = page
      .getByRole("region", { name: "Documents entry point" })
      .getByRole("button", { name: "Farm records", exact: true })
    await trigger.focus()
    await page.keyboard.press("Enter")
    const dialog = page.getByRole("dialog", { name: "File preview" })
    await expect(
      dialog.getByRole("cell", { name: "Coffee", exact: true }),
    ).toBeVisible()
    await dialog.getByRole("combobox", { name: "File version" }).click()
    await page.getByRole("option", { name: "Version 1", exact: true }).click()
    await expect(
      dialog.getByRole("cell", { name: "Beans", exact: true }),
    ).toBeVisible()
    await expect(
      dialog.getByRole("cell", { name: "Coffee", exact: true }),
    ).toHaveCount(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1)
    const bounds = await dialog.boundingBox()
    expect(bounds?.x).toBeGreaterThanOrEqual(0)
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(width)
    await page.screenshot({
      path: test.info().outputPath(`document-viewer-${width}.png`),
      fullPage: true,
    })
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
    const attachment = page
      .getByRole("region", { name: "ERP attachment entry point" })
      .getByRole("button", { name: "Farm records", exact: true })
    await attachment.click()
    await expect(
      dialog.getByRole("cell", { name: "Coffee", exact: true }),
    ).toBeVisible()
  })

  test(`inspected Office previews fit the shared viewer at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 })
    await setup(page)
    const documents = page.getByRole("region", {
      name: "Documents entry point",
    })
    await documents
      .getByRole("button", { name: "Supplier workbook", exact: true })
      .click()
    const dialog = page.getByRole("dialog", { name: "File preview" })
    await expect(
      dialog.getByRole("cell", { name: "Coffee", exact: true }),
    ).toBeVisible()
    await dialog.getByRole("combobox", { name: "Worksheet" }).press("Enter")
    await page
      .getByRole("option", { name: /^Reconciliation and supporting ledger/ })
      .click()
    await expect(
      dialog.getByRole("cell", { name: "Transport", exact: true }),
    ).toBeVisible()
    await expect(dialog.getByText(/worksheet preview is limited/)).toBeVisible()
    await page.screenshot({
      path: test.info().outputPath(`workbook-${width}.png`),
    })
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)

    const attachments = page.getByRole("region", {
      name: "ERP attachment entry point",
    })
    await attachments
      .getByRole("button", { name: "Supplier letter", exact: true })
      .click()
    await expect(
      dialog.getByText("Supplier statement for October"),
    ).toBeVisible()
    await expect(
      dialog.getByRole("cell", { name: "North distribution center" }),
    ).toBeVisible()
    const bounds = await dialog.boundingBox()
    expect(bounds?.x).toBeGreaterThanOrEqual(0)
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(width)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1)
    await page.screenshot({ path: test.info().outputPath(`word-${width}.png`) })
  })
}

test("all initial formats open and a revoked download drops the preview", async ({
  page,
}) => {
  const state = await setup(page)
  const attachments = page.getByRole("region", {
    name: "ERP attachment entry point",
  })
  await attachments
    .getByRole("button", { name: "Field photo", exact: true })
    .click()
  const dialog = page.getByRole("dialog", { name: "File preview" })
  const img = dialog.getByRole("img", { name: "field.png" })
  await expect(img).toBeVisible()
  expect(
    await img.evaluate((element: HTMLImageElement) => element.naturalWidth),
  ).toBe(1)
  await page.keyboard.press("Escape")
  await attachments
    .getByRole("button", { name: "Supplier PDF", exact: true })
    .click()
  await expect(page.getByTestId("document-viewer-pdf")).toHaveAttribute(
    "type",
    "application/pdf",
  )
  await expect(page.getByTestId("document-viewer-pdf")).toHaveAttribute(
    "data",
    /^blob:/,
  )
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await attachments
    .getByRole("button", { name: "Visit notes", exact: true })
    .click()
  await expect(dialog.locator("pre")).toContainText(
    "<script>window.fileExecuted = true</script>",
  )
  await expect(dialog.getByRole("link")).toHaveCount(0)
  expect(await page.evaluate(() => Object.hasOwn(window, "fileExecuted"))).toBe(
    false,
  )
  const previousReads = state.blobReads.length
  state.denied = true
  await dialog
    .getByRole("button", { name: "Download file", exact: true })
    .click()
  await expect(dialog.getByRole("alert")).toContainText(
    "You do not have access to this file",
  )
  await expect(dialog.locator("pre")).toHaveCount(0)
  expect(state.blobReads.length).toBe(previousReads)
})

test("a successful download rechecks metadata and returns the original file bytes", async ({
  page,
}) => {
  const state = await setup(page)
  await page
    .getByRole("region", { name: "ERP attachment entry point" })
    .getByRole("button", { name: "Farm records", exact: true })
    .click()
  const dialog = page.getByRole("dialog", { name: "File preview" })
  await expect(
    dialog.getByRole("cell", { name: "Coffee", exact: true }),
  ).toBeVisible()
  const download = page.waitForEvent("download")
  await dialog
    .getByRole("button", { name: "Download file", exact: true })
    .click()
  const result = await download
  expect(result.suggestedFilename()).toBe("records.csv")
  const stream = await result.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  expect(Buffer.concat(chunks)).toEqual(current.bytes)
  expect(state.blobReads.filter((path) => path === current.url)).toHaveLength(2)
})

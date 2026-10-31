import { expect, test, type Page } from "@playwright/test"
import type { ReviewDetail, ReviewRow } from "../lib/import-review-model"
import { parseCsvText } from "@lumiere/erp-shared/csv-import-safety"

function source(): ReviewRow {
  return { id:"11", source:{ key:"sausage",label:"Synthetic sausage", source:{file:"historic-shop.csv",row:8,sha256:"a".repeat(64)},issue:"Source quantity 8 has an unknown weight unit. Proposed price requires confirmation.",fields:[
    {key:"quantity",label:"Actual weight (kg)",kind:"decimal",sourceValue:"8",required:true},
    {key:"unit_price",label:"Price per kg (RWF)",kind:"decimal",sourceValue:"600",required:true},
    {key:"amount",label:"Total (RWF)",kind:"decimal",sourceValue:"4800",required:true},
    {key:"sale_price",label:"Sale price (RWF/kg)",kind:"decimal",sourceValue:"4800",required:true},
    {key:"cost_price",label:"Synthetic cost (RWF/kg)",kind:"decimal",sourceValue:"3000",required:true},
    {key:"stored_unit",label:"Stored unit",kind:"choice",sourceValue:null,required:true,options:["kg","unit"],export:false},
    {key:"category_id",label:"Category reference",kind:"text",sourceValue:null,required:true},
    {key:"uom_id",label:"Unit reference",kind:"text",sourceValue:null,required:true},
    {key:"uom_po_id",label:"Purchase unit reference",kind:"text",sourceValue:null,required:true},
    {key:"metadata",label:"Import evidence",kind:"text",sourceValue:null,required:false},
  ],proposed:{quantity:null,unit_price:"4800",amount:"4800",sale_price:"4800",cost_price:"3000",stored_unit:"kg",category_id:"12",uom_id:"13",uom_po_id:"13",metadata:"{}"}},values:{quantity:null,unit_price:"4800",amount:"4800",sale_price:"4800",cost_price:"3000",stored_unit:"kg",category_id:"12",uom_id:"13",uom_po_id:"13",metadata:"{}"},state:"needs_review",revision:1,reason:null,reviewedAt:null,reviewedBy:null }
}

async function mockProductReferences(page: Page) {
  await page.route("**/api/query/**", route => {
    const path = new URL(route.request().url()).pathname
    const data = path.endsWith("product-categories") ? [{id:12,organizationId:8001,name:"Historic products"}] : path.endsWith("uoms") ? [{id:13,organizationId:8001,name:"Kilogram",symbol:"kg",categoryId:1},{id:14,organizationId:8001,name:"Unit",symbol:"unit",categoryId:2},{id:15,organizationId:8002,name:"Foreign unit",symbol:"kg",categoryId:1}] : path.endsWith("companies") ? [{ id: 9001, organizationId: 8001, name: "Fixture company", currencyId: 9102 }] : []
    return route.fulfill({json:{data}})
  })
}

test("a missing weight stays uncertain, then explicit correction is saved and survives reload", async ({ page }, testInfo) => {
  // This first route compiles a large shared form fixture, then proves a full reload.
  test.setTimeout(90_000)
  let item=source()
  let writes=0
  const detail=():ReviewDetail=>({id:"1",title:"Historic source review",targetEntity:"product",sourceFile:"historic-shop.csv",items:[item,{...source(),id:"12",source:{...source().source,key:"other-product",label:"Other unresolved product"}}],history:item.revision>1?[{itemId:item.id,revision:item.revision,values:item.values,state:item.state,reason:item.reason!,actor:"ab".repeat(32),createdAt:"2026-10-30T12:00:00Z"}]:[]})
  await mockProductReferences(page)
  await page.route("**/api/import-reviews**", async route=>{
    if(route.request().method()==="PATCH") {
      writes++
      const body=route.request().postDataJSON()
      if(!body.values.quantity) return route.fulfill({status:400,json:{error:"Actual weight (kg) is required before confirmation"}})
      if(body.expectedRevision!==item.revision) return route.fulfill({status:409,json:{error:"This item changed. Reload the saved review before applying your correction."}})
      item={...item,values:body.values,state:body.state,reason:body.reason,revision:item.revision+1,reviewedBy:"ab".repeat(32),reviewedAt:"2026-10-30T12:00:00Z"}
      return route.fulfill({json:{item,replayed:false}})
    }
    return route.fulfill({json:new URL(route.request().url()).pathname.endsWith("/1")?detail():{data:[{id:"1",title:"Historic source review",pending:item.state==="confirmed"?1:2,total:2,confirmed:item.state==="confirmed"?1:0,excluded:0,targetEntity:"product",sourceFile:"historic-shop.csv"}]}})
  })
  await page.goto("/import-review")
  await page.getByLabel("Find an item or source file",{exact:true}).fill("Synthetic sausage")
  await expect(page.getByRole("row").filter({hasText:"Other unresolved product"})).not.toBeVisible()
  await page.getByLabel("Find an item or source file",{exact:true}).fill("")
  await page.getByRole("row").filter({hasText:"Synthetic sausage"}).getByRole("button",{name:"Review and correct"}).click()
  const dialog=page.getByRole("dialog")
  await expect(dialog.getByText("Source value: 8",{exact:true})).toBeVisible()
  await expect(dialog.getByRole("combobox",{name:"Product category",exact:true})).toContainText("Historic products")
  await expect(dialog.getByRole("combobox",{name:"Product catalog unit",exact:true})).toContainText("Kilogram (kg)")
  await expect(dialog.getByLabel("Import evidence",{exact:true})).not.toBeVisible()
  await dialog.getByRole("combobox",{name:"Status"}).click()
  await page.getByRole("option",{name:"Confirm corrected values"}).click()
  await dialog.getByLabel("Reason or supporting evidence").fill("Confirmed actual total weight from the source owner")
  await dialog.getByRole("button",{name:"Save review"}).click()
  await expect(dialog.getByText("Actual weight (kg) is required before confirmation")).toBeVisible()
  await dialog.getByLabel("Actual weight (kg)",{exact:true}).fill("1")
  await expect(dialog.getByText("Proposed quantity × unit price: 4800")).toBeVisible()
  await dialog.getByRole("combobox",{name:"Unit for corrected prices",exact:true}).click()
  await page.getByRole("option",{name:"unit",exact:true}).click()
  await dialog.getByRole("button",{name:"Save review"}).click()
  await expect(dialog.getByText("The unit for corrected prices must match the chosen product unit. Check the quantities and prices for that unit.")).toBeVisible()
  expect(writes).toBe(1)
  await dialog.getByRole("combobox",{name:"Unit for corrected prices",exact:true}).click()
  await page.getByRole("option",{name:"kg",exact:true}).click()
  await dialog.getByRole("button",{name:"Save review"}).click()
  await expect(dialog).not.toBeVisible()
  await page.reload()
  await page.getByRole("button",{name:"Confirmed",exact:true}).click()
  await page.getByRole("row").filter({hasText:"Synthetic sausage"}).getByRole("button",{name:"Review and correct"}).click()
  await expect(page.getByRole("dialog").getByLabel("Actual weight (kg)",{exact:true})).toHaveValue("1")
  await expect(page.getByRole("dialog").getByText("Source value: 8",{exact:true})).toBeVisible()
  await page.screenshot({path:testInfo.outputPath("saved-correction-source-retained.png"),fullPage:true})
  await page.getByRole("dialog").getByRole("button",{name:"Cancel",exact:true}).click()
  await page.getByRole("button",{name:"Continue import (1 confirmed)"}).click()
  await expect(page.getByTestId("reviewed-csv")).toContainText("1,4800,4800")
  await expect(page.getByTestId("reviewed-csv")).not.toContainText("Other unresolved product")
  expect(writes).toBe(2)
  expect(item.source.fields[0].sourceValue).toBe("8")
  expect(item.values.category_id).toBe("12")
  expect(item.values.uom_id).toBe("13")
  expect(item.values.uom_po_id).toBe("13")
  expect(item.values.metadata).toBe("{}")
})

test("a stale revision retains the user's entries and does not show false success", async ({ page })=>{
  const item=source()
  item.source.fields.find(field => field.key === "stored_unit")!.sourceValue = "kg"
  let writes=0
  await mockProductReferences(page)
  await page.route("**/api/import-reviews**",route=>{
    if(route.request().method()==="PATCH") { writes++; return route.fulfill({status:409,json:{error:"This item changed. Reload the saved review before applying your correction."}}) }
    const detail={id:"1",title:"Historic source review",targetEntity:"product",sourceFile:"historic-shop.csv",items:[item],history:[]}
    return route.fulfill({json:new URL(route.request().url()).pathname.endsWith("/1")?detail:{data:[]}})
  })
  await page.goto("/import-review")
  await page.getByRole("button",{name:"Review and correct"}).click()
  const dialog=page.getByRole("dialog")
  await dialog.getByLabel("Actual weight (kg)",{exact:true}).fill("1")
  await dialog.getByRole("combobox",{name:"Product catalog unit",exact:true}).click()
  await expect(page.getByRole("option",{name:"Unit (unit)",exact:true})).not.toBeVisible()
  await expect(page.getByRole("option",{name:"Foreign unit (kg)",exact:true})).not.toBeVisible()
  await page.getByRole("option",{name:"Kilogram (kg)",exact:true}).click()
  await dialog.getByRole("button",{name:"Save review"}).click()
  await expect(dialog.getByText("This item changed. Reload the saved review before applying your correction.")).toBeVisible()
  await expect(dialog.getByLabel("Actual weight (kg)",{exact:true})).toHaveValue("1")
  expect(writes).toBe(1)
})

async function importHandoffFixture(page: Page, options: { deferAnalysis?: boolean } = {}) {
  const item: ReviewRow = { ...source(), values: { ...source().values, quantity: "1" }, state: "confirmed", revision: 2, reason: "Confirmed source values" }
  const detail: ReviewDetail = { id: "1", title: "Confirmed source", targetEntity: "product", sourceFile: "historic-shop.csv", items: [item], history: [] }
  const analyses: Array<{ targetEntity: string; headers: string[]; csvText: string }> = []
  const imports: Array<{ requestId: string; csvData: string; fileName: string; params: { companyId: string; currencyId: string } }> = []
  const lookups: string[] = []
  let releaseAnalysis = () => {}
  let releaseImport = () => {}
  const analysisGate = new Promise<void>(resolve => { releaseAnalysis = resolve })
  const importGate = new Promise<void>(resolve => { releaseImport = resolve })
  if (!options.deferAnalysis) releaseAnalysis()
  const safety = { findings: [], blocked_cell_count: 0, is_safe_for_ai: true }
  await mockProductReferences(page)
  await page.route("**/api/import-reviews**", route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/1") ? detail : { data: [{ id: "1", title: detail.title, pending: 0, total: 1, confirmed: 1, excluded: 0, targetEntity: "product", sourceFile: detail.sourceFile }] } }))
  await page.route("**/api/ai/import/analyze", async route => {
    const body = route.request().postDataJSON() as typeof analyses[number]
    analyses.push(body)
    await analysisGate
    const target = (header: string) => header === "price" ? "sale_price" : header === "cost" ? "cost_price" : header
    await route.fulfill({ json: { target_entity: body.targetEntity,
      mappings: body.headers.filter(header => !header.startsWith("_")).map(header => ({ source_column: header, target_field: target(header), confidence: 1, required: ["name", "sale_price", "cost_price"].includes(target(header)) })),
      unmapped_source_columns: body.headers.filter(header => header.startsWith("_")), unmapped_target_fields: [], metadata_suggestions: [],
      structure: { column_count: body.headers.length, sample_row_count: 1, duplicate_headers: [], empty_columns: [], delimiter_hint: "," }, safety, warnings: [],
    } })
  })
  await page.route("**/api/ai/import/preview", route => {
    const body = route.request().postDataJSON() as { targetEntity: string; headers: string[]; rows: string[][]; mapping: Record<string, string> }
    return route.fulfill({ json: { target_entity: body.targetEntity, rows: body.rows.map(row => Object.fromEntries(body.headers.flatMap((header, index) => body.mapping[header] && body.mapping[header] !== "__skip__" ? [[body.mapping[header], row[index]]] : []))), validation_errors: [], safety, warnings: [] } })
  })
  await page.route("**/api/import/product**", async route => {
    if (route.request().method() === "POST") {
      imports.push(route.request().postDataJSON())
      await importGate
      return route.abort("connectionreset")
    }
    lookups.push(new URL(route.request().url()).pathname)
    return route.fulfill({ status: 404, json: { error: "This submission is not visible yet. Retry the same import request to recover its result." } })
  })
  await page.goto("/import-review")
  await page.getByRole("button", { name: "Open import handoff fixture" }).click()
  await page.getByRole("button", { name: "Confirmed source (0 to review)", exact: true }).click()
  const continuation = page.getByRole("button", { name: "Continue import (1 confirmed)", exact: true })
  await expect(continuation).toBeEnabled()
  const wizard = page.getByTestId("guided-import-wizard")
  await wizard.getByTestId("guided-import-entity").click()
  await page.getByRole("option", { name: "Products", exact: true }).click()
  const file = wizard.getByTestId("guided-import-file")
  await file.setInputFiles({ name: "draft-products.csv", mimeType: "text/csv", buffer: Buffer.from("name,price,cost\nDraft product,12.50,8.25") })
  await expect(wizard.getByTestId("guided-import-source-summary")).toContainText("draft-products.csv")
  return { wizard, file, continuation, analyses, imports, lookups, releaseAnalysis, releaseImport }
}

test("review handoff keeps the selected file and edited mapping on cancel, and replaces only a confirmed idle draft", async ({ page }) => {
  const fixture = await importHandoffFixture(page)
  const { wizard, file, continuation } = fixture
  try {
    await wizard.getByRole("button", { name: "Analyze with AI", exact: true }).click()
    const mapping = wizard.getByTestId("guided-import-mapping")
    await expect(mapping).toBeVisible()
    const price = mapping.getByRole("cell", { name: "price", exact: true }).locator("..").getByRole("combobox")
    await price.click()
    await page.getByRole("option", { name: "metadata", exact: true }).click()
    await continuation.click()
    const confirmation = page.getByTestId("confirm-dialog")
    await expect(confirmation).toContainText("Your current file, mapping and preview will be replaced")
    await page.getByTestId("confirm-dialog-cancel").click()
    await expect(confirmation).toBeHidden()
    expect(await file.evaluate(input => (input as HTMLInputElement).files?.[0]?.name)).toBe("draft-products.csv")
    await expect(price).toContainText("metadata")
    await expect(wizard.getByTestId("guided-import-source-summary")).toContainText("draft-products.csv")
    expect(fixture.analyses).toHaveLength(1)
    expect(fixture.imports).toEqual([])

    await continuation.click()
    await page.getByTestId("confirm-dialog-confirm").click()
    await expect(wizard.getByTestId("guided-import-source-summary")).toContainText("reviewed-1.csv")
    expect(await file.evaluate(input => (input as HTMLInputElement).files?.length)).toBe(0)
    await expect(mapping).toBeHidden()
    await wizard.getByRole("button", { name: "Analyze with AI", exact: true }).click()
    await expect(mapping).toBeVisible()
    expect(fixture.analyses).toHaveLength(2)
    expect(fixture.analyses[1]!.csvText).toContain("4800")
    expect(fixture.analyses[1]!.csvText).not.toContain("Draft product")
    expect(fixture.analyses[1]!.headers).toEqual(expect.arrayContaining(["sale_price", "cost_price", "_review_item_id"]))
    expect(fixture.imports).toEqual([])
  } finally {
    fixture.releaseAnalysis(); fixture.releaseImport()
    await page.unrouteAll({ behavior: "wait" })
  }
})

test("review handoff cannot replace a busy or unknown import and explicit recovery keeps the same request identity", async ({ page }) => {
  const fixture = await importHandoffFixture(page, { deferAnalysis: true })
  const { wizard, file, continuation } = fixture
  try {
    await wizard.getByRole("button", { name: "Analyze with AI", exact: true }).click()
    await expect.poll(() => fixture.analyses.length).toBe(1)
    await expect(continuation).toBeDisabled()
    await expect(page.getByTestId("import-review-handoff-status")).toContainText("Please wait")
    fixture.releaseAnalysis()
    await expect(wizard.getByTestId("guided-import-mapping")).toBeVisible()
    await expect(continuation).toBeEnabled()
    await wizard.getByRole("button", { name: "Preview import", exact: true }).click()
    await expect(wizard.getByTestId("guided-import-preview")).toBeVisible()
    await wizard.getByRole("button", { name: "Import", exact: true }).click()
    await expect.poll(() => fixture.imports.length).toBe(1)
    const submitted = fixture.imports[0]!
    expect(submitted.requestId).toMatch(/^[a-f0-9]{32}$/)
    expect(submitted.params).toEqual({ companyId: "9001", currencyId: "9102" })
    const submittedCsv = parseCsvText(submitted.csvData)
    expect(submittedCsv.rows).toHaveLength(1)
    expect(Object.fromEntries(submittedCsv.headers.map((header, index) => [header, submittedCsv.rows[0]![index]]))).toEqual({ name: "Draft product", sale_price: "12.50", cost_price: "8.25" })
    await expect(continuation).toBeDisabled()
    await expect(page.getByTestId("import-review-handoff-status")).toContainText("Please wait")
    await expect(page.getByTestId("confirm-dialog")).toBeHidden()
    expect(await file.evaluate(input => (input as HTMLInputElement).files?.[0]?.name)).toBe("draft-products.csv")

    fixture.releaseImport()
    const check = wizard.getByRole("button", { name: "Check import result", exact: true })
    await expect(check).toBeEnabled()
    await expect(continuation).toBeDisabled()
    await expect(page.getByTestId("import-review-handoff-status")).toContainText("Check the current import result")
    await check.click()
    await expect.poll(() => fixture.lookups.length).toBe(1)
    expect(fixture.lookups[0]).toBe(`/api/import/product/requests/${submitted.requestId}`)
    await expect(check).toBeEnabled()
    await expect(continuation).toBeDisabled()
    await wizard.getByRole("button", { name: "Retry same submission", exact: true }).click()
    await expect.poll(() => fixture.imports.length).toBe(2)
    expect(fixture.imports[1]).toEqual(submitted)
    await expect(check).toBeEnabled()
    await expect(continuation).toBeDisabled()
    await expect(wizard.getByTestId("guided-import-source-summary")).toContainText("draft-products.csv")
    await expect(page.getByTestId("confirm-dialog")).toBeHidden()
  } finally {
    fixture.releaseAnalysis(); fixture.releaseImport()
    await page.unrouteAll({ behavior: "wait" })
  }
})

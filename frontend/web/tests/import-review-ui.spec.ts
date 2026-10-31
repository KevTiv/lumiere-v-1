import { expect, test, type Page } from "@playwright/test"
import type { ReviewDetail, ReviewRow } from "../lib/import-review-model"

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
    const data = path.endsWith("product-categories") ? [{id:12,organizationId:8001,name:"Historic products"}] : path.endsWith("uoms") ? [{id:13,organizationId:8001,name:"Kilogram",symbol:"kg",categoryId:1},{id:14,organizationId:8001,name:"Unit",symbol:"unit",categoryId:2},{id:15,organizationId:8002,name:"Foreign unit",symbol:"kg",categoryId:1}] : []
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

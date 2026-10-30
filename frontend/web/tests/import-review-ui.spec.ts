import { expect, test } from "@playwright/test"
import type { ReviewDetail, ReviewRow } from "../lib/import-review-model"

function source(): ReviewRow {
  return { id:"11", source:{ key:"sausage",label:"Synthetic sausage", source:{file:"historic-shop.csv",row:8,sha256:"a".repeat(64)},issue:"Source quantity 8 has an unknown weight unit. Proposed price requires confirmation.",fields:[
    {key:"quantity",label:"Actual weight (kg)",kind:"decimal",sourceValue:"8",required:true},
    {key:"unit_price",label:"Price per kg (RWF)",kind:"decimal",sourceValue:"600",required:true},
    {key:"amount",label:"Total (RWF)",kind:"decimal",sourceValue:"4800",required:true},
    {key:"sale_price",label:"Sale price (RWF/kg)",kind:"decimal",sourceValue:"4800",required:true},
    {key:"cost_price",label:"Synthetic cost (RWF/kg)",kind:"decimal",sourceValue:"3000",required:true},
  ],proposed:{quantity:null,unit_price:"4800",amount:"4800",sale_price:"4800",cost_price:"3000"}},values:{quantity:null,unit_price:"4800",amount:"4800",sale_price:"4800",cost_price:"3000"},state:"needs_review",revision:1,reason:null,reviewedAt:null,reviewedBy:null }
}

test("a missing weight stays uncertain, then explicit correction is saved and survives reload", async ({ page }) => {
  let item=source()
  let writes=0
  const detail=():ReviewDetail=>({id:"1",title:"Historic source review",targetEntity:"product",sourceFile:"historic-shop.csv",items:[item,{...source(),id:"12",source:{...source().source,key:"other-product",label:"Other unresolved product"}}],history:item.revision>1?[{itemId:item.id,revision:item.revision,values:item.values,state:item.state,reason:item.reason!,actor:"ab".repeat(32),createdAt:"2026-10-30T12:00:00Z"}]:[]})
  await page.route("**/api/query/**", route=>route.fulfill({json:{data:[]}}))
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
  await page.getByRole("row").filter({hasText:"Synthetic sausage"}).getByRole("button",{name:"Review and correct"}).click()
  const dialog=page.getByRole("dialog")
  await expect(dialog.getByText("Source value: 8",{exact:true})).toBeVisible()
  await dialog.getByRole("combobox",{name:"Status"}).click()
  await page.getByRole("option",{name:"Confirm corrected values"}).click()
  await dialog.getByLabel("Reason or supporting evidence").fill("Confirmed actual total weight from the source owner")
  await dialog.getByRole("button",{name:"Save review"}).click()
  await expect(dialog.getByText("Actual weight (kg) is required before confirmation")).toBeVisible()
  await dialog.getByLabel("Actual weight (kg)",{exact:true}).fill("1")
  await expect(dialog.getByText("Proposed quantity × unit price: 4800")).toBeVisible()
  await dialog.getByRole("button",{name:"Save review"}).click()
  await expect(dialog).not.toBeVisible()
  await page.reload()
  await page.getByRole("button",{name:"Confirmed",exact:true}).click()
  await page.getByRole("row").filter({hasText:"Synthetic sausage"}).getByRole("button",{name:"Review and correct"}).click()
  await expect(page.getByRole("dialog").getByLabel("Actual weight (kg)",{exact:true})).toHaveValue("1")
  await expect(page.getByRole("dialog").getByText("Source value: 8",{exact:true})).toBeVisible()
  await page.getByRole("dialog").getByRole("button",{name:"Cancel",exact:true}).click()
  await page.getByRole("button",{name:"Continue import (1 confirmed)"}).click()
  await expect(page.getByTestId("reviewed-csv")).toContainText("1,4800,4800")
  await expect(page.getByTestId("reviewed-csv")).not.toContainText("Other unresolved product")
  expect(writes).toBe(2)
  expect(item.source.fields[0].sourceValue).toBe("8")
})

test("a stale revision retains the user's entries and does not show false success", async ({ page })=>{
  const item=source()
  let writes=0
  await page.route("**/api/query/**",route=>route.fulfill({json:{data:[]}}))
  await page.route("**/api/import-reviews**",route=>{
    if(route.request().method()==="PATCH") { writes++; return route.fulfill({status:409,json:{error:"This item changed. Reload the saved review before applying your correction."}}) }
    const detail={id:"1",title:"Historic source review",targetEntity:"product",sourceFile:"historic-shop.csv",items:[item],history:[]}
    return route.fulfill({json:new URL(route.request().url()).pathname.endsWith("/1")?detail:{data:[]}})
  })
  await page.goto("/import-review")
  await page.getByRole("button",{name:"Review and correct"}).click()
  const dialog=page.getByRole("dialog")
  await dialog.getByLabel("Actual weight (kg)",{exact:true}).fill("1")
  await dialog.getByRole("button",{name:"Save review"}).click()
  await expect(dialog.getByText("This item changed. Reload the saved review before applying your correction.")).toBeVisible()
  await expect(dialog.getByLabel("Actual weight (kg)",{exact:true})).toHaveValue("1")
  expect(writes).toBe(1)
})

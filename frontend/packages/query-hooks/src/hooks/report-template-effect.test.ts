import assert from "node:assert/strict"
import test from "node:test"
import {
  currentReportTemplate,
  reportTemplateEditValues,
  reportTemplateValuesEqual,
  resolveReportTemplateUpdate,
} from "./report-template-effect"
const row = {
  id: "3",
  organizationId: "1",
  companyId: "2",
  orientation: "Landscape",
  paperFormat: "Letter",
  templateContent: "<h1>Original</h1>",
}
const desired = {
  orientation: "Landscape",
  paperFormat: "Letter",
  templateContent: "<h1>Original</h1>",
}

test("update effect requires exact identity, scope and all requested fields", () => {
  assert.equal(resolveReportTemplateUpdate([row], 1n, 2n, 3n, desired)?.id, "3")
  assert.equal(resolveReportTemplateUpdate([row], 1n, 2n, 4n, desired), null)
  assert.equal(resolveReportTemplateUpdate([row], 9n, 2n, 3n, desired), null)
  assert.equal(
    resolveReportTemplateUpdate([row], 1n, 2n, 3n, {
      ...desired,
      templateContent: "changed",
    }),
    null,
  )
  assert.equal(
    resolveReportTemplateUpdate([row], 1n, 2n, 3n, {
      ...desired,
      paperFormat: "A4",
    }),
    null,
  )
  assert.throws(
    () => resolveReportTemplateUpdate([{ ...row, companyId: "8" }], 1n, 2n, 3n, desired),
    /outside/,
  )
})
test("zero rows is unresolved, duplicates fail and missing fields are not empty templates", () => {
  assert.equal(currentReportTemplate([], 1n, 2n, 3n), null)
  assert.throws(() => currentReportTemplate([row, row], 1n, 2n, 3n))
  assert.throws(() => reportTemplateEditValues({ orientation: "Portrait" }), /unavailable/)
  assert.throws(
    () => currentReportTemplate([{ id: "3", organizationId: "1" }], 1n, 2n, 3n),
    /scope/,
  )
})
test("unscoped templates and explicit cleared content retain exact semantics", () => {
  const global = {
    ...row,
    companyId: null,
    paperFormat: null,
    templateContent: null,
  }
  assert.equal(currentReportTemplate([global], 1n, 2n, 3n), global)
  assert.deepEqual(reportTemplateEditValues(global), {
    orientation: "Landscape",
    paperFormat: undefined,
    templateContent: undefined,
  })
  assert.equal(
    reportTemplateValuesEqual(desired, {
      ...desired,
      templateContent: desired.templateContent + " ",
    }),
    false,
  )
})

test("template update encoding preserves explicit Option strings and clears", async () => {
  const { stdbParamsToJson } = await import("@lumiere/erp-shared/stdb-params-json")
  assert.deepEqual(stdbParamsToJson(desired, "UpdateReportTemplateParams"), {
    orientation: "Landscape",
    paper_format: { some: "Letter" },
    template_content: { some: "<h1>Original</h1>" },
  })
  assert.deepEqual(
    stdbParamsToJson(
      {
        orientation: "Portrait",
        paperFormat: undefined,
        templateContent: undefined,
      },
      "UpdateReportTemplateParams",
    ),
    {
      orientation: "Portrait",
      paper_format: { none: [] },
      template_content: { none: [] },
    },
  )
})

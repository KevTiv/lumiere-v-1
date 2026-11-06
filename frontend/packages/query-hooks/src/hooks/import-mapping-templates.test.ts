import assert from "node:assert/strict"
import { test } from "node:test"
import {
  importMappingTemplateMatchesHeaders,
  mappingJsonForTemplate,
  parseImportMappingTemplateJson,
} from "./import-mapping-templates"

test("saved templates detect changes even in unmapped columns", () => {
  const mapping = { Name: "name", Email: "email" }
  const original = ["Name", "Email", "Notes"]
  const row = { mappingJson: mappingJsonForTemplate(mapping, original) }
  assert.deepEqual(parseImportMappingTemplateJson(row), mapping)
  assert.equal(importMappingTemplateMatchesHeaders(row, original), true)
  assert.equal(importMappingTemplateMatchesHeaders(row, ["Name", "Email", "Country"]), false)
  assert.equal(importMappingTemplateMatchesHeaders(row, ["Email", "Name", "Notes"]), false)
})

test("legacy templates still work when all saved columns are present", () => {
  const row = { mapping_json: '{"Name":"name","Email":"email"}' }
  assert.equal(importMappingTemplateMatchesHeaders(row, ["Name", "Email", "Country"]), true)
  assert.equal(importMappingTemplateMatchesHeaders(row, ["Name", "Country"]), false)
  assert.equal(importMappingTemplateMatchesHeaders(row, ["Name", "Email", "Email"]), false)
})

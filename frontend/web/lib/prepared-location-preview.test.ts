import assert from "node:assert/strict"
import test from "node:test"
import { previewPreparedLocations } from "./prepared-location-preview"

const header = "name,usage,active,is_scrap"

test("prepared location references preserve explicit inactive state and source fields", () => {
  const result = previewPreparedLocations(`${header},metadata,_source_file,_source_row\nLocation,internal,false,false,{},original.csv,3`)
  assert.deepEqual(result.preview.validation_errors, [])
  assert.equal(result.preview.target_entity, "stock_location")
  assert.equal(result.preview.rows[0].active, "false")
  assert.equal(result.preview.rows[0]._source_file, "original.csv")
  assert.equal(result.mapping.metadata, "metadata")
})

test("locations require explicit usage and booleans instead of native defaults", () => {
  const result = previewPreparedLocations(`${header}\nLocation,unknown,,false\nLocation,internal,true,0`)
  assert.deepEqual(new Set(result.preview.validation_errors.map(error => `${error.row_index}:${error.field}`)), new Set(["0:usage", "0:active", "1:is_scrap"]))
})

test("unsupported parent links, unknown headers and duplicate headers fail closed", () => {
  for (const csv of [`${header},parent_id\nLocation,internal,false,false,7`, `${header},name\nLocation,internal,false,false,Other`, "name\nLocation"]) assert.throws(() => previewPreparedLocations(csv))
})

test("location metadata and row width are validated", () => {
  const result = previewPreparedLocations(`${header},metadata\nLocation,internal,false,false,[]\nLocation,internal,false,false,{},extra`)
  assert.deepEqual(result.preview.validation_errors.map(error => error.field), ["metadata", "row"])
})

test("unsafe cells after the first fifty rows fail before any import", () => {
  const csv = `${header}\n` + Array.from({ length: 60 }, (_, i) => `${i === 59 ? "=1+1" : "Location"},internal,false,false`).join("\n")
  assert.throws(() => previewPreparedLocations(csv), /unsafe|safety|blocked/i)
})

import assert from "node:assert/strict"
import test from "node:test"

import { buildCanonicalCsv, escapeCsvField } from "./csv-import-transform"

test("escapeCsvField quotes commas", () => {
  assert.equal(escapeCsvField("hello, world"), '"hello, world"')
})

test("buildCanonicalCsv maps headers and metadata extras", () => {
  const csv = buildCanonicalCsv(
    ["Product Name", "Legacy Code", "Region"],
    [
      ["Widget", "W-1", "EU"],
      ["Gadget", "G-2", "US"],
    ],
    {
      "Product Name": "name",
      "Legacy Code": "default_code",
      Region: "metadata.extra.region",
    },
  )

  const lines = csv.split("\n")
  assert.equal(lines[0], "default_code,metadata,name")
  assert.match(lines[1], /Widget/)
  assert.match(lines[1], /W-1/)
  assert.match(lines[1], /EU/)
})

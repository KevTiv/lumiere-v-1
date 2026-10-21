import assert from "node:assert/strict"
import test from "node:test"

import {
  MARGIN_SUPPLY_SCENARIO_CSV_HEADERS,
  MARGIN_SUPPLY_SCENARIO_CSV_LIMITS,
  marginSupplyScenarioCsvTemplate,
  parseMarginSupplyScenarioCsv,
} from "./margin-supply-scenario-csv"

test("parses controlled scenario CSV with row-level provenance", () => {
  const importedAt = "2026-10-18T12:00:00.000Z"
  const rows = parseMarginSupplyScenarioCsv(
    `${MARGIN_SUPPLY_SCENARIO_CSV_HEADERS.join(",")}\nPort disruption,12.5,-4,21,30\n`,
    "macro-scenarios.csv",
    importedAt,
  )

  assert.deepEqual(rows, [{
    name: "Port disruption",
    draft: {
      inputCostChangePct: "12.5",
      demandChangePct: "-4",
      leadTimeChangeDays: "21",
      targetMarginPct: "30",
    },
    provenance: {
      source: "controlled_csv",
      fileName: "macro-scenarios.csv",
      importedAt,
      rowNumber: 2,
    },
  }])
})

test("template documents the exact required headers", () => {
  assert.equal(marginSupplyScenarioCsvTemplate().split("\n")[0], MARGIN_SUPPLY_SCENARIO_CSV_HEADERS.join(","))
})

test("rejects unknown headers, invalid values, unsafe cells, and excessive rows", () => {
  const header = MARGIN_SUPPLY_SCENARIO_CSV_HEADERS.join(",")
  assert.throws(
    () => parseMarginSupplyScenarioCsv(`${header}\nShock,1,2,3,4\n`, "scenario.txt"),
    /must end in \.csv/,
  )
  assert.throws(
    () => parseMarginSupplyScenarioCsv(`${header},comment\nShock,1,2,3,4,note\n`, "unknown.csv"),
    /Unknown CSV headers.*comment/,
  )
  assert.throws(
    () => parseMarginSupplyScenarioCsv(`${header}\nShock,1,2,3,96\n`, "range.csv"),
    /target_margin_pct must be 0 to 95/,
  )
  assert.throws(
    () => parseMarginSupplyScenarioCsv(`${header}\n=CMD,1,2,3,4\n`, "unsafe.csv"),
    /unsafe formula/,
  )
  assert.throws(
    () => parseMarginSupplyScenarioCsv(`${header}\nShock,+1,2,3,4\n`, "formula-number.csv"),
    /plain decimal notation/,
  )
  assert.throws(
    () => parseMarginSupplyScenarioCsv(`${header}\nShock,1,2,3,4\n\nSecond,1,2,3,4\n`, "blank-line.csv"),
    /Blank lines are not allowed/,
  )
  const tooMany = Array.from({ length: MARGIN_SUPPLY_SCENARIO_CSV_LIMITS.maxRows + 1 }, (_, index) => `Shock ${index},1,2,3,4`).join("\n")
  assert.throws(
    () => parseMarginSupplyScenarioCsv(`${header}\n${tooMany}\n`, "large.csv"),
    /alpha limit/,
  )
})

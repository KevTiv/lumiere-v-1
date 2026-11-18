#!/usr/bin/env node
// AIH-35 dry run. Read-only: lists AI runs recorded as completed whose summary
// is the gate's withheld notice, grouped by organization/company. Prints IDs and
// counts only, never summaries or message bodies. Changes nothing; review the
// output, then pass chosen IDs to the operator-only `correct_withheld_ai_agent_runs`.
//
//   STDB_URL=https://... STDB_DATABASE=... STDB_TOKEN=<owner token> \
//     node scripts/withheld-run-candidates.mjs [--json]
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const RUST_SOURCE = new URL("../crates/policy-core/src/withheld_answer.rs", import.meta.url)
const PAGE = 200

export function withheldNotice() {
  const match = /WITHHELD_ANSWER_NOTICE: &str = "([^"]+)"/.exec(readFileSync(RUST_SOURCE, "utf8"))
  if (!match) throw new Error("withheld notice constant not found")
  return match[1]
}

function optionText(value) {
  // SATS JSON Option<String>: [0, text] is some, [1, []] is none.
  return Array.isArray(value) && value[0] === 0 && typeof value[1] === "string" ? value[1] : null
}

/** Pure: SQL result rows -> candidate list (no summaries retained). */
export function candidates(result, notice) {
  const names = result.schema.elements.map((el) => el.name.some)
  const at = (row, name) => row[names.indexOf(name)]
  return result.rows
    .filter((row) => optionText(at(row, "summary"))?.trimStart().startsWith(notice))
    .map((row) => ({ runId: Number(at(row, "id")), organizationId: Number(at(row, "organization_id")), companyId: Number(at(row, "company_id")) }))
}

export function summarize(list) {
  const groups = new Map()
  for (const item of list) {
    const key = `${item.organizationId}/${item.companyId}`
    groups.set(key, [...(groups.get(key) ?? []), item.runId].sort((a, b) => a - b))
  }
  return { total: list.length, groups: Object.fromEntries(groups) }
}

async function query(sql) {
  const { STDB_URL, STDB_DATABASE, STDB_TOKEN } = process.env
  if (!STDB_URL || !STDB_DATABASE || !STDB_TOKEN) throw new Error("STDB_URL, STDB_DATABASE and STDB_TOKEN are required")
  const response = await fetch(`${STDB_URL}/v1/database/${STDB_DATABASE}/sql`, { method: "POST", headers: { Authorization: `Bearer ${STDB_TOKEN}` }, body: sql })
  if (!response.ok) throw new Error(`SQL failed: ${response.status}`)
  return (await response.json())[0]
}

async function main() {
  const notice = withheldNotice()
  const found = []
  // Bounded id windows: stable, and never loads the whole table in one reply.
  // SpacetimeDB SQL rejects ORDER BY; ids alone are small, so read them to find the bound.
  const ids = (await query("SELECT id FROM ai_agent_run WHERE status = 'completed'")).rows.map((row) => Number(row[0]))
  const max = ids.reduce((a, b) => Math.max(a, b), 0)
  for (let low = 1; low <= max; low += PAGE) {
    const result = await query(`SELECT id, organization_id, company_id, summary FROM ai_agent_run WHERE status = 'completed' AND id >= ${low} AND id < ${low + PAGE}`)
    found.push(...candidates(result, notice))
  }
  const summary = summarize(found)
  if (process.argv.includes("--json")) console.log(JSON.stringify(summary, null, 2))
  else {
    console.log(`candidate runs: ${summary.total}`)
    for (const [scope, ids] of Object.entries(summary.groups)) console.log(`org/company ${scope}: ${ids.length} -> ${ids.join(",")}`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((error) => { console.error(error.message); process.exit(1) })

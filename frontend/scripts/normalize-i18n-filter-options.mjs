#!/usr/bin/env node
/**
 * Merges sibling keys "foo" (string) + "foo.options" (object) into
 * "foo": { "label": <string>, "options": <object> } for i18next dotted paths.
 * Recurses into the whole JSON tree.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const EN = join(__dirname, "../packages/i18n/src/locales/en.json")

function fixDotOptions(obj) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return
  const keys = Object.keys(obj)
  const toDelete = []
  for (const k of keys) {
    if (!k.endsWith(".options")) continue
    const base = k.slice(0, -".options".length)
    if (!base) continue
    const optVal = obj[k]
    const baseVal = obj[base]
    if (typeof baseVal === "string" && optVal !== null && typeof optVal === "object" && !Array.isArray(optVal)) {
      obj[base] = { label: baseVal, options: optVal }
      toDelete.push(k)
    }
  }
  for (const d of toDelete) delete obj[d]
  for (const k of Object.keys(obj)) fixDotOptions(obj[k])
}

const raw = readFileSync(EN, "utf8")
const data = JSON.parse(raw)
fixDotOptions(data)
writeFileSync(EN, `${JSON.stringify(data, null, 2)}\n`, "utf8")
console.log("Updated", EN)

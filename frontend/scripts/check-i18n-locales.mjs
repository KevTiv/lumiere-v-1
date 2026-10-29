#!/usr/bin/env node
/** Validate partial locale packs without counting fallback English as translated. */
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const dir = fileURLToPath(new URL("../packages/i18n/src/locales/", import.meta.url))
function flatten(value, prefix = "", out = {}) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof child === "string") out[path] = child
    else if (child && typeof child === "object" && !Array.isArray(child)) flatten(child, path, out)
    else throw new Error(`Invalid translation at ${path}`)
  }
  return out
}
const read = name => flatten(JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")))
const en = read("en")
const placeholders = text => [...text.matchAll(/{{\s*([^}]+?)\s*}}/g)].map(match => match[1]).sort()
const markup = text => [...text.matchAll(/<\/?[A-Za-z][^>]*>/g)].map(match => match[0]).sort()
// Matches the released finance-alpha workspace profile and its shared UI.
const alphaAreas = new Set([
  "recordChanges", "moduleInsights", "workspaceShell", "common", "navigation", "nav",
  "accounting", "sales", "crm", "purchasing", "reports", "subscriptions", "expenses",
  "overview", "tasks", "workBoard", "approvals", "documents", "calendar", "messages",
  "settings", "workspace", "auth", "notifications", "commandPalette", "recordHeader",
])
const alphaKeys = Object.keys(en).filter(key => alphaAreas.has(key.split(".")[0]))
const errors = []
for (const file of readdirSync(dir).filter(name => name.endsWith(".json") && name !== "en.json")) {
  const name = file.slice(0, -5)
  const pack = read(name)
  for (const [key, value] of Object.entries(pack)) {
    if (!(key in en)) errors.push(`${name}: unknown key ${key}`)
    else if (!value.trim()) errors.push(`${name}: empty value at ${key}`)
    else if (JSON.stringify(placeholders(value)) !== JSON.stringify(placeholders(en[key]))) errors.push(`${name}: interpolation mismatch at ${key}`)
    else if (JSON.stringify(markup(value)) !== JSON.stringify(markup(en[key]))) errors.push(`${name}: markup mismatch at ${key}`)
  }
  if (["fr", "rw", "sw"].includes(name)) {
    // Every string on the language-settings screen must exist in all alpha languages.
    for (const key of Object.keys(en).filter(key => key.startsWith("common.") || key.startsWith("settings.profile.") || key.startsWith("settings.sections.") || key.startsWith("settings.groups.") || key.startsWith("workspaceShell.") || key.startsWith("nav."))) {
      if (!(key in pack)) errors.push(`${name}: missing core language-settings key ${key}`)
    }
    console.log(`${name}: ${alphaKeys.filter(key => key in pack).length}/${alphaKeys.length} alpha keys; ${Object.keys(pack).length} catalog keys supplied`)
  }
}
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1 }
else console.log("Locale keys, interpolation variables, markup, and core settings coverage are valid.")

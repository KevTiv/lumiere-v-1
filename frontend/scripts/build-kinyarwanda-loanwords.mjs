#!/usr/bin/env node
/** Keep complete Kinyarwanda sentences; vary only the curated technical loanwords. */
import { readFileSync, writeFileSync } from "node:fs"

const baseUrl = new URL("../packages/i18n/src/locales/rw.json", import.meta.url)
const outputUrl = new URL("../packages/i18n/src/locales/rw-x-en.json", import.meta.url)
// Shared rw wording uses French-derived terms. English preference overrides these
// specific terms, while untranslated text uses the selected fallback language.
const glossary = new Map([
  ["fagitire", "invoice"],
  ["raporo", "report"],
  ["dosiye", "file"],
  ["imeyili", "email"],
  ["konti", "account"],
  ["komande", "order"],
])
const pattern = new RegExp(`(?<!\\p{L})(${[...glossary.keys()].join("|")})(?!\\p{L})`, "giu")
function overrides(base) {
  const result = {}
  for (const [key, value] of Object.entries(base)) {
    if (typeof value === "string") {
      const translated = value.replace(pattern, word => {
        const term = glossary.get(word.toLowerCase())
        return word[0] === word[0].toUpperCase() ? term[0].toUpperCase() + term.slice(1) : term
      })
      if (translated !== value) result[key] = translated
    } else {
      const child = overrides(value)
      if (Object.keys(child).length) result[key] = child
    }
  }
  return result
}
const text = `${JSON.stringify(overrides(JSON.parse(readFileSync(baseUrl, "utf8"))), null, 2)}\n`
if (process.argv.includes("--check")) {
  if (readFileSync(outputUrl, "utf8") !== text) {
    console.error("Kinyarwanda English loanwords are out of date. Run pnpm i18n:loanwords.")
    process.exitCode = 1
  } else console.log("Kinyarwanda loanword overrides are up to date.")
} else {
  writeFileSync(outputUrl, text)
  console.log("Updated rw-x-en.json from the Kinyarwanda technical glossary.")
}

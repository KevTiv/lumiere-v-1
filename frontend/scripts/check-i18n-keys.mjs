#!/usr/bin/env node
/**
 * Static check: translation keys used in code vs keys defined in en.json.
 *
 * Reports:
 *   - missing: key path does not exist in en.json
 *   - nonLeaf: key resolves to an object (likely typo / forgot .title etc.)
 *   - wrongByArea (JSON) and console sections: split by packages/ui (UI library) vs web vs other
 *
 * Usage:
 *   node scripts/check-i18n-keys.mjs
 *   node scripts/check-i18n-keys.mjs --json
 *   node scripts/check-i18n-keys.mjs --unused   (list leaf keys never referenced as string literals)
 *
 * Duplicate keys in en.json are checked separately: pnpm i18n:check-json (or full pnpm i18n:check).
 *
 * Scans: frontend/web, frontend/packages/ui/src, and other packages' src trees.
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const FRONTEND_ROOT = join(__dirname, "..")
const EN_JSON = join(FRONTEND_ROOT, "packages/i18n/src/locales/en.json")

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".git",
])

/** @param {string} dir */
function walkSourceFiles(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const ent of entries) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) {
      if (SKIP_DIR_NAMES.has(ent.name)) continue
      walkSourceFiles(p, out)
    } else if (ent.isFile() && /\.(tsx|ts)$/.test(ent.name) && !ent.name.endsWith(".d.ts")) {
      out.push(p)
    }
  }
  return out
}

/** @param {unknown} value @param {string} prefix */
function collectLeafKeys(value, prefix = "") {
  /** @type {string[]} */
  const keys = []
  if (typeof value === "string" || typeof value === "number") {
    if (prefix) keys.push(prefix)
    return keys
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return keys
  }
  for (const [k, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === "string" || typeof v === "number") {
      keys.push(path)
    } else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...collectLeafKeys(v, path))
    }
  }
  return keys
}

/**
 * @param {unknown} root
 * @param {string} keyPath
 * @returns {'ok' | 'missing' | 'nonLeaf'}
 */
function classifyKey(root, keyPath) {
  const parts = keyPath.split(".").filter(Boolean)
  if (parts.length === 0) return "missing"
  let cur = root
  for (const part of parts) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return "missing"
    if (!Object.prototype.hasOwnProperty.call(cur, part)) return "missing"
    cur = /** @type {Record<string, unknown>} */ (cur)[part]
  }
  if (typeof cur === "string" || typeof cur === "number") return "ok"
  if (cur !== null && typeof cur === "object" && !Array.isArray(cur)) return "nonLeaf"
  return "missing"
}

/**
 * @param {string} content
 * @returns {{ key: string, line: number, kind: string }[]}
 */
function extractKeyUsages(content) {
  /** @type {{ key: string, line: number, kind: string }[]} */
  const found = []
  const lines = content.split(/\r?\n/)

  const record = (key, lineIndex, kind) => {
    if (!key || key.includes("${")) return
    found.push({ key, line: lineIndex + 1, kind })
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // t("…") / t('…') — first string arg only
    const tCall = /\bt\s*\(\s*(["'`])([^"'`]*)\1/g
    let m
    while ((m = tCall.exec(line)) !== null) {
      const quote = m[1]
      if (quote === "`" && m[2].includes("${")) {
        found.push({ key: m[2], line: i + 1, kind: "dynamicTemplate" })
        continue
      }
      record(m[2], i, "t()")
    }

    // i18n.t("…")
    const i18nT = /i18n\.t\s*\(\s*(["'`])([^"'`]*)\1/g
    while ((m = i18nT.exec(line)) !== null) {
      if (m[1] === "`" && m[2].includes("${")) {
        found.push({ key: m[2], line: i + 1, kind: "dynamicTemplate" })
        continue
      }
      record(m[2], i, "i18n.t()")
    }

    // i18nKey="…" or i18nKey='…' or i18nKey={"…"} / i18nKey={'…'}
    const i18nKeyEq = /i18nKey\s*=\s*(["'])([^"']+)\1/g
    while ((m = i18nKeyEq.exec(line)) !== null) {
      record(m[2], i, "i18nKey")
    }
    const i18nKeyBrace = /i18nKey\s*=\s*\{\s*(["'])([^"']+)\1\s*\}/g
    while ((m = i18nKeyBrace.exec(line)) !== null) {
      record(m[2], i, "i18nKey")
    }
  }

  return found
}

/** Normalize for matching (Windows paths). */
function posixRel(p) {
  return p.replace(/\\/g, "/")
}

/** @param {string} relPath path relative to frontend root */
function fileArea(relPath) {
  const p = posixRel(relPath)
  if (p.startsWith("packages/ui/")) return "ui"
  if (p.startsWith("web/")) return "web"
  return "other"
}

/**
 * @param {Map<string, { file: string, line: number, kind: string }[]>} map
 * @param {'ui' | 'web' | 'other'} area
 */
function mapForArea(map, area) {
  const out = new Map()
  for (const [key, locs] of map) {
    const filtered = locs.filter((loc) => fileArea(loc.file) === area)
    if (filtered.length) out.set(key, filtered)
  }
  return out
}

function serializeKeyMap(map) {
  return Object.fromEntries([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])))
}

/**
 * @param {Map<string, { file: string, line: number, kind: string }[]>} missing
 * @param {Map<string, { file: string, line: number, kind: string }[]>} nonLeaf
 */
function printAreaWrongKeys(title, missingMap, nonLeafMap) {
  const mCount = missingMap.size
  const nCount = nonLeafMap.size
  if (mCount === 0 && nCount === 0) return

  console.log(`${title}\n`)

  if (mCount > 0) {
    console.log(`  Missing (${mCount} keys):\n`)
    for (const [key, locs] of [...missingMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`    ${key}`)
      for (const loc of locs) {
        console.log(`      ${loc.kind}  ${loc.file}:${loc.line}`)
      }
    }
    console.log()
  }

  if (nCount > 0) {
    console.log(`  Non-leaf — key points at an object, not a string (${nCount} keys):\n`)
    for (const [key, locs] of [...nonLeafMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`    ${key}`)
      for (const loc of locs) {
        console.log(`      ${loc.kind}  ${loc.file}:${loc.line}`)
      }
    }
    console.log()
  }
}

function main() {
  const jsonOut = process.argv.includes("--json")
  const showUnused = process.argv.includes("--unused")

  const raw = readFileSync(EN_JSON, "utf8")
  const en = JSON.parse(raw)
  const leafSet = new Set(collectLeafKeys(en))
  /** Every static key string seen in code (valid or not). */
  const usedStaticKeys = new Set()

  const scanRoots = [
    join(FRONTEND_ROOT, "web"),
    join(FRONTEND_ROOT, "packages/ui/src"),
  ]
  const extraPackages = readdirSync(join(FRONTEND_ROOT, "packages"), { withFileTypes: true })
  for (const ent of extraPackages) {
    if (!ent.isDirectory()) continue
    if (ent.name === "ui" || ent.name === "i18n") continue
    const src = join(FRONTEND_ROOT, "packages", ent.name, "src")
    try {
      if (statSync(src).isDirectory()) scanRoots.push(src)
    } catch {
      /* skip */
    }
  }

  /** @type {string[]} */
  const files = []
  for (const root of scanRoots) {
    try {
      if (statSync(root).isDirectory()) walkSourceFiles(root, files)
    } catch {
      /* skip missing */
    }
  }

  /** @type {Map<string, { file: string, line: number, kind: string }[]>} */
  const missing = new Map()
  /** @type {Map<string, { file: string, line: number, kind: string }[]>} */
  const nonLeaf = new Map()
  /** @type { { file: string, line: number, kind: string, snippet: string }[]} */
  const dynamic = []

  for (const filePath of files) {
    const rel = relative(FRONTEND_ROOT, filePath)
    const content = readFileSync(filePath, "utf8")
    const usages = extractKeyUsages(content)
    for (const u of usages) {
      if (u.kind === "dynamicTemplate") {
        dynamic.push({
          file: rel,
          line: u.line,
          kind: u.kind,
          snippet: u.key.slice(0, 80) + (u.key.length > 80 ? "…" : ""),
        })
        continue
      }
      usedStaticKeys.add(u.key)
      const status = classifyKey(en, u.key)
      if (status === "ok") continue
      const bucket = status === "nonLeaf" ? nonLeaf : missing
      const list = bucket.get(u.key) ?? []
      list.push({ file: rel, line: u.line, kind: u.kind })
      bucket.set(u.key, list)
    }
  }

  const unused = [...leafSet].filter((k) => !usedStaticKeys.has(k)).sort()

  const missingUi = mapForArea(missing, "ui")
  const missingWeb = mapForArea(missing, "web")
  const missingOther = mapForArea(missing, "other")
  const nonLeafUi = mapForArea(nonLeaf, "ui")
  const nonLeafWeb = mapForArea(nonLeaf, "web")
  const nonLeafOther = mapForArea(nonLeaf, "other")

  const dynamicUi = dynamic.filter((d) => fileArea(d.file) === "ui")
  const dynamicWeb = dynamic.filter((d) => fileArea(d.file) === "web")
  const dynamicOther = dynamic.filter((d) => fileArea(d.file) === "other")

  const report = {
    localeFile: relative(FRONTEND_ROOT, EN_JSON),
    leafKeyCount: leafSet.size,
    filesScanned: files.length,
    missing: serializeKeyMap(missing),
    nonLeaf: serializeKeyMap(nonLeaf),
    wrongByArea: {
      ui: {
        missing: serializeKeyMap(missingUi),
        nonLeaf: serializeKeyMap(nonLeafUi),
        missingKeyCount: missingUi.size,
        nonLeafKeyCount: nonLeafUi.size,
        issueCount:
          [...missingUi.values()].reduce((n, locs) => n + locs.length, 0) +
          [...nonLeafUi.values()].reduce((n, locs) => n + locs.length, 0),
      },
      web: {
        missing: serializeKeyMap(missingWeb),
        nonLeaf: serializeKeyMap(nonLeafWeb),
        missingKeyCount: missingWeb.size,
        nonLeafKeyCount: nonLeafWeb.size,
        issueCount:
          [...missingWeb.values()].reduce((n, locs) => n + locs.length, 0) +
          [...nonLeafWeb.values()].reduce((n, locs) => n + locs.length, 0),
      },
      other: {
        missing: serializeKeyMap(missingOther),
        nonLeaf: serializeKeyMap(nonLeafOther),
        missingKeyCount: missingOther.size,
        nonLeafKeyCount: nonLeafOther.size,
        issueCount:
          [...missingOther.values()].reduce((n, locs) => n + locs.length, 0) +
          [...nonLeafOther.values()].reduce((n, locs) => n + locs.length, 0),
      },
    },
    dynamicTemplateUsages: dynamic,
    dynamicTemplateByArea: {
      ui: dynamicUi,
      web: dynamicWeb,
      other: dynamicOther,
    },
    possiblyUnusedLeafKeys: unused,
  }

  const exitBad = missing.size > 0 || nonLeaf.size > 0

  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2))
    process.exit(exitBad ? 1 : 0)
    return
  }

  console.log(`i18n key check — ${report.leafKeyCount} leaf keys in en.json, ${report.filesScanned} files scanned\n`)

  if (missing.size === 0 && nonLeaf.size === 0) {
    console.log("No missing or non-leaf key usages found (static literals).\n")
  } else {
    console.log("──────── Wrong keys by where they are used ────────\n")

    printAreaWrongKeys(
      `▸ UI package (@lumiere/ui) — ${report.wrongByArea.ui.issueCount} reference(s), ${missingUi.size + nonLeafUi.size} distinct key(s)`,
      missingUi,
      nonLeafUi,
    )

    printAreaWrongKeys(
      `▸ Web app (frontend/web) — ${report.wrongByArea.web.issueCount} reference(s), ${missingWeb.size + nonLeafWeb.size} distinct key(s)`,
      missingWeb,
      nonLeafWeb,
    )

    printAreaWrongKeys(
      `▸ Other packages — ${report.wrongByArea.other.issueCount} reference(s), ${missingOther.size + nonLeafOther.size} distinct key(s)`,
      missingOther,
      nonLeafOther,
    )

    console.log("──────── Combined (all areas) ────────\n")

    if (missing.size > 0) {
      console.log(`Missing keys (${missing.size}):\n`)
      for (const [key, locs] of [...missing.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        console.log(`  ${key}`)
        for (const loc of locs) {
          const tag = fileArea(loc.file)
          console.log(`    [${tag}] ${loc.kind}  ${loc.file}:${loc.line}`)
        }
      }
      console.log()
    }
    if (nonLeaf.size > 0) {
      console.log(`Non-leaf keys (path exists but value is an object — wrong key) (${nonLeaf.size}):\n`)
      for (const [key, locs] of [...nonLeaf.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        console.log(`  ${key}`)
        for (const loc of locs) {
          const tag = fileArea(loc.file)
          console.log(`    [${tag}] ${loc.kind}  ${loc.file}:${loc.line}`)
        }
      }
      console.log()
    }
  }

  if (dynamic.length > 0) {
    console.log(`Dynamic template literal t() / i18n.t() (not validated) (${dynamic.length}):\n`)
    const printDyn = (label, list) => {
      if (list.length === 0) return
      console.log(`  ${label} (${list.length}):\n`)
      for (const d of list) {
        console.log(`    ${d.file}:${d.line}  ${d.snippet}`)
      }
      console.log()
    }
    printDyn("UI package", dynamicUi)
    printDyn("Web app", dynamicWeb)
    printDyn("Other packages", dynamicOther)
  }

  if (showUnused && unused.length > 0) {
    console.log(
      `Possibly unused leaf keys (${unused.length}) — literals only; ignore if keys are composed at runtime:\n`,
    )
    for (const k of unused) console.log(`  ${k}`)
    console.log()
  } else if (!showUnused) {
    console.log(
      `${unused.length} leaf keys never seen as string literals (use --unused to list; often false positives).\n`,
    )
  }

  process.exit(exitBad ? 1 : 0)
}

main()

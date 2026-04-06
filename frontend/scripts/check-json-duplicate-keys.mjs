#!/usr/bin/env node
/**
 * Detects duplicate property names within the same JSON object.
 * Standard JSON.parse silently keeps the last value — this fails the build instead.
 *
 * Usage:
 *   node scripts/check-json-duplicate-keys.mjs
 *   node scripts/check-json-duplicate-keys.mjs path/to/file.json
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_FILE = join(__dirname, "../packages/i18n/src/locales/en.json")

/**
 * @param {string} str
 * @returns {{ path: string, key: string }[]}
 */
export function findDuplicateJsonKeys(str) {
  let i = 0
  /** @type {{ path: string, key: string }[]} */
  const duplicates = []

  const skipWs = () => {
    while (i < str.length && /\s/.test(str[i])) i++
  }

  const readString = () => {
    const start = i
    if (str[i] !== '"') throw new Error(`Expected string at ${i}`)
    i++
    while (i < str.length) {
      const ch = str[i]
      if (ch === "\\") {
        i += 2
        continue
      }
      if (ch === '"') {
        const raw = str.slice(start, i + 1)
        i++
        return JSON.parse(raw)
      }
      i++
    }
    throw new Error(`Unterminated string starting at ${start}`)
  }

  const skipNumber = () => {
    if (str[i] === "-") i++
    while (i < str.length && str[i] >= "0" && str[i] <= "9") i++
    if (str[i] === ".") {
      i++
      while (i < str.length && str[i] >= "0" && str[i] <= "9") i++
    }
    if (str[i] === "e" || str[i] === "E") {
      i++
      if (str[i] === "+" || str[i] === "-") i++
      while (i < str.length && str[i] >= "0" && str[i] <= "9") i++
    }
  }

  const skipLiteral = (lit) => {
    if (!str.slice(i, i + lit.length).startsWith(lit)) {
      throw new Error(`Expected "${lit}" at ${i}, got ${str.slice(i, i + 20)}`)
    }
    i += lit.length
  }

  /** @param {string} path */
  const parseObject = (path) => {
    if (str[i] !== "{") throw new Error(`Expected { at ${i}`)
    i++
    skipWs()
    if (str[i] === "}") {
      i++
      return
    }
    const keys = new Set()
    while (true) {
      skipWs()
      const key = readString()
      const childPath = path === "" ? key : `${path}.${key}`
      skipWs()
      if (str[i] !== ":") throw new Error(`Expected : after key at ${i}`)
      i++
      skipWs()

      if (keys.has(key)) {
        duplicates.push({ path: childPath, key })
      }
      keys.add(key)

      parseValue(childPath)

      skipWs()
      if (str[i] === ",") {
        i++
        continue
      }
      if (str[i] === "}") {
        i++
        return
      }
      throw new Error(`Expected , or } in object at ${i}`)
    }
  }

  const parseArray = () => {
    if (str[i] !== "[") throw new Error(`Expected [ at ${i}`)
    i++
    skipWs()
    if (str[i] === "]") {
      i++
      return
    }
    let idx = 0
    while (true) {
      parseValue(`[${idx}]`)
      skipWs()
      if (str[i] === ",") {
        i++
        idx++
        continue
      }
      if (str[i] === "]") {
        i++
        return
      }
      throw new Error(`Expected , or ] in array at ${i}`)
    }
  }

  /** @param {string} path */
  function parseValue(path) {
    skipWs()
    const ch = str[i]
    if (ch === '"') {
      readString()
      return
    }
    if (ch === "{") {
      parseObject(path)
      return
    }
    if (ch === "[") {
      parseArray()
      return
    }
    if (ch === "t") {
      skipLiteral("true")
      return
    }
    if (ch === "f") {
      skipLiteral("false")
      return
    }
    if (ch === "n") {
      skipLiteral("null")
      return
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      skipNumber()
      return
    }
    throw new Error(`Unexpected value at ${i}: ${ch}`)
  }

  skipWs()
  if (str[i] === "{") {
    parseObject("")
  } else if (str[i] === "[") {
    parseArray()
  } else {
    throw new Error(`JSON must be object or array at start, got ${str[i]}`)
  }
  skipWs()
  if (i !== str.length) {
    throw new Error(`Trailing content after JSON at offset ${i}`)
  }

  return duplicates
}

function main() {
  const file = process.argv[2] ?? DEFAULT_FILE
  const raw = readFileSync(file, "utf8")
  try {
    const dups = findDuplicateJsonKeys(raw)
    if (dups.length === 0) {
      console.log(`No duplicate keys in ${file}`)
      process.exit(0)
      return
    }
    console.error(`Duplicate keys in ${file} (${dups.length}):\n`)
    for (const { path, key } of dups) {
      console.error(`  "${key}" at path: ${path || "(root)"}`)
    }
    console.error("\nJSON parsers keep the last occurrence — merge objects or rename keys.")
    process.exit(1)
  } catch (e) {
    console.error(`Failed to parse ${file}:`, /** @type {Error} */ (e).message)
    process.exit(1)
  }
}

main()

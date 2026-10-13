#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises"
import process from "node:process"

const checkOnly = process.argv.includes("--check")
const positional = process.argv.slice(2).filter((arg) => arg !== "--check")
const sourcePath = positional[0] ?? ".contracts-staging/ts/generated/types.ts"
const outputPath = positional[1] ?? "frontend/packages/stdb/src/stdb-http-option-fields.json"

function snakeCase(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
}

export function collectOptionFields(source) {
  const result = {}
  let objectName = null
  let fields = []
  let getterName = null

  for (const line of source.split("\n")) {
    const objectStart = line.match(/^export const ([A-Za-z][A-Za-z0-9]*) = __t\.object\("\1", \{$/)
    if (objectStart) {
      objectName = objectStart[1]
      fields = []
      getterName = null
      continue
    }
    if (!objectName) continue

    if (line === "});") {
      if (fields.length > 0) result[objectName] = fields
      objectName = null
      fields = []
      getterName = null
      continue
    }

    const direct = line.match(/^  ([A-Za-z][A-Za-z0-9]*): __t\.option\(/)
    if (direct) {
      fields.push(snakeCase(direct[1]))
      continue
    }

    const getter = line.match(/^  get ([A-Za-z][A-Za-z0-9]*)\(\) \{$/)
    if (getter) {
      getterName = getter[1]
      continue
    }
    if (getterName && /^    return __t\.option\(/.test(line)) {
      fields.push(snakeCase(getterName))
      getterName = null
    }
  }

  if (objectName) throw new Error(`unterminated generated type object: ${objectName}`)
  return result
}

const source = await readFile(sourcePath, "utf8")
const rendered = `${JSON.stringify(collectOptionFields(source), null, 2)}\n`

if (checkOnly) {
  const current = await readFile(outputPath, "utf8")
  if (current !== rendered) {
    process.stderr.write(
      `${outputPath} is stale; run scripts/generate-stdb-http-option-fields.mjs ${sourcePath} ${outputPath}\n`,
    )
    process.exitCode = 1
  }
} else {
  await writeFile(outputPath, rendered, "utf8")
}

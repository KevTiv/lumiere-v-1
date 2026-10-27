import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const frontend = fileURLToPath(new URL("../", import.meta.url))
const roots = ["packages/ui/src", "web/app", "web/components"]

function violations(source, file) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found = []
  function visit(node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(ast) === "select"
    ) {
      found.push(
        `${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}: use the shared Select or record pickers`,
      )
    }
    if (
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier.text === "@radix-ui/react-select" &&
      file !== "packages/ui/src/components/select.tsx"
    ) {
      found.push(`${file}: import Select from the shared UI package`)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return found
}

async function scan(directory) {
  const found = []
  for (const entry of await readdir(path.join(frontend, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`
    if (file === "packages/ui/src/native") continue // Separate React Native primitives.
    if (entry.isDirectory()) found.push(...(await scan(file)))
    else if (/\.tsx?$/.test(file) && !/\.(test|spec)\.tsx?$/.test(file))
      found.push(...violations(await readFile(path.join(frontend, file), "utf8"), file))
  }
  return found
}

if (process.argv.includes("--self-test")) {
  assert.equal(
    violations(
      'const x = <select value="a"><option>a</option></select>',
      "web/components/example.tsx",
    ).length,
    1,
  )
  assert.equal(violations("const x = <select />", "web/app/example.tsx").length, 1)
  assert.equal(
    violations(
      'const x = <Select><SelectItem value="a">A</SelectItem></Select>',
      "web/components/example.tsx",
    ).length,
    0,
  )
  assert.equal(
    violations('const text = "<select>" // <select />', "web/components/example.tsx").length,
    0,
  )
  assert.equal(
    violations('import * as Select from "@radix-ui/react-select"', "web/components/example.tsx")
      .length,
    1,
  )
  assert.equal(
    violations(
      'import * as Select from "@radix-ui/react-select"',
      "packages/ui/src/components/select.tsx",
    ).length,
    0,
  )
  console.log("Shared select guard: 6 self-tests passed")
} else {
  const found = (await Promise.all(roots.map(scan))).flat()
  if (found.length) {
    console.error(found.join("\n"))
    process.exitCode = 1
  } else
    console.log(
      "Shared select guard passed (production web and UI source; tests, dev routes and native primitives excluded)",
    )
}

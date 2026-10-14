// Read the pinned contracts package as-is. This derives metadata, never edits contracts.
import { execFileSync } from 'node:child_process'
import { SourceTextModule, SyntheticModule } from 'node:vm'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { alphaDemoFixtures } from './alpha-demo-fixtures.mjs'

export async function demoContractSchema(archive, operations) {
  const read = path => execFileSync('tar', ['-xOf', archive, `package/dist/generated/${path}`], { maxBuffer: 16 * 1024 * 1024 }).toString()
  const t = new Proxy({}, { get: (_target, kind) => (...args) => {
    if (kind === 'object' || kind === 'enum') return { kind, name: args[0], fields: args[1] }
    if (kind === 'option' || kind === 'array') return { kind, element: args[0] }
    return { kind }
  } })
  const primitives = new SyntheticModule(['t'], function () { this.setExport('t', t) })
  const types = new SourceTextModule(read('types.js'))
  await types.link(() => primitives)
  await types.evaluate()
  const descriptors = new SourceTextModule(read('operation-descriptors.js'))
  await descriptors.link(() => { throw new Error('Unexpected descriptor import') })
  await descriptors.evaluate()

  function plain(type, depth = 0) {
    if (depth > 12) throw new Error(`Recursive seed type: ${type.name}`)
    if (type.kind === 'object' || type.kind === 'enum') return {
      kind: type.kind, name: type.name,
      fields: Object.fromEntries(Object.entries(type.fields).map(([key, value]) => [key, plain(value, depth + 1)])),
    }
    return type.element ? { kind: type.kind, element: plain(type.element, depth + 1) } : { kind: type.kind }
  }

  const output = {}
  for (const name of operations) {
    const descriptor = descriptors.namespace.SESSION_OPERATION_DESCRIPTORS[name]
    if (!descriptor) throw new Error(`Seed operation is not session-exposed: ${name}`)
    const binding = new SourceTextModule(read(`${name}_reducer.js`))
    await binding.link(path => path === 'spacetimedb' ? primitives : types)
    await binding.evaluate()
    output[name] = { operationId: descriptor.contractOperationId,
      fields: Object.fromEntries(Object.entries(binding.namespace.default).map(([key, value]) => [key, plain(value)])) }
  }
  return output
}

export async function alphaSeedPayload(archive) {
  const fixtures = alphaDemoFixtures()
  const operations = await demoContractSchema(archive, [...new Set(fixtures.map(fixture => fixture.operation))])
  const temporary = mkdtempSync(join(tmpdir(), 'alpha-contract-tables-'))
  try {
    execFileSync('tar', ['-xzf', archive, '-C', temporary, '--wildcards', 'package/dist/generated/*_table.js'])
    const root = join(temporary, 'package/dist/generated')
    const tables = readdirSync(root).filter(name => name.endsWith('_table.js')).map(file => {
      const contents = readFileSync(join(root, file), 'utf8')
      const columns = contents.split('\n').flatMap(line => {
        const key = line.match(/^\s+(\w+):/)
        if (!key) return []
        return [line.match(/\.name\("([^"]+)"\)/)?.[1] ?? key[1]]
      })
      return { name: file.replace(/_table\.js$/, ''), organizationOwned: /^\s+organizationId:/m.test(contents), hasId: /^\s+id:/m.test(contents), columns }
    })
    return { fixtures, schema: { operations, tables } }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1]?.endsWith('/demo-contract-schema.mjs')) {
  if (process.argv[3] === '--payload') {
    console.log(JSON.stringify(await alphaSeedPayload(process.argv[2])))
    process.exit(0)
  }
  const schema = await demoContractSchema(process.argv[2], process.argv.slice(3))
  for (const [operation, definition] of Object.entries(schema)) {
    const brief = type => type.kind === 'object' ? Object.fromEntries(Object.entries(type.fields).map(([k, v]) => [k, brief(v)])) :
      type.kind === 'enum' ? Object.keys(type.fields).join('|') : type.kind === 'option' ? `optional(${typeof brief(type.element) === 'object' ? type.element.name : brief(type.element)})` : type.kind
    console.log(JSON.stringify({ operation, fields: brief({ kind: 'object', fields: definition.fields }) }))
  }
}

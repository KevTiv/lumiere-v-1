import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'
import { requiresPrivatePageLogin } from '../lib/private-release-policy'

const webRoot = fileURLToPath(new URL('../', import.meta.url))

test('favicon handling does not relax production private-page login policy', () => {
  assert.equal(requiresPrivatePageLogin('/favicon.ico', true, false), false)
  for (const pathname of ['/overview', '/accounting']) {
    assert.equal(requiresPrivatePageLogin(pathname, true, false), true)
    assert.equal(requiresPrivatePageLogin(pathname, true, true), false)
  }
})

test('favicon serves the real static icon without proxy authentication or root layout rendering', { timeout: 120_000 }, async () => {
  // Read the actual matcher without importing AuthKit or requiring provider secrets.
  const source = await readFile(path.join(webRoot, 'proxy.ts'), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const module = { exports: {} as { config?: { matcher: string[] } } }
  new Function('module', 'exports', 'require', compiled)(module, module.exports, () => ({}))
  const config = module.exports.config!

  // An isolated Next app uses the real config and icon, but deliberately throws
  // if any request reaches the root layout. No ERP/API/provider services needed.
  const fixture = await mkdtemp(path.join(webRoot, '.favicon-routing-'))
  let server: ReturnType<typeof spawn> | undefined
  let output = ''
  try {
    await mkdir(path.join(fixture, 'app'))
    await mkdir(path.join(fixture, 'public'))
    const icon = await readFile(path.join(webRoot, 'public/icon.svg'))
    await writeFile(path.join(fixture, 'public/icon.svg'), icon)
    await writeFile(path.join(fixture, 'package.json'), '{"private":true,"type":"module"}')
    // Exercise production routing, not standalone deployment packaging/tracing.
    await writeFile(path.join(fixture, 'next.config.mjs'), `
import config from '../next.config.mjs'
export default { ...config, output: undefined }
`)
    await writeFile(path.join(fixture, 'proxy.js'), `
export const config = ${JSON.stringify(config)}
export function proxy() {
  throw new Error('FAVICON_AUTH_PROXY_EXECUTED')
}
`)
    await writeFile(path.join(fixture, 'app/layout.js'), `
export const dynamic = 'force-dynamic'
export default function Layout() {
  throw new Error('FAVICON_AUTHENTICATED_LAYOUT_EXECUTED')
}
`)
    await writeFile(path.join(fixture, 'app/page.js'), 'export default function Page() { return null }\n')

    const reservation = createServer()
    reservation.listen(0, '127.0.0.1')
    await once(reservation, 'listening')
    const port = (reservation.address() as { port: number }).port
    await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()))
    const nextBin = path.join(webRoot, 'node_modules/next/dist/bin/next')
    const options = {
      cwd: webRoot,
      env: { ...process.env, WORKOS_CLIENT_ID: 'client_favicon_regression', NEXT_PUBLIC_API_GATEWAY_URL: '', NEXT_TELEMETRY_DISABLED: '1' },
    }
    server = spawn(process.execPath, [nextBin, 'build', fixture, '--webpack'], options)
    server.stdout!.on('data', chunk => { output += chunk })
    server.stderr!.on('data', chunk => { output += chunk })
    const [buildCode] = await once(server, 'exit')
    assert.equal(buildCode, 0, output)
    server = spawn(process.execPath, [nextBin, 'start', fixture, '--hostname', '127.0.0.1', '--port', String(port)], options)
    server.stdout!.on('data', chunk => { output += chunk })
    server.stderr!.on('data', chunk => { output += chunk })
    const url = `http://127.0.0.1:${port}`
    let response: Response | undefined
    for (let attempt = 0; attempt < 120; attempt++) {
      assert.equal(server.exitCode, null, output)
      try {
        response = await fetch(`${url}/favicon.ico`, { redirect: 'manual' })
        break
      } catch {
        await new Promise(resolve => setTimeout(resolve, 250))
      }
    }
    assert.ok(response, output)
    assert.equal(response.status, 200, output)
    assert.match(response.headers.get('content-type') ?? '', /image\/svg\+xml/)
    assert.equal(response.headers.get('location'), null)
    assert.equal(response.headers.get('set-cookie'), null)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), icon)
    assert.equal(output.includes('FAVICON_AUTHENTICATED_LAYOUT_EXECUTED'), false, output)
    assert.equal(output.includes('FAVICON_AUTH_PROXY_EXECUTED'), false, output)

    // Positive controls: both traps are active. The current matcher excludes
    // favicon-prefixed paths; a missing one demonstrates the original fallthrough.
    const page = await fetch(`${url}/favicon.ico-missing`)
    assert.equal(page.status, 500)
    await page.text()
    assert.match(output, /FAVICON_AUTHENTICATED_LAYOUT_EXECUTED/)
    for (const pathname of ['/overview', '/accounting', '/sign-in', '/api/session']) {
      const privatePage = await fetch(`${url}${pathname}`)
      assert.equal(privatePage.status, 500, pathname)
      await privatePage.text()
      assert.match(output, /FAVICON_AUTH_PROXY_EXECUTED/, pathname)
    }
  } finally {
    if (server && server.exitCode === null) {
      const exited = once(server, 'exit')
      server.kill('SIGTERM')
      await exited
    }
    await rm(fixture, { recursive: true, force: true })
  }
})

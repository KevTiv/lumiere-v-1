import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { NextRequest, NextResponse } from 'next/server'
import { safeAuthReturnTo } from './auth-mode'
import * as crypto from 'node:crypto'

function loadSource(file: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  dependencies['./workos-config'] ??= { workOsRedirectUri: () => 'https://web.test/auth/callback' }
  dependencies['@/lib/workos-config'] ??= { workOsRedirectUri: () => 'https://web.test/auth/callback' }
  const module = { exports: {} as any }
  runInNewContext(compiled, {
    module, exports: module.exports, Headers, URL, console,
    process: { env: { WORKOS_CLIENT_ID: 'client', LUMIERE_API_SERVER_URL: 'http://api.test' } },
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency ${name}`)
      return dependencies[name]
    }, ...globals,
  })
  return module.exports
}

test('OAuth destinations reject absolute, protocol-relative, backslash and control redirects', () => {
  for (const path of ['https://evil.test', '//evil.test', '/\\evil.test', '/\nevil', '/\tevil']) assert.equal(safeAuthReturnTo(path), '/overview')
  assert.equal(safeAuthReturnTo('/accounting?tab=invoices'), '/accounting?tab=invoices')
})

test('BFF forwards refreshed provider credentials and removes browser cookies and forged identity', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const api = loadSource('./api-server-forward.ts', {
    './auth-mode': { isWorkOsEnabled: () => true }, 'next/server': { NextResponse },
    '@workos-inc/authkit-nextjs': { withAuth: async () => ({ accessToken: 'provider-token' }) },
  }, { fetch: async (url: string, init: RequestInit) => {
    calls.push({ url, init }); return new Response('{}', { headers: { 'set-cookie': 'stdb_token=internal' } })
  } })
  const response = await api.forwardToApiServerRequired(new NextRequest('https://web.test/api/query/companies', {
    headers: { cookie: 'stdb_token=legacy; wos-session=sealed', 'x-stdb-identity': 'forged' },
  }))
  assert.equal(calls[0].url, 'http://api.test/v1/query/companies')
  const headers = new Headers(calls[0].init.headers)
  assert.equal(headers.get('authorization'), 'Bearer provider-token')
  assert.equal(headers.get('cookie'), null)
  assert.equal(headers.get('x-stdb-identity'), null)
  assert.equal(response.headers.get('set-cookie'), null)
})

test('BFF preserves explicit invalid bearer and rejects cross-origin cookie writes', async () => {
  const calls: RequestInit[] = []
  const api = loadSource('./api-server-forward.ts', {
    './auth-mode': { isWorkOsEnabled: () => true }, 'next/server': { NextResponse },
    '@workos-inc/authkit-nextjs': { withAuth: async () => ({ accessToken: 'provider-token' }) },
  }, { fetch: async (_url: string, init: RequestInit) => { calls.push(init); return new Response('{}', { status: 401 }) } })
  const rejected = await api.forwardToApiServerRequired(new NextRequest('https://web.test/api/query/companies', { headers: { authorization: 'invalid' } }))
  assert.equal(rejected.status, 401)
  assert.equal(new Headers(calls[0].headers).get('authorization'), 'invalid')
  const crossOrigin = await api.forwardToApiServerRequired(new NextRequest('https://web.test/api/operations/create', {
    method: 'POST', headers: { origin: 'https://evil.test' }, body: '{}',
  }))
  assert.equal(crossOrigin.status, 403)
  assert.equal(calls.length, 1)
})

test('callback rejects legacy invite state and clears sealed session on rejection', async () => {
  let options: any; let admitted = 0; let cleared = 0
  const deleted: Array<{ name: string; value: string }> = []
  loadSource('../app/auth/callback/route.ts', {
    '@workos-inc/authkit-nextjs': { handleAuth: (value: unknown) => { options = value; return () => {} } },
    'next/headers': { cookies: async () => ({ set: (name: string, value: string) => deleted.push({ name, value }) }) },
    'next/server': { NextRequest, NextResponse }, '@/lib/auth-mode': { isWorkOsEnabled: () => true },
    '@/app/actions/save-stdb-token': { clearStdbSession: async () => { cleared++ } },
    '@/lib/workos-stdb-bridge': { bridgeWorkOsUserToStdbSession: async () => { admitted++ } },
  })
  await assert.rejects(options.onSuccess({ accessToken: 'provider', state: 'legacy-invite' }))
  assert.equal(admitted, 0)
  const result = await options.onError({ request: new NextRequest('https://web.test/auth/callback') })
  assert.equal(result.headers.get('location'), 'https://web.test/sign-in?error=admission_denied')
  assert.equal(deleted[0].name, 'wos-session'); assert.equal(deleted[0].value, ''); assert.equal(cleared, 1)
})


test('realtime credential is HTTP-only, path-scoped, bounded and never returned in JSON', async () => {
  const endpoint = loadSource('../app/api/auth/realtime-session/route.ts', {
    '@workos-inc/authkit-nextjs': { withAuth: async () => ({ accessToken: 'provider-token' }) },
    'next/server': { NextRequest, NextResponse }, '@/lib/auth-mode': { isWorkOsEnabled: () => true },
  })
  const response = await endpoint.POST(new NextRequest('https://web.test/api/auth/realtime-session', {
    method: 'POST', headers: { origin: 'https://web.test' },
  }))
  assert.equal(response.status, 200)
  assert.equal(await response.text(), '{"ready":true}')
  const cookie = response.headers.get('set-cookie')!
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /Path=\/v1\/realtime/)
  assert.match(cookie, /Max-Age=60/)
  assert.match(cookie, /SameSite=strict/i)
  const forbidden = await endpoint.POST(new NextRequest('https://web.test/api/auth/realtime-session', {
    method: 'POST', headers: { origin: 'https://evil.test' },
  }))
  assert.equal(forbidden.status, 403)
})


test('hosted realtime ignores external URLs and localhost direct-port defaults', () => {
  const realtime = loadSource('../../packages/query-hooks/src/hooks/realtime.ts', {
    react: { useEffect: () => {}, useRef: () => {} },
    './stdb': { invalidateStdbQueryResources: () => {} },
  }, {
    process: { env: { NEXT_PUBLIC_REALTIME_WS_URL: 'wss://external.test/ws', NEXT_PUBLIC_API_GATEWAY_URL: 'https://direct.test' } },
    window: { location: { protocol: 'http:', host: 'localhost:3000', hostname: 'localhost', port: '3000' } },
  })
  assert.equal(realtime.resolveRealtimeWsUrl(true), 'ws://localhost:3000/v1/realtime/ws')
  assert.equal(realtime.resolveRealtimeWsUrl(false), 'wss://external.test/ws')
})


test('WorkOS uses the runtime server callback URI before the public build-time value', () => {
  const config = loadSource('./workos-config.ts', { 'server-only': {} }, {
    process: { env: { NODE_ENV: 'production', WORKOS_REDIRECT_URI: 'https://runtime.test/auth/callback', NEXT_PUBLIC_WORKOS_REDIRECT_URI: 'https://build.test/auth/callback' } },
  })
  assert.equal(config.workOsRedirectUri(), 'https://runtime.test/auth/callback')
})

test('WorkOS rejects insecure production callbacks and authority or URL suffix injection', () => {
  for (const uri of ['http://app.test/auth/callback', 'https:///app.test/auth/callback', 'https://user:password@app.test/auth/callback', 'https://app.test/auth/callback?next=evil', 'https://app.test/auth/callback#fragment', '//app.test/auth/callback', 'https://app.test/other', 'https://app.test/\\evil']) {
    const config = loadSource('./workos-config.ts', { 'server-only': {} }, {
      process: { env: { NODE_ENV: 'production', WORKOS_REDIRECT_URI: uri } },
    })
    assert.throws(() => config.workOsRedirectUri())
  }
})

test('hosted invite cookie keeps the bearer secret out of the URL, is authenticated and expires', () => {
  const source = './hosted-invite-token.ts'
  const deps = { 'server-only': {}, 'node:crypto': crypto }
  const settings = (secret: string) => ({
    Buffer,
    process: { env: { NODE_ENV: 'production', WORKOS_COOKIE_PASSWORD: secret } },
  })
  const invite = loadSource(source, { ...deps }, settings('a-secret-password-at-least-32-chars-long'))
  const token = 'Abc_'.repeat(10) + '123'
  assert.equal(invite.validInviteToken(token), true)
  assert.equal(invite.validInviteToken(token + '!'), false)
  const sealed = invite.sealHostedInvite(token, 1_000_000)
  assert.ok(!sealed.includes(token))
  assert.equal(invite.openHostedInvite(sealed, 1_020_000), token)
  assert.equal(invite.openHostedInvite(sealed, 1_600_001), null)
  assert.equal(invite.openHostedInvite('broken'), null)
  const tampered = Buffer.from(sealed, 'base64url')
  tampered[tampered.length - 1] ^= 1
  assert.equal(invite.openHostedInvite(tampered.toString('base64url'), 1_020_000), null)
  const other = loadSource(source, { ...deps }, settings('another-password-with-at-least-32-chars'))
  assert.equal(other.openHostedInvite(sealed, 1_020_000), null)
  assert.equal(invite.hostedInviteCookieName(), '__Host-lumiere-invite')
  assert.equal(invite.hostedInviteCookieOptions().httpOnly, true)
  assert.equal(invite.hostedInviteCookieOptions().secure, true)
})

test('invite preparation clears query secrets and stores only sealed HTTP-only state', () => {
  const sealed = 'opaque.ciphertext'
  const handler = loadSource('../app/auth/invite/prepare/route.ts', {
    '@/lib/auth-mode': { isWorkOsEnabled: () => true },
    '@/lib/hosted-invite-token': {
      hostedInviteCookieName: () => '__Host-lumiere-invite',
      hostedInviteCookieOptions: () => ({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' }),
      INVITE_COOKIE_MAX_AGE: 600,
      validInviteToken: (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value),
      sealHostedInvite: () => sealed,
    },
    'next/server': { NextRequest, NextResponse },
  })
  const token = 'a'.repeat(43)
  const response = handler.GET(new NextRequest(`https://web.test/auth/invite/prepare?token=${token}`))
  assert.equal(response.status, 303)
  assert.equal(response.headers.get('location'), 'https://web.test/accept-invite')
  assert.match(response.headers.get('set-cookie') ?? '', /HttpOnly/)
  assert.match(response.headers.get('set-cookie') ?? '', /Secure/)
  assert.match(response.headers.get('set-cookie') ?? '', /opaque.ciphertext/)
  assert.ok(!(response.headers.get('set-cookie') ?? '').includes(token))
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer')
  const bad = handler.GET(new NextRequest('https://web.test/auth/invite/prepare?token=bad'))
  assert.equal(bad.headers.get('location'), 'https://web.test/accept-invite')
  assert.match(bad.headers.get('set-cookie') ?? '', /Max-Age=0/)
})

test('WorkOS invitation completion uses only the server cookie, not a forged browser token', async () => {
  const token = 'x'.repeat(43)
  const sent: Array<{ token: string }> = []
  const handler = loadSource('../app/api/auth/accept-invite/route.ts', {
    '@/lib/api-server-forward': { forwardToApiServerRequired: async (request: NextRequest) => {
      sent.push(await request.json())
      return NextResponse.json({ redirectTo: '/overview' })
    } },
    '@/lib/auth-mode': { isWorkOsEnabled: () => true },
    '@/lib/hosted-invite-token': {
      hostedInviteCookieName: () => 'lumiere-invite',
      hostedInviteCookieOptions: () => ({ httpOnly: true, sameSite: 'lax', path: '/', secure: false }),
      openHostedInvite: (value: string) => value === 'sealed-state' ? token : null,
    },
    'next/server': { NextRequest, NextResponse },
  })
  const request = (cookie: string, extra: Record<string, string> = {}) => new NextRequest(
    'https://web.test/api/auth/accept-invite',
    { method: 'POST', headers: { cookie, 'content-type': 'application/json', ...extra }, body: '{"token":"forged"}' },
  )
  const rejected = await handler.POST(request('lumiere-invite=sealed-state', { authorization: 'Bearer override' }))
  assert.equal(rejected.status, 403)
  assert.equal(sent.length, 0)
  const expired = await handler.POST(request('lumiere-invite=invalid'))
  assert.equal(expired.status, 400)
  assert.equal(sent.length, 0)
  const accepted = await handler.POST(request('lumiere-invite=sealed-state'))
  assert.equal(accepted.status, 200)
  assert.deepEqual(sent, [{ token }])
  assert.match(accepted.headers.get('set-cookie') ?? '', /Max-Age=0/)
  assert.ok(!(await accepted.text()).includes(token))
})

test('hosted invite redirect returns to the secret-free acceptance page', async () => {
  const destinations: string[] = []
  const action = loadSource('../app/actions/workos-auth.ts', {
    '@/lib/workos-config': { workOsRedirectUri: () => 'https://web.test/auth/callback' },
    '@/lib/auth-mode': { isWorkOsEnabled: () => true, safeAuthReturnTo },
    '@workos-inc/authkit-nextjs': {
      getSignInUrl: async ({ returnTo }: { returnTo: string }) => {
        destinations.push(returnTo); return 'https://provider.test/login'
      },
      getSignUpUrl: async () => 'https://provider.test/signup',
    },
    'next/navigation': { redirect: (_url: string) => undefined },
    '@/lib/post-auth-destination': { POST_AUTH_PATHS: { overview: '/overview', onboarding: '/onboarding' } },
  })
  await action.redirectToWorkOsForInvite(new FormData())
  assert.deepEqual(destinations, ['/accept-invite'])
})

test('hosted auth screen guards never render the native sign-in/signup forms in WorkOS mode', () => {
  for (const file of ['../app/(auth)/sign-in/page.tsx', '../app/(auth)/sign-up/page.tsx']) {
    const content = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.match(content, /!useWorkOsAuth && \(/)
  }
  const hosted = readFileSync(new URL('../app/(auth)/accept-invite/hosted-accept-invite.tsx', import.meta.url), 'utf8')
  assert.ok(!hosted.includes('searchParams.get("token")'))
  assert.ok(!hosted.includes('localStorage'))
  assert.ok(!hosted.includes('sessionStorage'))
})

test('ordinary hosted login resolves the saved destination, invitation, onboarding and suspension', async () => {
  const cases = [
    { status: 'ready', next: '/accounting?tab=invoices', destination: '/accounting?tab=invoices' },
    { status: 'ready', next: '/auth/complete', destination: '/overview' },
    { status: 'onboarding', next: '/overview', destination: '/onboarding' },
    { status: 'membership_suspended', next: '/overview', destination: '/sign-in?error=membership_suspended' },
    { status: 'invitation_required', next: '/overview', destination: '/sign-in?error=invitation_required' },
    { status: 'ready', next: '/overview', invite: true, destination: '/accept-invite' },
    { status: 'ready', next: '/overview', unavailable: true, destination: '/sign-in?error=authentication_unavailable' },
  ]
  for (const scenario of cases) {
    const page = loadSource('../app/auth/complete/page.tsx', {
      '@workos-inc/authkit-nextjs': { withAuth: async () => ({ accessToken: 'provider-access' }) },
      'next/headers': { cookies: async () => ({ get: () => ({ value: 'sealed-invite' }) }) },
      'next/navigation': { redirect: (path: string) => { throw new Error(path) } },
      '@/lib/api-server-forward': { resolveApiServerBaseUrl: () => 'http://api.test' },
      '@/lib/auth-mode': { isWorkOsEnabled: () => true, safeAuthReturnTo },
      '@/lib/hosted-invite-token': { hostedInviteCookieName: () => 'invite', openHostedInvite: () => scenario.invite ? 'invite-credential' : null },
      '@/lib/post-auth-destination': { POST_AUTH_PATHS: { overview: '/overview', onboarding: '/onboarding' } },
    }, {
      fetch: async (_url: string, init: RequestInit) => {
        assert.equal((init.headers as Record<string, string>).authorization, 'Bearer provider-access')
        return { ok: !scenario.unavailable, json: async () => ({ status: scenario.status }) }
      },
    })
    await assert.rejects(page.default({ searchParams: Promise.resolve({ next: scenario.next }) }),
      (error: Error) => error.message === scenario.destination)
  }
})

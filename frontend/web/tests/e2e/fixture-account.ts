import type { APIRequestContext } from '@playwright/test'

/** Trusted test setup only: public registration stays disabled, including in CI. */
export async function bootstrapFixtureAccountSession(
  api: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const token = process.env.STDB_SERVER_TOKEN?.trim()
  if (!token) throw new Error('Fixture account bootstrap requires STDB_SERVER_TOKEN')
  if (!email.toLowerCase().endsWith('.test')) throw new Error('Fixture accounts must use reserved .test addresses')
  const base = (process.env.LUMIERE_API_SERVER_URL ?? 'http://127.0.0.1:8082').replace(/\/$/, '')
  // Node fetch keeps the service credential out of browser contexts and native sign-in cookies.
  const bootstrap = await fetch(`${base}/v1/auth/internal/bootstrap-credential`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    redirect: 'error',
  })
  if (!bootstrap.ok) throw new Error(`Fixture credential bootstrap failed (${bootstrap.status})`)
  const account = await bootstrap.json() as { identity?: unknown }
  const identity = typeof account.identity === 'string' ? account.identity.replace(/^0x/i, '') : ''
  if (!/^[0-9a-f]{64}$/i.test(identity)) throw new Error('Fixture bootstrap returned an invalid identity')

  const signin = await api.post('/api/auth/signin', { data: { email, password } })
  if (!signin.ok()) throw new Error(`Fixture native sign-in failed (${signin.status()}): ${await signin.text()}`)
  const storedIdentity = (await api.storageState()).cookies.find((cookie) => cookie.name === 'stdb_identity')?.value.replace(/^0x/i, '')
  if (storedIdentity !== identity) throw new Error('Fixture native sign-in did not establish the bootstrapped identity')
  return identity
}

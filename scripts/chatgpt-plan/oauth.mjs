import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, unlink } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { readJson, safeFetch } from './responses.mjs'
import { SmokeError } from './errors.mjs'

export const ISSUER = 'https://auth.openai.com'
export const RESOURCE = 'https://api.openai.com/v1'
const AUTHORIZE = ISSUER + '/api/accounts/authorize'
const TOKEN = ISSUER + '/api/accounts/oauth/token'
const SHARING_SCOPE = 'chatgpt.tokens.use.direct'
const CALLBACK_PATH = '/auth/callback'
const DYNAMIC_CLIENT = 'dynamic_agent_client'
const STATE_DIR = join(homedir(), '.config', 'lumiere-chatgpt-plan')

const randomSecret = () => randomBytes(32).toString('base64url')
const validClient = (clientId) =>
  typeof clientId === 'string' && clientId !== DYNAMIC_CLIENT && /^[\da-zA-Z._-]{1,256}$/.test(clientId)

export function authorizationRequest(hostId, redirectUri, registration) {
  const verifier = randomSecret()
  const state = randomSecret()
  const nonce = randomSecret()
  const url = new URL(AUTHORIZE)
  url.search = new URLSearchParams({
    client_id: registration?.clientId ?? DYNAMIC_CLIENT,
    ext_agent_host_id: hostId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'openid profile email offline_access resource.invoke ' + SHARING_SCOPE,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  })
  if (!registration) url.searchParams.set('agent_name_hint', 'Lumière')
  return { url, state, nonce, verifier, redirectUri, registration }
}

export function parseCallback(url, attempt) {
  const only = (key) => {
    const values = url.searchParams.getAll(key)
    if (values.length > 1) throw new SmokeError('Invalid OAuth callback')
    return values[0]
  }
  if (only('state') !== attempt.state) throw new SmokeError('Invalid OAuth callback state')
  const authError = only('error')
  if (authError) throw new SmokeError('ChatGPT authorization was declined or interrupted')
  const code = only('code')
  const returned = only('client_id')
  const clientId = attempt.registration?.clientId ?? returned
  if (!code || !validClient(clientId) || (returned !== undefined && returned !== clientId)) {
    throw new SmokeError('Incomplete or unexpected ChatGPT registration')
  }
  return { code, clientId }
}

export async function exchange(attempt, callback, jwks, fetcher = fetch) {
  const response = await safeFetch(fetcher, TOKEN, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: callback.clientId,
      code: callback.code,
      code_verifier: attempt.verifier,
      redirect_uri: attempt.redirectUri,
      resource: RESOURCE,
    }),
  })
  if (!response.ok) throw new SmokeError('ChatGPT authorization code exchange failed')
  const tokens = await readJson(response)
  let identity
  try {
    const verified = await jwtVerify(tokens.id_token, jwks, {
      issuer: ISSUER,
      audience: callback.clientId,
      requiredClaims: ['exp', 'sub', 'nonce'],
      clockTolerance: 5,
    })
    identity = verified.payload
  } catch {
    throw new SmokeError('ChatGPT identity token verification failed')
  }
  if (
    identity.nonce !== attempt.nonce ||
    typeof identity.sub !== 'string' ||
    !identity.sub ||
    (identity.azp !== undefined && identity.azp !== callback.clientId) ||
    (Array.isArray(identity.aud) && identity.aud.length > 1 && identity.azp !== callback.clientId) ||
    (attempt.registration && identity.sub !== attempt.registration.subject)
  ) {
    throw new SmokeError('ChatGPT identity did not match this sign-in attempt')
  }
  if (
    typeof tokens.scope !== 'string' ||
    !tokens.scope.split(/\s+/).includes(SHARING_SCOPE) ||
    typeof tokens.access_token !== 'string' ||
    !tokens.access_token ||
    typeof tokens.token_type !== 'string' ||
    tokens.token_type.toLowerCase() !== 'bearer'
  ) {
    throw new SmokeError('ChatGPT plan usage is unavailable or permission was declined')
  }
  return {
    accessToken: tokens.access_token,
    registration: { clientId: callback.clientId, subject: identity.sub },
  }
}

async function readPrivate(path) {
  // Opening with O_NOFOLLOW avoids trusting a symlink as a registration file.
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0 || stat.size > 4096) {
        throw new SmokeError('ChatGPT registration has unsafe ownership, permissions, or size')
      }
      const contents = await file.readFile('utf8')
      try {
        return JSON.parse(contents)
      } catch {
        throw new SmokeError('Invalid ChatGPT registration file')
      }
    } finally {
      await file.close()
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return undefined
  }
}

async function writePrivateOnce(path, value) {
  const temporary = path + '.' + randomUUID()
  const file = await open(temporary, 'wx', 0o600)
  try {
    try {
      await file.writeFile(JSON.stringify(value))
    } finally {
      await file.close()
    }
    await link(temporary, path)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  } finally {
    await unlink(temporary)
  }
}

async function localRegistration(profile) {
  await mkdir(STATE_DIR, { recursive: true, mode: 0o700 })
  const directory = await lstat(STATE_DIR)
  if (!directory.isDirectory() || directory.uid !== process.getuid() || (directory.mode & 0o077) !== 0) {
    throw new SmokeError('ChatGPT registration directory must be local and owner-only')
  }
  const hostFile = join(STATE_DIR, 'host.json')
  if (!(await readPrivate(hostFile))) {
    await writePrivateOnce(hostFile, { hostId: 'urn:uuid:' + randomUUID() })
  }
  const { hostId } = await readPrivate(hostFile)
  if (!/^urn:uuid:[0-9a-f-]{36}$/.test(hostId)) throw new SmokeError('Invalid ChatGPT installation ID')
  const profileFile = join(STATE_DIR, profile + '.registration.json')
  const registration = await readPrivate(profileFile)
  if (registration && (!validClient(registration.clientId) || typeof registration.subject !== 'string')) {
    throw new SmokeError('Invalid saved ChatGPT registration')
  }
  return { hostId, profileFile, registration }
}

export async function signIn(profile) {
  if (!/^[a-z0-9-]{1,48}$/.test(profile)) throw new SmokeError('Invalid local profile label')
  const { hostId, profileFile, registration } = await localRegistration(profile)
  const pending = await authorizeInBrowser(hostId, registration)
  const jwks = createRemoteJWKSet(new URL('/.well-known/jwks.json', ISSUER))
  const result = await exchange(pending.attempt, pending.callback, jwks)
  await writePrivateOnce(profileFile, result.registration)
  const saved = await readPrivate(profileFile)
  if (saved.clientId !== result.registration.clientId || saved.subject !== result.registration.subject) {
    throw new SmokeError('This profile was registered by another process')
  }
  return result.accessToken
}

function authorizeInBrowser(hostId, registration) {
  return new Promise((resolve, reject) => {
    let attempt
    const server = createServer((req, res) => {
      if (!attempt) {
        res.writeHead(503).end()
        return
      }
      const redirect = new URL(attempt.redirectUri)
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Referrer-Policy', 'no-referrer')
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      if (req.method !== 'GET' || req.headers.host !== redirect.host) {
        res.writeHead(404).end()
        return
      }
      let url
      try {
        url = new URL(req.url, redirect.origin)
      } catch {
        res.writeHead(400).end()
        return
      }
      if (url.origin !== redirect.origin || url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end()
        return
      }
      if (url.searchParams.get('state') !== attempt.state) {
        res.writeHead(400).end('Invalid sign-in attempt.')
        return
      }
      try {
        const callback = parseCallback(url, attempt)
        res.end('ChatGPT authorization returned to Lumière. Continue in the terminal.')
        finish(undefined, { attempt, callback })
      } catch (error) {
        res.writeHead(400).end('ChatGPT authorization did not complete. Continue in the terminal.')
        finish(error)
      }
    })
    const timeout = setTimeout(() => finish(new SmokeError('ChatGPT authorization timed out')), 5 * 60_000)
    function finish(error, value) {
      clearTimeout(timeout)
      server.close()
      if (error) reject(error)
      else resolve(value)
    }
    server.requestTimeout = 10_000
    server.headersTimeout = 10_000
    server.on('error', () => finish(new SmokeError('Could not start the local OAuth callback listener')))
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      attempt = authorizationRequest(hostId, 'http://127.0.0.1:' + port + CALLBACK_PATH, registration)
      const opener = process.platform === 'darwin' ? '/usr/bin/open' : 'xdg-open'
      const browser = spawn(opener, [attempt.url.href], { stdio: 'ignore' })
      browser.on('error', () => finish(new SmokeError('Could not open the system browser')))
      browser.on('exit', (code) => {
        if (code !== 0) finish(new SmokeError('Could not open the system browser'))
      })
    })
  })
}

import { devicePaths } from '../protocol/v1.mjs'

const maxPairingResponseBytes = 16 * 1024
const localHosts = ['127.0.0.1', 'localhost', '[::1]']

export function gatewayOrigin(input) {
  const url = new URL(input)
  const allowed = url.protocol === 'https:' || (url.protocol === 'http:' && localHosts.includes(url.hostname))
  if (!allowed || url.pathname !== '/' || url.username || url.password || url.search || url.hash) {
    throw new Error('provide an HTTPS gateway origin without a path or query')
  }
  return url.origin
}

export function deviceEndpoint(gateway) {
  const url = new URL(devicePaths.connect, gatewayOrigin(gateway))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url
}

function validCredentials(value) {
  return value && typeof value.deviceId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value.deviceId) &&
    typeof value.credential === 'string' &&
    /^[\x21-\x7e]{1,4096}$/.test(value.credential)
}

async function readPairingResponse(response) {
  let size = 0
  const chunks = []
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength
    if (size > maxPairingResponseBytes) throw new Error('invalid pairing response')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('invalid pairing response')
  }
}

export async function claimDevice({ gateway, code, label, fetch = globalThis.fetch }) {
  const origin = gatewayOrigin(gateway)
  const normalizedCode = code.trim()
  if (!/^[A-Za-z0-9-]{4,128}$/.test(normalizedCode)) throw new Error('enter a valid one-time pairing code')
  if (label !== undefined && (label.length > 80 || /[\x00-\x1f\x7f]/.test(label))) {
    throw new Error('invalid device label')
  }
  const response = await fetch(new URL(devicePaths.claim, origin), {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ code: normalizedCode, ...(label && { label }) }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`pairing rejected (HTTP ${response.status})`)
  }
  const pairing = await readPairingResponse(response)
  if (!validCredentials(pairing)) throw new Error('invalid pairing response')
  return { gateway: origin, deviceId: pairing.deviceId, credential: pairing.credential }
}

export function validatePairing(pairing) {
  if (!validCredentials(pairing) || typeof pairing.gateway !== 'string') {
    throw new Error('pair this runner before connecting')
  }
  gatewayOrigin(pairing.gateway)
  return pairing
}

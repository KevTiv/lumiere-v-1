/**
 * Decode SpacetimeDB auth JWT payload to identity hex (no signature verification).
 * Used server-side when `stdb_identity` cookie is missing but `stdb_token` is present.
 */

export function decodeIdentityHexFromStdbToken(token: string): string | undefined {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return undefined
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const pad = '=='.slice(0, (4 - (b64.length % 4)) % 4)
    const json = JSON.parse(
      Buffer.from(b64 + pad, 'base64').toString('utf8'),
    ) as Record<string, unknown>
    const sub = json['sub']
    if (typeof sub === 'string') return sub.replace(/^0x/i, '')
    const id = json['identity']
    if (typeof id === 'string') return id.replace(/^0x/i, '')
    return undefined
  } catch {
    return undefined
  }
}

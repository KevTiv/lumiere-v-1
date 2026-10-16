/** Server-owned mode: matches the API server; public redirect URI alone never enables authentication. */
export function isWorkOsEnabled(): boolean {
  const enabled = Boolean(process.env.WORKOS_CLIENT_ID?.trim())
  if (enabled && process.env.NEXT_PUBLIC_API_GATEWAY_URL?.trim()) {
    throw new Error('WorkOS requires same-origin API routing; unset NEXT_PUBLIC_API_GATEWAY_URL')
  }
  return enabled
}

/** Only same-origin local paths may be placed into OAuth state. */
export function safeAuthReturnTo(value: unknown, fallback = '/overview'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\x00-\x20\x7f]/.test(value)) return fallback
  try {
    const url = new URL(value, 'https://local.invalid')
    return url.origin === 'https://local.invalid' ? `${url.pathname}${url.search}${url.hash}` : fallback
  } catch { return fallback }
}

const CAPTURE_PATHS = new Set(['/e', '/i/v0/e', '/i/v1/e', '/batch', '/decide', '/flags'])

type PostHogIngestConfig = {
  token?: string
  ingestHost?: string
  assetsHost?: string
}

export function posthogIngestRequest(
  requestUrl: Pick<URL, 'pathname' | 'search'>,
  request: Pick<Request, 'method' | 'headers'>,
  config: PostHogIngestConfig,
): { url: URL; headers: Headers } | null {
  const token = config.token?.trim()
  if (!token) return null

  const pathname = requestUrl.pathname.slice('/ingest'.length)
  const isAsset = pathname.startsWith('/static/') || pathname.startsWith('/array/')
  if (isAsset) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return null
  } else if (request.method !== 'POST' || !CAPTURE_PATHS.has(pathname.replace(/\/$/, ''))) {
    return null
  }

  const ingestHost = config.ingestHost?.trim() || 'https://eu.i.posthog.com'
  const defaultAssetsHost = ingestHost.includes('us.i.posthog.com')
    ? 'https://us-assets.i.posthog.com'
    : 'https://eu-assets.i.posthog.com'
  const upstream = URL.parse(isAsset ? config.assetsHost?.trim() || defaultAssetsHost : ingestHost)
  if (
    !upstream || upstream.protocol !== 'https:' || upstream.username || upstream.password ||
    upstream.pathname !== '/' || upstream.search || upstream.hash
  ) {
    return null
  }

  upstream.pathname = pathname
  if (upstream.pathname !== pathname) return null
  upstream.search = requestUrl.search

  // Allowlist SDK transport headers. ERP cookies, bearer tokens and internal
  // headers must never cross the external rewrite.
  const headers = new Headers({ host: upstream.host })
  for (const name of ['accept', 'content-type', 'content-encoding']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  if (request.headers.get('authorization') === `Bearer ${token}`) {
    headers.set('authorization', `Bearer ${token}`)
  }
  return { url: upstream, headers }
}

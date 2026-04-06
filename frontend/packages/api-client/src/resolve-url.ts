/** Join API base (no trailing slash) with path (must start with `/`). */
export function resolveApiUrl(baseUrl: string, path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`resolveApiUrl: path must start with /, got: ${path}`)
  }
  const base = baseUrl.replace(/\/$/, "")
  if (!base) return path
  return `${base}${path}`
}

/**
 * Final URL for `fetch` after optional `rewritePath`.
 * Rewriters such as `apiUrl` may return an absolute `http(s)://…` gateway URL; otherwise
 * `path` must start with `/` and is joined with `baseUrl` (Expo / custom hosts).
 */
export function resolveRequestUrl(baseUrl: string, pathOrAbsoluteUrl: string): string {
  if (/^https?:\/\//i.test(pathOrAbsoluteUrl)) {
    return pathOrAbsoluteUrl
  }
  return resolveApiUrl(baseUrl, pathOrAbsoluteUrl)
}

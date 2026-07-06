/** Build upstream `GET /v1/query/:resource` URL (no trailing slash on base). */
export function serverQueryUrl(baseUrl: string, resource: string): string {
  const base = baseUrl.replace(/\/$/, "")
  return `${base}/v1/query/${encodeURIComponent(resource)}`
}

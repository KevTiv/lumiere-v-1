import {
  decodeQueryListResponse,
  parseQueryListResponse,
  QueryResponseDecodeError,
  type QueryRows,
} from "./query-list"
import {
  queryResourceFailure,
  queryResourceRows,
  type QueryResourceState,
} from "./query-resource-state"
import { resolveRequestUrl } from "./resolve-url"
import { responseErrorMessage } from "./response-error"

export type LumiereApiClientConfig = {
  /**
   * Empty string = same-origin (browser + Next.js, cookie session).
   * Full origin for Expo, e.g. `https://app.example.com` (no trailing slash).
   */
  baseUrl: string
  /**
   * Cookie sessions on web. For cross-origin mobile, use `omit` and Bearer token.
   * @default `include` when baseUrl is empty, otherwise `omit`
   */
  credentials?: RequestCredentials
  /**
   * SpacetimeDB token for `Authorization: Bearer …` (Expo / non-cookie clients).
   * Server accepts this per `resolveApiSession` in the Next.js app.
   */
  getAccessToken?: () => string | null | Promise<string | null>
  /** Optional path rewriter before base join (e.g. Next.js `apiUrl` gateway). */
  rewritePath?: (path: string) => string
}

export type LumiereApiClient = {
  apiFetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  fetchQueryList: (path: string, errorMessage: string) => Promise<QueryRows>
  fetchQueryListState: (path: string) => Promise<QueryResourceState<Record<string, unknown>>>
  fetchQueryListAllowEmpty: (path: string) => Promise<QueryRows>
  parseQueryListResponse: typeof parseQueryListResponse
}

export function createLumiereApiClient(config: LumiereApiClientConfig): LumiereApiClient {
  const defaultCreds: RequestCredentials =
    config.credentials ?? (config.baseUrl === "" ? "include" : "omit")

  async function apiFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    let url: string | URL | Request = input
    if (typeof input === "string") {
      const path = config.rewritePath ? config.rewritePath(input) : input
      url = resolveRequestUrl(config.baseUrl, path)
    }
    const headers = new Headers(init?.headers)
    const token = await Promise.resolve(config.getAccessToken?.() ?? null)
    if (token) {
      headers.set("Authorization", `Bearer ${token}`)
    }
    return fetch(url, {
      ...init,
      headers,
      credentials: defaultCreds,
    })
  }

  async function fetchQueryList(path: string, errorMessage: string): Promise<QueryRows> {
    const r = await apiFetch(path)
    if (!r.ok) throw new Error(errorMessage)
    const json: unknown = await r.json()
    return parseQueryListResponse(json)
  }

  async function fetchQueryListAllowEmpty(path: string): Promise<QueryRows> {
    const r = await apiFetch(path)
    if (!r.ok) return []
    const json: unknown = await r.json()
    return parseQueryListResponse(json)
  }

  async function fetchQueryListState(path: string): Promise<QueryResourceState<Record<string, unknown>>> {
    try {
      const response = await apiFetch(path)
      if (!response.ok) {
        const message = await responseErrorMessage(response, `Query ${path} failed`)
        return queryResourceFailure(response.status, message)
      }
      const payload: unknown = await response.json()
      const rows = decodeQueryListResponse(payload, (row, index) => {
        if (row === null || typeof row !== "object" || Array.isArray(row)) {
          throw new QueryResponseDecodeError(`query response row ${index} must be an object`)
        }
        return row as Record<string, unknown>
      })
      return queryResourceRows(rows)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return queryResourceFailure(undefined, message)
    }
  }

  return {
    apiFetch,
    fetchQueryList,
    fetchQueryListState,
    fetchQueryListAllowEmpty,
    parseQueryListResponse,
  }
}

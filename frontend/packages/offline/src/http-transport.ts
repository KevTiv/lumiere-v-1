import { objectValue, u64 } from "./codecs.ts";
import {
  checkedScope,
  type ProjectionScope,
  type ProjectionTransport,
} from "./contracts.ts";
import { projectionSchemaHash } from "./generated/product-category.ts";

/** A denied/stale grant invalidates local materialization; an outage does not. */
export class ProjectionResetError extends Error {
  constructor(readonly status: number) {
    super(
      "Projection authorization or replay history changed; reconnect with a fresh scope",
    );
    this.name = "ProjectionResetError";
  }
}

/** Only a network failure or server outage can admit a previously signed offline lease. */
export class ProjectionUnavailableError extends Error {
  constructor(readonly status?: number) {
    super(
      status
        ? `Projection connection is unavailable (${status})`
        : "Projection connection is unavailable",
    );
    this.name = "ProjectionUnavailableError";
  }
}

export interface HttpProjectionOptions {
  /** Trusted API base, including /v1. Browser builds may use a configured BFF base. */
  apiUrl: string;
  companyId?: string;
  fetch?: typeof globalThis.fetch;
  /** Resolve current auth headers per request; credentials are never persisted to SQLite. */
  headers?: () => HeadersInit;
}

export async function connectCategoryTransport(
  options: HttpProjectionOptions,
  signal?: AbortSignal,
): Promise<{
  scope: Readonly<ProjectionScope>;
  transport: ProjectionTransport;
  grant(signal?: AbortSignal): Promise<unknown>;
}> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const base = new URL(options.apiUrl);
  if (
    !["https:", "http:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error("Invalid configured API base");
  const root = base.href.replace(/\/$/, "");
  async function request(
    endpoint: string,
    parameters: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const url = new URL(`${root}/offline/product-categories/${endpoint}`);
    url.search = new URLSearchParams(parameters).toString();
    let response: Response;
    try {
      response = await fetcher(url, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        redirect: "manual",
        headers: options.headers?.(),
        signal,
      });
    } catch (error) {
      if (
        !signal?.aborted &&
        (error instanceof TypeError ||
          (error instanceof DOMException && error.name === "NetworkError"))
      )
        throw new ProjectionUnavailableError();
      throw error;
    }
    if (
      response.type === "opaqueredirect" ||
      (response.status >= 300 && response.status < 400)
    )
      throw new ProjectionResetError(401);
    if ([401, 403, 409, 410].includes(response.status))
      throw new ProjectionResetError(response.status);
    if (!response.ok)
      if (response.status >= 500)
        throw new ProjectionUnavailableError(response.status);
    if (!response.ok)
      throw new Error(`Projection request failed (${response.status})`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing projection response body");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text = "";
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 4 * 1024 * 1024) {
          await reader.cancel();
          throw new Error("Projection response exceeds byte limit");
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    return JSON.parse(text) as unknown;
  }
  const discovery = objectValue(
    await request(
      "scope",
      options.companyId === undefined
        ? {}
        : { companyId: u64(options.companyId) },
      signal,
    ),
    ["scope", "schemaHash"],
  );
  if (discovery.schemaHash !== projectionSchemaHash)
    throw new ProjectionResetError(409);
  const scope = checkedScope(discovery.scope);
  const parameters = {
    authorizationVersion: scope.authorizationVersion,
    ...(scope.companyId === null ? {} : { companyId: scope.companyId }),
  };
  const transport: ProjectionTransport = {
    snapshot: (requestedScope, signal) => {
      requireScope(requestedScope);
      return request("snapshot", parameters, signal);
    },
    pull: (requestedScope, cursor, signal) => {
      requireScope(requestedScope);
      return request("pull", { ...parameters, cursor: u64(cursor) }, signal);
    },
  };
  function requireScope(requestedScope: ProjectionScope): void {
    if (JSON.stringify(checkedScope(requestedScope)) !== JSON.stringify(scope))
      throw new ProjectionResetError(409);
  }
  return {
    scope,
    transport,
    grant: (signal) => request("grant", parameters, signal),
  };
}

const listQueryKeys = new Set(["tab", "filter", "period", "periodTimeZone", "ownerQueue"]);

/** Accept list state only from the same module and tab as the record's return link. */
export function validRecordListRoute(value: string | null, fallback: string): string | undefined {
  if (!value || value.length > 16_384 || /[\\\s]/.test(value)) return undefined;

  const [listPath, defaultQuery] = fallback.split("?");
  const [path, query, extra] = value.split("?");
  if (path !== listPath || !query || extra !== undefined || value.includes("#")) return undefined;

  const params = new URLSearchParams(query);
  const expectedTab = new URLSearchParams(defaultQuery).get("tab");
  if (params.getAll("tab").length !== 1 || params.get("tab") !== expectedTab) return undefined;

  for (const key of params.keys()) {
    if (!listQueryKeys.has(key)) return undefined;
  }
  return `${listPath}?${params.toString()}`;
}

export function recordListRoute(value: string | null, fallback: string): string {
  return validRecordListRoute(value, fallback) ?? fallback;
}

export function recordHrefWithListRoute(href: string, returnHref?: string): string {
  if (!returnHref) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}${new URLSearchParams({ returnTo: returnHref })}`;
}

export function listRouteFromQuery(fallback: string, query: string): string {
  const params = new URLSearchParams(query);
  for (const key of new Set(params.keys())) {
    if (!listQueryKeys.has(key)) params.delete(key);
  }
  return recordListRoute(`${fallback.split("?")[0]}?${params.toString()}`, fallback);
}

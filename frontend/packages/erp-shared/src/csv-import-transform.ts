export type ColumnMappingMap = Record<string, string>

const SKIP_TARGET = "__skip__"

export function isSkippedMappingTarget(target: string | undefined): boolean {
  return !target || target === SKIP_TARGET
}

export function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function tryParseMetadata(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** Build canonical CSV text for SpacetimeDB import reducers from a column mapping. */
export function buildCanonicalCsv(
  headers: string[],
  rows: string[][],
  mapping: ColumnMappingMap,
): string {
  const headerIndex = Object.fromEntries(headers.map((header, index) => [header, index]))
  const canonicalFields = new Set<string>()

  for (const target of Object.values(mapping)) {
    if (isSkippedMappingTarget(target)) continue
    if (target.startsWith("metadata.extra.")) {
      canonicalFields.add("metadata")
    } else {
      canonicalFields.add(target.toLowerCase())
    }
  }

  const fieldList = [...canonicalFields].sort()
  const lines = [fieldList.join(",")]

  for (const row of rows) {
    const values: Record<string, string> = {}
    const metadataExtra: Record<string, string> = {}

    for (const [source, target] of Object.entries(mapping)) {
      if (isSkippedMappingTarget(target)) continue
      const index = headerIndex[source]
      const raw = index != null ? (row[index] ?? "").trim() : ""

      if (target.startsWith("metadata.extra.")) {
        const key = target.slice("metadata.extra.".length)
        if (key && raw) metadataExtra[key] = raw
        continue
      }

      if (target === "metadata") {
        values.metadata = raw
        continue
      }

      values[target.toLowerCase()] = raw
    }

    if (Object.keys(metadataExtra).length > 0) {
      const existing = tryParseMetadata(values.metadata ?? "")
      const priorExtra =
        existing.extra && typeof existing.extra === "object" && !Array.isArray(existing.extra)
          ? (existing.extra as Record<string, string>)
          : {}
      values.metadata = JSON.stringify({
        ...existing,
        extra: { ...priorExtra, ...metadataExtra },
      })
    }

    lines.push(fieldList.map((field) => escapeCsvField(values[field] ?? "")).join(","))
  }

  return lines.join("\n")
}

export const IMPORT_ASSISTANT_ENTITIES = [
  "contact",
  "lead",
  "opportunity",
  "product",
  "sale_order",
  "project_task",
] as const

export type ImportAssistantEntity = (typeof IMPORT_ASSISTANT_ENTITIES)[number]

export function isImportAssistantEntity(value: string): value is ImportAssistantEntity {
  return (IMPORT_ASSISTANT_ENTITIES as readonly string[]).includes(value)
}

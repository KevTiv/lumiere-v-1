"use client"

type AiResultPanelProps = {
  title: string
  result: Record<string, unknown>
  onDismiss: () => void
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function firstText(result: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = result[key]
    if (typeof value === "string" && value.trim() !== "") return value
  }
  return null
}

function valueText(value: unknown): string {
  if (value == null || value === "") return "—"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

function resultArrays(result: Record<string, unknown>): Array<{ label: string; rows: unknown[] }> {
  const keys = [
    "results",
    "hits",
    "insights",
    "suggestions",
    "actions",
    "drafts",
    "mappings",
    "preview_rows",
    "previewRows",
    "rows",
    "warnings",
    "errors",
  ]

  return keys
    .map((key) => ({ label: key.replace(/_/g, " "), rows: asArray(result[key]) }))
    .filter((entry) => entry.rows.length > 0)
}

function objectEntries(row: Record<string, unknown>): Array<[string, unknown]> {
  const priority = [
    "title",
    "name",
    "label",
    "content_type",
    "content_id",
    "score",
    "reducer",
    "action",
    "confidence",
    "field",
    "column",
    "target",
    "message",
    "text_snippet",
    "snippet",
    "reason",
  ]
  const entries = Object.entries(row)
  return [
    ...priority
      .filter((key) => key in row)
      .map((key) => [key, row[key]] as [string, unknown]),
    ...entries.filter(([key]) => !priority.includes(key)).slice(0, 4),
  ].slice(0, 8)
}

function ResultRow({ row }: { row: unknown }) {
  const record = asRecord(row)
  if (!record) {
    return <p className="text-sm text-muted-foreground">{valueText(row)}</p>
  }

  const headline = firstText(record, ["title", "name", "label", "message", "text_snippet", "snippet"])
  return (
    <div className="rounded-md border border-border bg-background/60 p-3">
      {headline ? <p className="mb-2 text-sm font-medium">{headline}</p> : null}
      <dl className="grid gap-2 text-xs sm:grid-cols-2">
        {objectEntries(record).map(([key, value]) => (
          <div key={key}>
            <dt className="text-muted-foreground">{key.replace(/_/g, " ")}</dt>
            <dd className="mt-0.5 break-words font-medium">{valueText(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function AiResultPanel({ title, result, onDismiss }: AiResultPanelProps) {
  const summary = firstText(result, [
    "summary",
    "explanation",
    "answer",
    "briefing",
    "content",
    "message",
    "text",
  ])
  const arrays = resultArrays(result)
  const meta = Object.entries(result).filter(
    ([key, value]) =>
      !Array.isArray(value) &&
      typeof value !== "object" &&
      !["summary", "explanation", "answer", "briefing", "content", "message", "text"].includes(key),
  )

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          {meta.length > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {meta.slice(0, 4).map(([key, value]) => `${key}: ${valueText(value)}`).join(" · ")}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>

      {summary ? (
        <div className="mb-4 rounded-md bg-muted/50 p-3 text-sm leading-6 whitespace-pre-wrap">
          {summary}
        </div>
      ) : null}

      <div className="space-y-4">
        {arrays.map((entry) => (
          <div key={entry.label}>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {entry.label}
              </p>
              <span className="text-xs text-muted-foreground">{entry.rows.length}</span>
            </div>
            <div className="space-y-2">
              {entry.rows.slice(0, 12).map((row, index) => (
                <ResultRow key={index} row={row} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {!summary && arrays.length === 0 ? (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          {Object.entries(result).map(([key, value]) => (
            <div key={key} className="rounded-md border border-border p-3">
              <dt className="text-xs text-muted-foreground">{key.replace(/_/g, " ")}</dt>
              <dd className="mt-1 break-words font-medium">{valueText(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Technical response
        </summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted/40 p-3 text-xs text-muted-foreground whitespace-pre-wrap">
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </section>
  )
}

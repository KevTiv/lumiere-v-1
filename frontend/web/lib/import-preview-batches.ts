import type { ImportPreviewResponse } from "@lumiere/query-hooks/hooks/ai-import-mapping"

export const IMPORT_PREVIEW_BATCH_SIZE = 100

type PreviewBatchInput = {
  targetEntity: string
  headers: string[]
  rows: string[][]
  mapping: Record<string, string>
}

type PreviewBatch = PreviewBatchInput & { maxRows: number }

function globalSafetyLocation(location: string, rowOffset: number): string {
  return location.replace(/\brow\[(\d+)\]/g, (_, index: string) => {
    return `row[${Number(index) + rowOffset}]`
  })
}

/** Preview every import row through the bounded API and merge results in source order. */
export async function previewAllImportRows(
  input: PreviewBatchInput,
  previewBatch: (batch: PreviewBatch) => Promise<ImportPreviewResponse>,
): Promise<ImportPreviewResponse> {
  if (input.rows.length === 0) throw new Error("The import has no data rows to preview.")

  const batches: Array<{ offset: number; rows: string[][] }> = []
  for (let offset = 0; offset < input.rows.length; offset += IMPORT_PREVIEW_BATCH_SIZE) {
    batches.push({ offset, rows: input.rows.slice(offset, offset + IMPORT_PREVIEW_BATCH_SIZE) })
  }

  const merged: ImportPreviewResponse = {
    target_entity: input.targetEntity,
    rows: [],
    validation_errors: [],
    safety: { findings: [], blocked_cell_count: 0, is_safe_for_ai: true },
    warnings: [],
  }
  const warningSet = new Set<string>()

  // Sequential requests keep gateway load bounded and make failures deterministic.
  for (const batch of batches) {
    const result = await previewBatch({
      ...input,
      rows: batch.rows,
      maxRows: batch.rows.length,
    })
    if (result.rows.length !== batch.rows.length) {
      throw new Error(
        `Preview covered ${batch.offset + result.rows.length} of ${input.rows.length} rows. Import was blocked so no unpreviewed rows are submitted.`,
      )
    }
    merged.rows.push(...result.rows)
    merged.validation_errors.push(
      ...result.validation_errors.map((item) => ({
        ...item,
        row_index: item.row_index + batch.offset,
      })),
    )
    merged.safety.findings.push(
      ...result.safety.findings.map((item) => ({
        ...item,
        location: globalSafetyLocation(item.location, batch.offset),
      })),
    )
    merged.safety.blocked_cell_count += result.safety.blocked_cell_count
    merged.safety.is_safe_for_ai =
      merged.safety.is_safe_for_ai && result.safety.is_safe_for_ai
    for (const warning of result.warnings) warningSet.add(warning)
  }

  merged.warnings = [...warningSet]
  return merged
}

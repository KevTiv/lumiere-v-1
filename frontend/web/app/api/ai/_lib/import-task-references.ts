/** Selectors only. The gateway re-reads task and workflow authority using the acting session. */
export interface RagImportTaskReference {
  taskId: string
  companyId: string
}

export function parseRagImportTaskReferences(
  raw: unknown,
  companyId: number,
): RagImportTaskReference[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.length > 4)
    throw new Error(
      "import_task_refs must contain at most 4 saved task references",
    )
  const references: RagImportTaskReference[] = []
  const seen = new Set<string>()
  for (const value of raw) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(
        "Each import task reference requires its task and company",
      )
    const { taskId, companyId: selectedCompany } = value as Record<
      string,
      unknown
    >
    if (
      typeof taskId !== "string" ||
      !/^[0-9a-f]{32}$/.test(taskId) ||
      typeof selectedCompany !== "string" ||
      selectedCompany !== String(companyId)
    ) {
      throw new Error(
        "Import task references must belong to the active company",
      )
    }
    if (!seen.has(taskId)) {
      seen.add(taskId)
      // Never forward supplied text, receipts, approvals, or claimed evidence.
      references.push({ taskId, companyId: selectedCompany })
    }
  }
  return references.length ? references : undefined
}

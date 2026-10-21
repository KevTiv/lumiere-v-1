import type { FormConfig } from "@lumiere/ui"
import { versionStatusTag } from "./workflow-enum"

export type LinkedOption = { value: string; label: string }

type RowLike = Record<string, unknown>

/** "Acme (#12)": the name keeps the option readable, the id tells same-named records apart. */
export function labelWithId(name: unknown, id: unknown): string {
  const text = String(name ?? "").trim()
  return text ? `${text} (#${String(id)})` : `#${String(id)}`
}

/** Select options for a list of records; rows without an id are skipped and options are sorted by label. */
export function recordOptions(rows: ReadonlyArray<RowLike>, labelOf: (row: RowLike) => unknown): LinkedOption[] {
  const seen = new Set<string>()
  const options: LinkedOption[] = []
  for (const row of rows) {
    if (row.id == null || String(row.id) === "") continue
    const value = String(row.id)
    if (seen.has(value)) continue
    seen.add(value)
    options.push({ value, label: labelWithId(labelOf(row), row.id) })
  }
  return options.sort((a, b) => a.label.localeCompare(b.label))
}

/** Optional pickers get a leading "None" so a chosen record can be cleared; an empty list shows a disabled hint. */
export function pickerOptions(
  linked: ReadonlyArray<LinkedOption>,
  required: boolean,
): Array<LinkedOption & { disabled?: boolean }> {
  if (linked.length === 0) return [{ value: "", label: "No records", disabled: true }]
  return required ? [...linked] : [{ value: "", label: "None" }, ...linked]
}

/**
 * Number fields that ask for a record id become searchable pickers over those records.
 * `options` is keyed by field name; fields with no entry are left untouched.
 */
export function withLinkedPickers(
  config: FormConfig,
  options: Readonly<Record<string, ReadonlyArray<LinkedOption>>>,
): FormConfig {
  return {
    ...config,
    sections: config.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => {
        const linked = field.type === "number" && Object.hasOwn(options, field.name) ? options[field.name] : undefined
        if (!linked || field.type !== "number") return field
        const { type: _type, min: _min, max: _max, step: _step, defaultValue, ...base } = field
        return {
          ...base,
          type: "select" as const,
          searchable: true,
          ...(defaultValue != null ? { defaultValue: String(defaultValue) } : {}),
          options: pickerOptions(linked, field.required === true),
        }
      }),
    })),
  }
}

/** Award-bid pickers: RFQs by name, bids by RFQ name + vendor + state so identical amounts stay distinguishable. */
export function awardBidOptions(
  rfqs: ReadonlyArray<RowLike>,
  bids: ReadonlyArray<RowLike>,
  vendorNameById: ReadonlyMap<string, string> = new Map(),
): { rfqId: LinkedOption[]; bidId: LinkedOption[] } {
  const rfqNameById = new Map(rfqs.map((row) => [String(row.id), String(row.name ?? "").trim()]))
  return {
    rfqId: recordOptions(rfqs, (row) => row.name),
    bidId: recordOptions(bids, (row) => {
      const rfqId = String(row.rfqId ?? "")
      const rfq = rfqNameById.get(rfqId) || (rfqId ? `RFQ #${rfqId}` : "")
      const vendor = vendorNameById.get(String(row.partnerId ?? "")) || (row.partnerId != null ? `Vendor #${String(row.partnerId)}` : "")
      const state = String(row.state ?? "").trim()
      return [rfq, vendor, state].filter(Boolean).join(" · ")
    }),
  }
}

/** Migration-plan pickers: workflows by name/key, versions by workflow + version number + status. */
export function workflowVersionOptions(
  workflows: ReadonlyArray<RowLike>,
  versions: ReadonlyArray<RowLike>,
): { workflowId: LinkedOption[]; versionId: LinkedOption[] } {
  const workflowLabel = (row: RowLike) => row.name ?? row.workflowKey ?? row.workflow_key ?? row.model
  const nameById = new Map(workflows.map((row) => [String(row.id), String(workflowLabel(row) ?? "").trim()]))
  return {
    workflowId: recordOptions(workflows, workflowLabel),
    versionId: recordOptions(versions, (row) => {
      const workflowId = String(row.workflowId ?? row.workflow_id ?? "")
      const workflow = nameById.get(workflowId) || (workflowId ? `Workflow #${workflowId}` : "")
      const version = row.version
      return [workflow, version != null && version !== "" ? `v${String(version)}` : "", versionStatusTag(row.status)]
        .filter(Boolean)
        .join(" · ")
    }),
  }
}

"use client"

import { useRef, useState } from "react"
import { reconciliationModules } from "./reconciliation-modules"
import { Button } from "@lumiere/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@lumiere/ui/components/dialog"

const labels = {
  review_candidate: "Ready for review",
  quantity_reconciliation_required: "Quantities need reconciliation",
  ambiguous: "Multiple possible matches",
  existing_link_conflict: "Existing link conflicts",
  missing_evidence: "Missing evidence",
  unmatched: "No match",
} as const

type Status = keyof typeof labels
type RecordRef = { kind: string; id: number; revision: number }
type Proposal = { key: string; rule: string; source: RecordRef; targets: RecordRef[]; matchedFields: string[]; status: Status }
type Feedback = { action: "unresolved" | "needs evidence" | "preferred match"; targetId?: number }

type PreviewObject = {
  organization_id?: unknown
  company_id?: unknown
  proposals?: unknown
  kind?: unknown
  id?: unknown
  revision?: unknown
  proposal_key?: unknown
  rule?: unknown
  status?: unknown
  source?: unknown
  targets?: unknown
  matched_fields?: unknown
}

function object(value: unknown): PreviewObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error()
  return value as PreviewObject
}

function recordRef(value: unknown): RecordRef {
  const { kind, id, revision } = object(value)
  if (typeof kind !== "string" || !/^[a-z_]{1,80}$/.test(kind)
    || typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0
    || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision <= 0) {
    throw new Error()
  }
  return { kind, id, revision }
}

function parsePreview(value: unknown, organizationId: number, companyId: number): Proposal[] {
  const bundle = object(value)
  if (bundle.organization_id !== organizationId || bundle.company_id !== companyId) {
    throw new Error("Choose a preview for the current company.")
  }
  if (!Array.isArray(bundle.proposals) || bundle.proposals.length > 5000) throw new Error()
  const keys = new Set<string>()
  return bundle.proposals.map((value: unknown) => {
    const row = object(value)
    const { proposal_key: key, rule, status } = row
    if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key) || keys.has(key)
      || typeof rule !== "string" || !/^[a-z_]{1,80}$/.test(rule)
      || typeof status !== "string" || !Object.hasOwn(labels, status)
      || !Array.isArray(row.targets) || row.targets.length > 100) throw new Error()
    if (!Array.isArray(row.matched_fields) || row.matched_fields.length > 16
      || !row.matched_fields.every((field: unknown) => typeof field === "string" && /^[a-z_]{1,80}$/.test(field))) throw new Error()
    keys.add(key)
    const targets = row.targets.map(recordRef)
    if (new Set(targets.map(target => target.id)).size !== targets.length) throw new Error()
    return { key, rule, status: status as Status, source: recordRef(row.source), targets, matchedFields: row.matched_fields as string[] }
  })
}

/** Mounted with the chat scope as its key, so changing company or conversation discards the preview. */
export function ChatReconciliationPreview({ organizationId, companyId }: {
  organizationId: number
  companyId: number
}) {
  const [open, setOpen] = useState(false)
  const [proposals, setProposals] = useState<Proposal[] | null>(null)
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({})
  const [filter, setFilter] = useState<Status | "all">("all")
  const [moduleId, setModuleId] = useState<string>("all")
  const [page, setPage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const importVersion = useRef(0)

  async function load(file: File) {
    const version = ++importVersion.current
    setError(null)
    try {
      if (file.size > 5_000_000) throw new Error("Preview files must be under 5 MB.")
      const next = parsePreview(JSON.parse(await file.text()), organizationId, companyId)
      if (version !== importVersion.current) return
      setProposals(next)
      setFeedback({})
      setFilter("all")
      setModuleId("all")
      setPage(0)
    } catch (cause) {
      if (version !== importVersion.current) return
      setError(cause instanceof Error && cause.message.startsWith("Choose a preview")
        ? cause.message
        : "Could not read this reconciliation preview. Choose a valid export under 5 MB.")
    }
  }

  const selectedModule = reconciliationModules.find(module => module.id === moduleId)
  const moduleProposals = (proposals ?? []).filter(item => !selectedModule || selectedModule.rules.includes(item.rule))
  const filtered = moduleProposals.filter(item => filter === "all" || item.status === filter)
  const visible = filtered.slice(page * 20, (page + 1) * 20)
  const feedbackCount = Object.keys(feedback).length

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        {proposals ? "Resume reconciliation preview" : "Open reconciliation preview"}
      </Button>
      {proposals ? <p className="text-xs text-muted-foreground">
        {proposals.length} proposals · {feedbackCount} marked for follow-up or matched
      </p> : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogTitle>Review reconciliation preview</DialogTitle>
          <DialogDescription>
            Company #{companyId}. Load a prepared proposal export and review its matches.
            Your selections are temporary and do not update ERP records.
          </DialogDescription>
          <label className="space-y-1 text-sm">
            <span className="block">Proposal export</span>
            <input type="file" accept=".json,application/json" onChange={event => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ""
              if (file) void load(file)
            }} />
          </label>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <div className="space-y-2">
            <p className="text-sm font-medium">Alpha modules</p>
            <div className="flex flex-wrap gap-2" aria-label="Filter by Alpha module">
              <Button size="sm" variant="outline" aria-pressed={moduleId === "all"}
                onClick={() => { setModuleId("all"); setFilter("all"); setPage(0) }}>All modules</Button>
              {reconciliationModules.map(module => (
                <Button key={module.id} size="sm" variant="outline" aria-pressed={moduleId === module.id}
                  onClick={() => { setModuleId(module.id); setFilter("all"); setPage(0) }}>
                  {module.label}
                </Button>
              ))}
            </div>
            {selectedModule ? <p className="text-sm text-muted-foreground">{selectedModule.role}</p> : null}
          </div>
          {proposals && (!selectedModule || selectedModule.rules.length > 0) ? (
            <>
              <div className="flex flex-wrap gap-2" aria-label="Filter proposals">
                <Button size="sm" variant="outline" aria-pressed={filter === "all"}
                  onClick={() => { setFilter("all"); setPage(0) }}>All ({moduleProposals.length})</Button>
                {(Object.keys(labels) as Status[]).map(status => {
                  const count = moduleProposals.filter(item => item.status === status).length
                  return count > 0 ? <Button key={status} size="sm" variant="outline"
                    aria-pressed={filter === status} onClick={() => { setFilter(status); setPage(0) }}>
                    {labels[status]} ({count})
                  </Button> : null
                })}
              </div>
              {visible.length === 0 ? <p>No proposals in this view.</p> : null}
              <ul className="space-y-3">
                {visible.map(item => (
                  <li key={item.key} className="space-y-2 rounded-lg border p-3 text-sm">
                    <p className="font-medium">{item.rule.replaceAll("_", " ")}</p>
                    <p>{labels[item.status]}</p>
                    {item.matchedFields.length ? <p>Matching fields: {item.matchedFields.join(", ")}</p> : null}
                    <p>Source: {item.source.kind} #{item.source.id} · revision {item.source.revision}</p>
                    {item.targets.map(target => (
                      <div key={target.id} className="flex flex-wrap items-center gap-2">
                        <span>Candidate: {target.kind} #{target.id} · revision {target.revision}</span>
                        {item.status === "ambiguous" ? <Button size="sm" variant="outline"
                          onClick={() => setFeedback(previous => ({
                            ...previous, [item.key]: { action: "preferred match", targetId: target.id },
                          }))}>Prefer match #{target.id}</Button> : null}
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setFeedback(previous => ({
                        ...previous, [item.key]: { action: "unresolved" },
                      }))}>Leave unresolved</Button>
                      <Button size="sm" variant="outline" onClick={() => setFeedback(previous => ({
                        ...previous, [item.key]: { action: "needs evidence" },
                      }))}>Mark as needing evidence</Button>
                    </div>
                    {feedback[item.key] ? <p role="status">
                      Preview feedback: {feedback[item.key].action}
                      {feedback[item.key].targetId ? ` #${feedback[item.key].targetId}` : ""}
                    </p> : null}
                  </li>
                ))}
              </ul>
              {filtered.length > 20 ? <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0}
                  onClick={() => setPage(page - 1)}>Previous</Button>
                <Button size="sm" variant="outline" disabled={(page + 1) * 20 >= filtered.length}
                  onClick={() => setPage(page + 1)}>Next</Button>
              </div> : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

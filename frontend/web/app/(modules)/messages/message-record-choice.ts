import { parseStrictU64 } from "@lumiere/erp-shared/u64"

type Row = Record<string, unknown>
export interface MessageRecordChoice {
  value: string
  label: string
  model: "account_move" | "contact"
  resId: string
}
export interface MessageRecordLabels {
  invoice: string
  bill: string
  creditNote: string
  vendorCredit: string
  journalEntry: string
  accountingDocument: string
  contact: string
}
function field(row: Row, camel: string, snake = camel): unknown {
  const raw = row[camel] ?? row[snake]
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if (Object.hasOwn(raw, "some")) return (raw as { some: unknown }).some
    if (Object.hasOwn(raw, "none")) return undefined
  }
  return raw
}
function exactId(raw: unknown): string | undefined {
  const id = parseStrictU64(raw)
  return id !== undefined && id > 0n ? id.toString() : undefined
}
function firstText(...values: unknown[]): string {
  return values.filter((value) => typeof value === "string").map((value) => String(value).trim()).find((value) => value !== "" && value !== "/") ?? ""
}
function tag(raw: unknown): string {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if ("tag" in raw) return String(raw.tag).toLowerCase()
    return (Object.keys(raw)[0] ?? "").toLowerCase()
  }
  return String(raw ?? "").toLowerCase()
}

/** Named choices use only the caller's existing authorized query rows and exact scope. */
export function messageRecordChoices(moves: readonly Row[], contacts: readonly Row[], scope: { organizationId: unknown; companyId: unknown }, labels: MessageRecordLabels): MessageRecordChoice[] {
  const organizationId = exactId(scope.organizationId), companyId = exactId(scope.companyId)
  if (!organizationId) return []
  const scopedContacts = contacts.filter((row) => {
    if (exactId(field(row, "organizationId", "organization_id")) !== organizationId) return false
    const companyKey = Object.hasOwn(row, "companyId") ? "companyId" : Object.hasOwn(row, "company_id") ? "company_id" : undefined
    if (!companyKey) return false
    const rawOwner = row[companyKey]
    const shared = rawOwner === null || (rawOwner !== null && typeof rawOwner === "object" && !Array.isArray(rawOwner) && Object.hasOwn(rawOwner, "none"))
    return shared || (companyId !== undefined && exactId(field(row, companyKey)) === companyId)
  })
  const contactNames = new Map(scopedContacts.flatMap((row) => {
    const id = exactId(row.id), name = firstText(field(row, "displayName", "display_name"), row.name, field(row, "email"))
    return id && name ? [[id, name] as const] : []
  }))
  const kinds: Record<string, string> = { outinvoice: labels.invoice, ininvoice: labels.bill, outrefund: labels.creditNote, inrefund: labels.vendorCredit, entry: labels.journalEntry }
  const choices: MessageRecordChoice[] = []
  for (const row of moves) {
    const resId = exactId(row.id)
    if (!resId || !companyId || exactId(field(row, "organizationId", "organization_id")) !== organizationId || exactId(field(row, "companyId", "company_id")) !== companyId) continue
    const kind = kinds[tag(field(row, "moveType", "move_type"))] ?? labels.accountingDocument
    const name = firstText(row.name, field(row, "ref", "ref_"), field(row, "invoiceOrigin", "invoice_origin"))
    const partner = contactNames.get(exactId(field(row, "partnerId", "partner_id")) ?? "")
    choices.push({ value: `account_move:${resId}`, model: "account_move", resId, label: [kind, name, partner, `#${resId}`].filter(Boolean).join(" · ") })
  }
  for (const row of scopedContacts) {
    const resId = exactId(row.id), name = contactNames.get(resId ?? "")
    if (resId && name) choices.push({ value: `contact:${resId}`, model: "contact", resId, label: `${labels.contact} · ${name} · #${resId}` })
  }
  // Ambiguous duplicate identities are not made selectable by choosing an arbitrary row.
  const counts = new Map<string, number>()
  for (const choice of choices) counts.set(choice.value, (counts.get(choice.value) ?? 0) + 1)
  return choices.filter((choice) => counts.get(choice.value) === 1).sort((a, b) => a.label.localeCompare(b.label))
}

/** Resolve a named selection against current choices; custom references retain the existing wire keys. */
export function resolveMessageRecordChoice(values: Row, choices: readonly MessageRecordChoice[]): { model: string; resId: bigint } | null {
  if (values.recordLinkMode === "record") {
    const matches = choices.filter((choice) => choice.value === values.recordReference)
    if (matches.length !== 1) return null
    const choice = matches[0]!, resId = parseStrictU64(choice.resId)
    return resId && ["account_move", "contact"].includes(choice.model) ? { model: choice.model, resId } : null
  }
  if (values.recordLinkMode != null && values.recordLinkMode !== "custom") return null
  const resId = parseStrictU64(values.resId)
  if (!resId || resId <= 0n) return null
  // Older configured forms omit recordLinkMode; keep their existing model fallback.
  const model = typeof values.model === "string" && values.model ? values.model : "mail.message"
  return { model, resId }
}

import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { messageFailureReason, messageProviderEvidence, type BatchEvidenceRow, type ProviderEvidenceRow } from "../messages/message-batch-review"

export type InboxRow = Record<string, unknown> & BatchEvidenceRow & ProviderEvidenceRow
type Row = InboxRow
type Scope = { organizationId: bigint; companyId: bigint; contactId: bigint }

export function crmInboxRowInScope(row: Row, { organizationId, companyId }: Scope) {
  return organizationId > 0n && companyId > 0n
    && parseStrictU64(row.organizationId ?? row.organization_id) === organizationId
    && parseStrictU64(row.companyId ?? row.company_id) === companyId
}

function isWhatsApp(value: unknown) {
  return value === "WhatsApp" || (value != null && typeof value === "object" && "tag" in value && value.tag === "WhatsApp")
}

export function crmWhatsAppConversation(row: Row, scope: Scope) {
  return scope.contactId > 0n && crmInboxRowInScope(row, scope) && isWhatsApp(row.channel)
    && parseStrictU64(row.contactId ?? row.contact_id) === scope.contactId
}

function isAbsent(value: unknown) {
  return value == null || (typeof value === "object" && Object.keys(value).length === 1 && "none" in value)
}

export type InboxDelivery =
  | { status: "draft" | "queued" | "inconclusive" }
  | { status: "accepted" | "delivered"; providerMessageId: string }
  | { status: "failed"; providerMessageId: string; reason: string | null }

export function crmInboxDelivery(
  message: Row,
  conversation: Row,
  providerRows: readonly Row[],
  operationalRows: readonly Row[],
  scope: Scope,
): InboxDelivery {
  const inconclusive: InboxDelivery = { status: "inconclusive" }
  const conversationId = parseStrictU64(conversation.id)
  const messageId = parseStrictU64(message.id)
  if (!conversationId || !messageId || !crmWhatsAppConversation(conversation, scope)
    || !crmInboxRowInScope(message, scope) || message.direction !== "outbound"
    || parseStrictU64(message.conversationId ?? message.conversation_id) !== conversationId) return inconclusive

  const rawOperationalId = message.operationalMessageId ?? message.operational_message_id
  const operationalId = parseStrictU64(rawOperationalId)
  if (!operationalId) {
    const providerId = message.providerMessageId ?? message.provider_message_id
    if (isAbsent(rawOperationalId) && isAbsent(providerId) && (message.status === "queued" || message.status === "draft")) return { status: message.status }
    return inconclusive
  }

  const phoneId = parseStrictU64(conversation.phoneIdentityId ?? conversation.phone_identity_id)
  const operational = operationalRows.filter((row) =>
    crmInboxRowInScope(row, scope) && parseStrictU64(row.id) === operationalId,
  )
  if (!phoneId || operational.length !== 1) return inconclusive
  const saved = operational[0]!
  if (parseStrictU64(saved.contactId ?? saved.contact_id) !== scope.contactId
    || parseStrictU64(saved.phoneIdentityId ?? saved.phone_identity_id) !== phoneId
    || !isWhatsApp(saved.channel)) return inconclusive

  const matching = providerRows.filter((row) => crmInboxRowInScope(row, scope) && row.direction === "outbound"
    && parseStrictU64(row.operationalMessageId ?? row.operational_message_id) === operationalId,
  )
  if (matching.length !== 1 || parseStrictU64(matching[0]!.id) !== messageId
    || parseStrictU64(matching[0]!.conversationId ?? matching[0]!.conversation_id) !== conversationId) return inconclusive

  const evidence = messageProviderEvidence(saved, matching, scope.organizationId, scope.companyId)
  if (!evidence) return inconclusive
  const displayed = messageProviderEvidence(saved, [message], scope.organizationId, scope.companyId)
  if (displayed?.providerMessageId !== evidence.providerMessageId || displayed.status !== evidence.status) return inconclusive
  return evidence.status === "failed" ? { ...evidence, status: "failed", reason: messageFailureReason(saved) } : { ...evidence, status: evidence.status }
}

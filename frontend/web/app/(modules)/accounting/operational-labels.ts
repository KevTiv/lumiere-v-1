import { i18n } from "@lumiere/i18n"

const labelKeys = {
  Draft: "accounting.operationalLabels.Draft",
  Posted: "accounting.operationalLabels.Posted",
  Reversed: "accounting.operationalLabels.Reversed",
  Voided: "accounting.operationalLabels.Voided",
  Inbound: "accounting.operationalLabels.Inbound",
  Outbound: "accounting.operationalLabels.Outbound",
  Cash: "accounting.operationalLabels.Cash",
  Bank: "accounting.operationalLabels.Bank",
  Other: "accounting.operationalLabels.Other",
  Sms: "accounting.operationalLabels.Sms",
  WhatsApp: "accounting.operationalLabels.WhatsApp",
  Email: "accounting.operationalLabels.Email",
  InApp: "accounting.operationalLabels.InApp",
  Copied: "accounting.operationalLabels.Copied",
  Queued: "accounting.operationalLabels.Queued",
  Sent: "accounting.operationalLabels.Sent",
  Delivered: "accounting.operationalLabels.Delivered",
  Failed: "accounting.operationalLabels.Failed",
  Cancelled: "accounting.operationalLabels.Cancelled",
  PendingApproval: "accounting.operationalLabels.PendingApproval",
  Approved: "accounting.operationalLabels.Approved",
  Rejected: "accounting.operationalLabels.Rejected",
  Partial: "accounting.operationalLabels.Partial",
  Completed: "accounting.operationalLabels.Completed",
  staged: "accounting.operationalLabels.staged",
  approved: "accounting.operationalLabels.approved",
  failed: "accounting.operationalLabels.failed",
  rejected: "accounting.operationalLabels.rejected",
} as const

/** Translate known operational enums at display time. Unknown provider names stay intact. */
export function operationalLabel(value: string): string {
  return Object.hasOwn(labelKeys, value) ? i18n.t(labelKeys[value as keyof typeof labelKeys]) : value
}

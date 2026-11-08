import type { TFunction } from "i18next"
import type { AccountMove } from "../lib/accounting-types"
import { stbEnumTag } from "../lib/accounting-move-utils"
import {
  formatEntityReference,
  unwrapEntityValue,
} from "../lib/entity-row-values"

export function accountingMovePartner(
  move: Pick<AccountMove, "partnerId" | "invoicePartnerDisplayName">,
  t: TFunction,
  labels?: ReadonlyMap<string, string>,
): string {
  return formatEntityReference(move.partnerId, {
    label: move.invoicePartnerDisplayName,
    labels,
    formatId: (id) =>
      t("accounting.journalEntries.partnerId", {
        defaultValue: "Partner #{{id}}",
        id,
      }),
  })
}

export function accountingMoveState(value: unknown, t: TFunction) {
  switch (stbEnumTag(value)) {
    case "Draft":
      return {
        label: t("accounting.states.draft"),
        variant: "secondary",
      } as const
    case "Posted":
      return {
        label: t("accounting.states.posted"),
        variant: "default",
      } as const
    case "Cancelled":
      return {
        label: t("accounting.states.cancelled"),
        variant: "destructive",
      } as const
    default:
      return {
        label: t("accounting.journalEntries.statusUnavailable", {
          defaultValue: "Status unavailable",
        }),
        variant: "outline",
      } as const
  }
}

export function accountingMoveType(value: unknown, t: TFunction): string {
  switch (stbEnumTag(value)) {
    case "Entry":
      return t("accounting.journalEntries.types.entry")
    case "OutInvoice":
      return t("accounting.journalEntries.types.outInvoice")
    case "InInvoice":
      return t("accounting.journalEntries.types.inInvoice")
    case "OutRefund":
      return t("accounting.journalEntries.types.outRefund")
    case "InRefund":
      return t("accounting.journalEntries.types.inRefund")
    case "InternalTransfer":
      return t("accounting.journalEntries.types.internalTransfer", {
        defaultValue: "Internal transfer",
      })
    default:
      return "—"
  }
}

export function accountingMovePayment(value: unknown, t: TFunction): string {
  switch (stbEnumTag(value)) {
    case "NotPaid":
      return t("accounting.invoices.paymentStates.notPaid", {
        defaultValue: "Not paid",
      })
    case "Paid":
      return t("accounting.invoices.paymentStates.paid", {
        defaultValue: "Paid",
      })
    case "Partial":
      return t("accounting.invoices.paymentStates.partial", {
        defaultValue: "Partial",
      })
    case "Reversed":
      return t("accounting.invoices.paymentStates.reversed", {
        defaultValue: "Reversed",
      })
    case "InPayment":
      return t("accounting.invoices.paymentStates.inPayment", {
        defaultValue: "In payment",
      })
    case "InvoicingLegacy":
      return t("accounting.invoices.paymentStates.invoicingLegacy", {
        defaultValue: "Legacy invoicing",
      })
    default:
      return unwrapEntityValue(value) == null
        ? "—"
        : t("accounting.journalEntries.statusUnavailable", {
            defaultValue: "Status unavailable",
          })
  }
}

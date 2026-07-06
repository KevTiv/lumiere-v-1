import { contactPrimaryLabel } from "@lumiere/stdb/read-models"
import {
  purchaseOrderPrimaryLabel,
  saleOrderPrimaryLabel,
} from "@lumiere/stdb/read-models"

export type ChatterTarget = {
  resModel: string
  resId: bigint
  recordTitle: string
}

const MODULE_TAB_RES_MODEL: Record<string, Record<string, string>> = {
  crm: {
    leads: "lead",
    opportunities: "opportunity",
    contacts: "contact",
    activities: "activity",
  },
  sales: {
    orders: "sale_order",
  },
  purchasing: {
    orders: "purchase_order",
  },
  accounting: {
    "journal-entries": "account_move",
    invoices: "account_move",
    bills: "account_move",
    payments: "account_payment",
  },
}

export function rowIdBigInt(row: Record<string, unknown>): bigint {
  const r = row.id ?? row.Id
  if (typeof r === "bigint") return r
  if (typeof r === "number" && Number.isFinite(r)) return BigInt(Math.trunc(r))
  if (typeof r === "string" && r.trim() !== "") return BigInt(r)
  if (typeof r === "object" && r !== null && !Array.isArray(r)) {
    const obj = r as Record<string, unknown>
    if ("some" in obj) {
      const inner = obj.some
      if (typeof inner === "bigint") return inner
      if (typeof inner === "number" && Number.isFinite(inner)) return BigInt(Math.trunc(inner))
      if (typeof inner === "string" && inner.trim() !== "") return BigInt(inner)
    }
  }
  return BigInt(String(r ?? 0))
}

export function moduleTabToResModel(moduleId: string, tabId: string): string | null {
  return MODULE_TAB_RES_MODEL[moduleId]?.[tabId] ?? null
}

function accountMovePrimaryLabel(row: Record<string, unknown>): string {
  const candidates = [row.name, row.ref, row.number, row.invoiceNumber, row.invoice_number]
  for (const c of candidates) {
    const t = String(c ?? "").trim()
    if (t.length > 0) return t
  }
  const id = String(row.id ?? "")
  return id ? `Entry #${id}` : "Journal entry"
}

function accountPaymentPrimaryLabel(row: Record<string, unknown>): string {
  const candidates = [row.name, row.ref, row.paymentReference, row.payment_reference]
  for (const c of candidates) {
    const t = String(c ?? "").trim()
    if (t.length > 0) return t
  }
  const id = String(row.id ?? "")
  return id ? `Payment #${id}` : "Payment"
}

export function rowChatterLabel(
  moduleId: string,
  tabId: string,
  row: Record<string, unknown>,
): string {
  if (moduleId === "crm") {
    const id = String(row.id ?? "")
    if (tabId === "activities") {
      const s = String(row.summary ?? row.name ?? "").trim()
      return s || `Activity #${id}`
    }
    if (tabId === "leads") {
      const s = String(
        row.contactName ?? row.contact_name ?? row.name ?? row.emailFrom ?? row.email_from ?? "",
      ).trim()
      return s || `Lead #${id}`
    }
    if (tabId === "opportunities") {
      const s = String(row.name ?? "").trim()
      return s || `Opportunity #${id}`
    }
    if (tabId === "contacts") {
      const label = contactPrimaryLabel(row).trim()
      return label || `Contact #${id}`
    }
  }

  if (moduleId === "sales" && tabId === "orders") {
    const label = saleOrderPrimaryLabel(row).trim()
    return label || `Order #${String(row.id ?? "")}`
  }

  if (moduleId === "purchasing" && tabId === "orders") {
    const label = purchaseOrderPrimaryLabel(row).trim()
    return label || `PO #${String(row.id ?? "")}`
  }

  if (moduleId === "accounting") {
    if (tabId === "payments") {
      return accountPaymentPrimaryLabel(row)
    }
    if (tabId === "journal-entries" || tabId === "invoices" || tabId === "bills") {
      return accountMovePrimaryLabel(row)
    }
  }

  const id = String(row.id ?? "")
  return id ? `Record #${id}` : "Record"
}

export function chatterTargetFromRow(
  moduleId: string,
  tabId: string,
  row: Record<string, unknown>,
): ChatterTarget | null {
  const resModel = moduleTabToResModel(moduleId, tabId)
  if (!resModel) return null
  return {
    resModel,
    resId: rowIdBigInt(row),
    recordTitle: rowChatterLabel(moduleId, tabId, row),
  }
}

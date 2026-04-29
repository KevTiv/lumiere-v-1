import { Suspense } from "react"
import { getStdbSession } from "@/lib/api-session"
import {
  serverQueryAccountJournals,
  serverQueryPurchaseOrders,
  serverQueryPurchaseOrderLines,
  serverQueryPurchaseRequisitions,
  serverQueryContacts,
  serverQueryPricelists,
  serverQueryProducts,
  serverQueryUoms,
  serverQueryPartnerBanks,
  serverQueryDepartments,
} from "@lumiere/stdb/server"
import { PurchasingClient } from "./purchasing-client"

/** Match {@link orgBigInts}: default company id equals organization id in web. */
function purchaseBillIdsFromJournals(
  journals: Record<string, unknown>[],
  organizationId: number,
): { purchaseBillJournalId?: string; purchaseBillExpenseAccountId?: string } {
  const companyKey = String(organizationId)
  const forCompany = journals.filter((j) => String(j.companyId ?? j.company_id) === companyKey)
  const purchase = forCompany.find((j) => {
    const t = j.type_
    if (t != null && typeof t === "object" && "tag" in t) {
      return String((t as { tag: string }).tag) === "Purchase"
    }
    return false
  })
  if (!purchase) return {}
  const active = purchase.active !== false
  if (!active) return {}
  const jid = purchase.id
  const expenseId = purchase.defaultAccountId ?? purchase.default_account_id
  if (jid == null || expenseId == null) return {}
  return {
    purchaseBillJournalId: String(jid),
    purchaseBillExpenseAccountId: String(expenseId),
  }
}

export default async function PurchasingPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <Suspense><PurchasingClient /></Suspense>
  }
  const { organizationId, opts } = session

  const [orders, lines, requisitions, contacts, pricelists, products, uoms, partnerBanks, departments] =
    await Promise.all([
      serverQueryPurchaseOrders(organizationId, opts),
      serverQueryPurchaseOrderLines(organizationId, opts),
      serverQueryPurchaseRequisitions(organizationId, opts),
      serverQueryContacts(organizationId, opts),
      serverQueryPricelists(organizationId, opts),
      serverQueryProducts(organizationId, opts),
      serverQueryUoms(organizationId, opts),
      serverQueryPartnerBanks(organizationId, opts),
      serverQueryDepartments(organizationId, opts),
    ]).catch(() => [[], [], [], [], [], [], [], [], []])

  const journals = (await serverQueryAccountJournals(organizationId, opts).catch(() => [])) as Record<
    string,
    unknown
  >[]
  const billIds = purchaseBillIdsFromJournals(journals, organizationId)

  return (
    <Suspense>
      <PurchasingClient
        initialOrders={orders as Record<string, unknown>[]}
        initialLines={lines as Record<string, unknown>[]}
        initialRequisitions={requisitions as Record<string, unknown>[]}
        initialContacts={contacts as Record<string, unknown>[]}
        initialPricelists={pricelists as Record<string, unknown>[]}
        initialProducts={products as Record<string, unknown>[]}
        initialUoms={uoms as Record<string, unknown>[]}
        initialPartnerBanks={partnerBanks as Record<string, unknown>[]}
        initialDepartments={departments as Record<string, unknown>[]}
        organizationId={organizationId}
        purchaseBillJournalId={billIds.purchaseBillJournalId}
        purchaseBillExpenseAccountId={billIds.purchaseBillExpenseAccountId}
      />
    </Suspense>
  )
}

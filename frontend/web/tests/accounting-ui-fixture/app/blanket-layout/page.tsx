"use client"

import { I18nProvider } from "@lumiere/i18n"
import { PurchasingBlanketWorkspace } from "../../../../app/(modules)/purchasing/purchasing-blanket-workspace"

const blanketOrders = [
  { id: 1, name: "Standard agreement", state: "draft" },
  { id: 2, name: "Replacement agreement", state: "draft" },
]
const blanketLines = [
  { id: 3, blanketOrderId: 2, productId: 4, productUom: 5, committedQuantity: 10, releasedQuantity: 2, priceUnit: 5 },
]
const products = [{ id: 4, name: "Replacement part", purchaseOk: true, uomPoId: 5 }]
const uoms = [{ id: 5, name: "Units", categoryId: 6 }]

export default function Page() {
  return (
    <I18nProvider language="en">
      <main className="mx-auto w-full max-w-7xl p-4" data-testid="blanket-layout-fixture">
        <PurchasingBlanketWorkspace
          blanketOrders={blanketOrders}
          blanketLines={blanketLines}
          blanketReleases={[]}
          vendors={[]}
          products={products}
          uoms={uoms}
          currencies={[]}
          createBlanket={async () => { throw new Error("Fixture does not create records") }}
          releaseBlanket={async () => { throw new Error("Fixture does not release records") }}
          onOpenPurchaseOrder={() => {}}
        />
      </main>
    </I18nProvider>
  )
}

import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsAllowEmpty } from "@/lib/server-query"
import { SalesClient } from "./sales-client"

const SSR_RESOURCES = [
  "sale-orders",
  "sale-order-lines",
  "pricelists",
  "pricelist-items",
  "picking-batches",
  "delivery-carriers",
  "delivery-price-rules",
  "shipping-methods",
  "pos-payment-methods",
  "pos-loyalty-programs",
  "pos-loyalty-cards",
  "contacts",
  "warehouses",
  "account-moves",
  "stock-pickings",
  "return-orders",
  "return-order-lines",
] as const

export default async function SalesPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <SalesClient />
  }

  const [
    orders,
    orderLines,
    pricelists,
    pricelistItems,
    deliveries,
    deliveryCarriers,
    deliveryPriceRules,
    shippingMethods,
    posPaymentMethods,
    loyaltyPrograms,
    loyaltyCards,
    contacts,
    warehouses,
    accountMoves,
    stockPickings,
    returnOrders,
    returnOrderLines,
  ] = await serverFetchQueryListsAllowEmpty(session, SSR_RESOURCES)

  return (
    <SalesClient
      initialOrders={orders}
      initialOrderLines={orderLines}
      initialPricelists={pricelists}
      initialPricelistItems={pricelistItems}
      initialDeliveries={deliveries}
      initialDeliveryCarriers={deliveryCarriers}
      initialDeliveryPriceRules={deliveryPriceRules}
      initialShippingMethods={shippingMethods}
      initialPosPaymentMethods={posPaymentMethods}
      initialLoyaltyPrograms={loyaltyPrograms}
      initialLoyaltyCards={loyaltyCards}
      initialContacts={contacts}
      initialWarehouses={warehouses}
      initialAccountMoves={accountMoves}
      initialStockPickings={stockPickings}
      initialReturnOrders={returnOrders}
      initialReturnOrderLines={returnOrderLines}
      organizationId={session.organizationId}
    />
  )
}

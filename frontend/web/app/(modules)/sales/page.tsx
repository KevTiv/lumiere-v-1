import { getStdbSession } from "@/lib/api-session"
import {
  serverQuerySaleOrders,
  serverQuerySaleOrderLines,
  serverQueryPricelists,
  serverQueryPricelistItems,
  serverQueryPickingBatches,
  serverQueryDeliveryCarriers,
  serverQueryDeliveryPriceRules,
  serverQueryShippingMethods,
  serverQueryPosPaymentMethods,
  serverQueryPosLoyaltyPrograms,
  serverQueryPosLoyaltyCards,
  serverQueryContacts,
  serverQueryWarehouses,
  serverQueryAccountMoves,
  serverQueryStockPickings,
} from "@lumiere/stdb/server"
import { SalesClient } from "./sales-client"

export default async function SalesPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <SalesClient />
  }
  const { organizationId, opts } = session

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
  ] = await Promise.all([
    serverQuerySaleOrders(organizationId, opts),
    serverQuerySaleOrderLines(organizationId, opts),
    serverQueryPricelists(organizationId, opts),
    serverQueryPricelistItems(organizationId, opts),
    serverQueryPickingBatches(organizationId, opts),
    serverQueryDeliveryCarriers(organizationId, opts),
    serverQueryDeliveryPriceRules(organizationId, opts),
    serverQueryShippingMethods(organizationId, opts),
    serverQueryPosPaymentMethods(organizationId, opts),
    serverQueryPosLoyaltyPrograms(organizationId, opts),
    serverQueryPosLoyaltyCards(organizationId, opts),
    serverQueryContacts(organizationId, opts),
    serverQueryWarehouses(organizationId, opts),
    serverQueryAccountMoves(organizationId, undefined, opts),
    serverQueryStockPickings(organizationId, opts),
  ]).catch(() => [[], [], [], [], [], [], [], [], [], [], [], [], [], [], []])

  return (
    <SalesClient
      initialOrders={orders as Record<string, unknown>[]}
      initialOrderLines={orderLines as Record<string, unknown>[]}
      initialPricelists={pricelists as Record<string, unknown>[]}
      initialPricelistItems={pricelistItems as Record<string, unknown>[]}
      initialDeliveries={deliveries as Record<string, unknown>[]}
      initialDeliveryCarriers={deliveryCarriers as Record<string, unknown>[]}
      initialDeliveryPriceRules={deliveryPriceRules as Record<string, unknown>[]}
      initialShippingMethods={shippingMethods as Record<string, unknown>[]}
      initialPosPaymentMethods={posPaymentMethods as Record<string, unknown>[]}
      initialLoyaltyPrograms={loyaltyPrograms as Record<string, unknown>[]}
      initialLoyaltyCards={loyaltyCards as Record<string, unknown>[]}
      initialContacts={contacts as Record<string, unknown>[]}
      initialWarehouses={warehouses as Record<string, unknown>[]}
      initialAccountMoves={accountMoves as Record<string, unknown>[]}
      initialStockPickings={stockPickings as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}

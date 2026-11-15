import { getStdbSession } from "@/lib/api-session";
import { serverPrefetchQueryLists } from "@/lib/server-query";
import { InventoryClient } from "../inventory/inventory-client";

export default async function WarehousePage() {
  const session = await getStdbSession();
  if (!session?.organizationId) return <InventoryClient workspace="warehouse" />;

  const [products, uoms] = await serverPrefetchQueryLists(session, ["products", "uoms"] as const);
  return (
    <InventoryClient
      workspace="warehouse"
      organizationId={session.organizationId}
      initialProducts={products}
      initialUoms={uoms}
    />
  );
}

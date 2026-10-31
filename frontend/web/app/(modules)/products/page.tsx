import { getStdbSession } from "@/lib/api-session";
import { serverPrefetchQueryLists } from "@/lib/server-query";
import { InventoryClient } from "../inventory/inventory-client";

const CATALOG_RESOURCES = ["products", "product-categories", "uoms"] as const;

/** Product masters keep the same command owners as their Inventory entry point. */
export default async function ProductsPage() {
  const session = await getStdbSession();
  if (!session?.organizationId) return <InventoryClient workspace="products" />;

  const [products, productCategories, uoms] = await serverPrefetchQueryLists(
    session,
    CATALOG_RESOURCES,
  );
  return (
    <InventoryClient
      workspace="products"
      initialProducts={products}
      initialProductCategories={productCategories}
      initialUoms={uoms}
      organizationId={session.organizationId}
    />
  );
}

import { getStdbSession } from "@/lib/api-session";
import { serverPrefetchQueryLists } from "@/lib/server-query";
import { ProductsClient } from "./products-client";

const CATALOG_RESOURCES = ["products", "uoms"] as const;

/** Product masters keep the same command owners as their Inventory entry point. */
export default async function ProductsPage() {
  const session = await getStdbSession();
  if (!session?.organizationId) return <ProductsClient />;

  const [products, uoms] = await serverPrefetchQueryLists(
    session,
    CATALOG_RESOURCES,
  );
  return (
    <ProductsClient
      initialProducts={products}
      initialUoms={uoms}
      organizationId={session.organizationId}
    />
  );
}

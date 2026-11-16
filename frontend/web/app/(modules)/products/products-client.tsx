"use client"

import type { ComponentProps } from "react"
import { useCompanyHandoff } from "@/lib/use-company-handoff"
import { InventoryClient } from "../inventory/inventory-client"

export function ProductsClient(
  props: Omit<ComponentProps<typeof InventoryClient>, "workspace">,
) {
  const switchingCompany = useCompanyHandoff()
  if (switchingCompany) return <p role="status">Switching operating company…</p>
  return <InventoryClient {...props} workspace="products" />
}

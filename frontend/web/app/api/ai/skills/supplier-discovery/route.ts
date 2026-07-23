import { type NextRequest } from "next/server"

import { postSupplierDiscovery } from "../_governed-llm"

export async function POST(request: NextRequest) {
  return postSupplierDiscovery(request)
}

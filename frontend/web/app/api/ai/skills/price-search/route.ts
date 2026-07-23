import { type NextRequest } from "next/server"

import { postPriceSearch } from "../_governed-llm"

export async function POST(request: NextRequest) {
  return postPriceSearch(request)
}

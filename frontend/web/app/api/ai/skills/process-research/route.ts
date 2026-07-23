import { type NextRequest } from "next/server"

import { postProcessResearch } from "../_governed-llm"

export async function POST(request: NextRequest) {
  return postProcessResearch(request)
}

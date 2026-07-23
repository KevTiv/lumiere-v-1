import { type NextRequest } from "next/server"

import { postReportAnalysis } from "../_governed-llm"

export async function POST(request: NextRequest) {
  return postReportAnalysis(request)
}

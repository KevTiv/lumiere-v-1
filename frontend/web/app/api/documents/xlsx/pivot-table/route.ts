/**
 * POST /api/documents/xlsx/pivot-table — proxied pivot XLSX export.
 */

import type { NextRequest } from "next/server"
import { forwardToApiServerRequired } from "@/lib/api-server-forward"

export async function POST(request: NextRequest) {
  return forwardToApiServerRequired(request)
}

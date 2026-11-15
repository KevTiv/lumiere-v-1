import type { NextRequest } from "next/server"
import { forwardToApiServerRequired } from "@/lib/api-server-forward"

type Context = { params: Promise<{ segments: string[] }> }

function isRecordId(segment: string | undefined) {
  return segment != null && /^[1-9]\d{0,19}$/.test(segment)
}

async function forward(request: NextRequest, context: Context) {
  const { segments } = await context.params
  const [batchId, resource, recordId, detail] = segments
  const allowed =
    isRecordId(batchId) &&
    ((request.method === "GET" &&
      (segments.length === 1 ||
        (segments.length === 2 &&
          (resource === "native-links" || resource === "linked-posted-costs")) ||
        (segments.length === 4 &&
          resource === "events" &&
          isRecordId(recordId) &&
          detail === "history"))) ||
      (request.method === "POST" &&
        segments.length === 2 &&
        (resource === "events" ||
          resource === "processing-links" ||
          resource === "processing-runs" ||
          resource === "cost-links")) ||
      (request.method === "PATCH" &&
        segments.length === 3 &&
        resource === "events" &&
        isRecordId(recordId)))

  return allowed ? forwardToApiServerRequired(request) : new Response(null, { status: 404 })
}

export const GET = forward
export const POST = forward
export const PATCH = forward

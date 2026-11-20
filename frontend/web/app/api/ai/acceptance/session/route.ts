import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { type NextRequest, NextResponse } from "next/server"
import { resolveApiServerBaseUrl } from "@/lib/api-server-forward"

export const runtime = "nodejs"

const cacheHeaders = { "Cache-Control": "no-store" }

async function readBuildStamp() {
  const raw = await readFile(resolve(process.cwd(), "release-acceptance.json"), "utf8")
  const stamp = JSON.parse(raw) as { releaseSha?: unknown; builtAt?: unknown }
  if (typeof stamp.releaseSha !== "string" || !/^[a-f0-9]{40}$/.test(stamp.releaseSha) ||
      typeof stamp.builtAt !== "string" || !Number.isFinite(Date.parse(stamp.builtAt))) {
    throw new Error("Invalid release acceptance build stamp")
  }
  return { releaseSha: stamp.releaseSha, builtAt: stamp.builtAt }
}

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization")
  if (!authorization?.startsWith("Bearer ") || authorization.length > 16_391) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: cacheHeaders })
  }
  const api = resolveApiServerBaseUrl()
  const secret = process.env.LUMIERE_AI_GATEWAY_INTERNAL_SECRET
  if (!api || !secret?.trim()) {
    return NextResponse.json({ error: "Acceptance is unavailable" }, { status: 503, headers: cacheHeaders })
  }

  try {
    const { releaseSha, builtAt } = await readBuildStamp()
    const init = {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
        "X-Lumiere-Gateway-Secret": secret,
        "X-Lumiere-Acceptance-Release": releaseSha,
        "X-Lumiere-Acceptance-Built-At": builtAt,
      },
      body: request.body,
      duplex: "half",
      cache: "no-store",
      redirect: "error",
      signal: request.signal,
    } as const
    const response = await fetch(`${api}/v1/ai/acceptance/session`, init)
    return new NextResponse(response.body, {
      status: response.status,
      headers: { ...cacheHeaders, "Content-Type": "application/json" },
    })
  } catch {
    return NextResponse.json({ error: "Acceptance is unavailable" }, { status: 503, headers: cacheHeaders })
  }
}

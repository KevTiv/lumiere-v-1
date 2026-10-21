import { syntheticLogoBase64, syntheticLogoHash } from "../../../../../../../../personalization-fixture"

/** Isolated fixture asset only: no object storage, ERP API, or auth route is used. */
export function GET(request: Request) {
  if (new URL(request.url).searchParams.get("sha256") !== syntheticLogoHash) return new Response("Unknown synthetic image", { status: 404 })
  return new Response(Buffer.from(syntheticLogoBase64, "base64"), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "X-Fixture-Asset": "synthetic-invoice-logo" } })
}

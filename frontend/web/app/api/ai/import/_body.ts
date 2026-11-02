const MAX_IMPORT_JSON_BYTES = 5_000_000

/** Bound the actual request bytes before decoding or allocating JSON matrices. */
export async function parseImportJsonBody(
  request: Request,
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response }
> {
  const tooLarge = () => ({
    ok: false as const,
    response: Response.json(
      { error: "Import request exceeds the size limit" },
      { status: 413 },
    ),
  })
  const declared = request.headers.get("content-length")
  if (
    declared &&
    /^\d+$/.test(declared) &&
    Number(declared) > MAX_IMPORT_JSON_BYTES
  )
    return tooLarge()
  if (!request.body)
    return {
      ok: false,
      response: Response.json(
        { error: "JSON object body required" },
        { status: 400 },
      ),
    }
  const reader = request.body.getReader()
  try {
    let total = 0
    const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_IMPORT_JSON_BYTES) {
        await reader.cancel()
        return tooLarge()
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const body = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return {
        ok: false,
        response: Response.json(
          { error: "JSON object body required" },
          { status: 400 },
        ),
      }
    }
    return { ok: true, body: body as Record<string, unknown> }
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "Invalid JSON body" }, { status: 400 }),
    }
  } finally {
    reader.releaseLock()
  }
}

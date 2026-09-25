import { createHash, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import {
  callReducerBff,
  expectNoAppError,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  isAiGatewayAvailable,
  openErpAiChat,
  scalarQueryId,
  smokeName,
} from "./helpers"

/**
 * Passage-backed RAG and actor-scoped evidence access, end to end:
 * browser → BFF/api-server → ai-gateway → Qdrant + SpacetimeDB → answer gate.
 *
 * Seeded and real. A document is uploaded through the blob API, registered, and
 * ingested by the server into versioned evidence passages that are embedded into
 * Qdrant. The acting user is then given (and stripped of) the exact
 * `ai.evidence.retrieve` role grant, and its bounds and the source lifecycle are
 * exercised against the live gateway.
 *
 * AI is mandatory: this spec has no capability skip. If the gateway is down it
 * fails, so a green run always means the real stack answered.
 *
 *   E2E_REQUIRE_AI=1 E2E_CLEAR_DB=1 make e2e-single E2E_SPEC=ai-rag-evidence-access.spec.ts
 */

const none = { none: [] as [] }
const some = <T,>(value: T) => ({ some: value })

const RETRIEVE = "ai.evidence.retrieve"
const INSPECT = "ai.evidence.inspect"
const RELEASED = ["admitted", "qualified"]

type RagSource = {
  kind: string
  passage_id?: number
  source_key?: string
  text_snippet?: string
}

type SseMetadata = Pick<
  RagBody,
  "verification" | "provenance" | "provider" | "model" | "retrieval_degraded"
> & { sources: RagSource[] }

type RagBody = {
  answer: string
  sources: RagSource[]
  run_id?: number
  retrieval_degraded?: boolean
  provider?: string
  model?: string
  verification?: { outcome: string; reason?: string }
  provenance?: {
    persisted: boolean
    contributionId?: number
    claimIds?: number[]
    claims: Array<{ passageSupport?: unknown[]; verificationMethod?: string }>
  }
}

test.describe.configure({ mode: "serial" })

test.describe("AI RAG evidence access", { tag: ["@p0", "@ai-live"] }, () => {
  test.setTimeout(420_000)

  // A fact no other document states, so retrieval can only find it here.
  const tag = randomUUID().slice(0, 8)
  const marker = `Aurora-${tag}`
  const policyText =
    `Policy ${tag}: any refund above 731 EUR requires written sign-off from the ${marker} review board before payment.`
  const question = `Under policy ${tag}, who must sign off a refund above 731 EUR?`

  let organizationId = 0
  let companyId = 0
  let roleId = 0
  let documentId = 0

  async function requireGateway(page: Page) {
    if (!(await isAiGatewayAvailable(page))) {
      throw new Error(
        "ai-rag-evidence-access requires the ai-gateway (Qdrant + STDB + LLM); it never skips",
      )
    }
  }

  async function membershipRoleId(page: Page): Promise<number> {
    const res = await page.request.get("/api/query/user-organization")
    expect(res.ok(), `user-organization query: ${res.status()}`).toBeTruthy()
    const json = (await res.json()) as { data?: Array<Record<string, unknown>> }
    const row =
      (json.data ?? []).find((membership) => membership.isDefault ?? membership.is_default) ??
      json.data?.[0]
    const id = scalarQueryId(row?.roleId ?? row?.role_id)
    if (id == null) throw new Error("the signed-in user has no role to grant capabilities to")
    return id
  }

  async function setGrant(
    page: Page,
    capability: string,
    limits: { maxRows: number; maxBytes: number },
    isActive = true,
  ) {
    await callReducerBff(page, "set_ai_capability_role_grant", [
      organizationId,
      roleId,
      capability,
      limits.maxRows,
      limits.maxBytes,
      isActive,
    ])
  }

  async function uploadPolicyDocument(page: Page): Promise<number> {
    const bytes = Buffer.from(policyText, "utf8")
    const checksum = createHash("sha256").update(bytes).digest("hex")
    const name = smokeName("rag-evidence")
    const fileName = `${name}.txt`

    const presign = await page.request.post("/api/documents/blobs/presign", {
      data: {
        fileName,
        contentType: "text/plain",
        contentLength: bytes.length,
        companyId,
        checksum,
      },
    })
    expect(presign.ok(), `presign: ${presign.status()}`).toBeTruthy()
    const presigned = (await presign.json()) as { objectKey: string; uploadUrl: string }

    const put = await page.request.put(presigned.uploadUrl, {
      data: bytes,
      headers: { "Content-Type": "text/plain" },
    })
    expect(put.ok(), `blob upload: ${put.status()}`).toBeTruthy()

    const complete = await page.request.post("/api/documents/blobs/complete", {
      data: { objectKey: presigned.objectKey, checksum },
    })
    expect(complete.ok(), `blob complete: ${complete.status()}`).toBeTruthy()
    const blob = (await complete.json()) as {
      url: string
      fileSize: number
      checksum: string
      mimetype: string
    }

    await callReducerBff(page, "create_document", [
      organizationId,
      some(companyId),
      {
        name,
        description: some("RAG evidence access e2e policy"),
        file_name: fileName,
        file_size: blob.fileSize,
        mimetype: blob.mimetype,
        url: blob.url,
        checksum: blob.checksum,
        folder_id: none,
        res_model: none,
        res_id: none,
        partner_id: none,
        tag_ids: [],
        is_favorite: false,
        classification_id: none,
        retention_days: none,
        fiscal_kind: none,
        residency_region: none,
        metadata: none,
      },
    ])

    let id = 0
    await expect
      .poll(
        async () => {
          const res = await page.request.get("/api/query/documents")
          if (!res.ok()) return 0
          const json = (await res.json()) as { data?: Array<{ id?: unknown; name?: string }> }
          const row = (json.data ?? []).find((doc) => String(doc.name ?? "") === name)
          id = scalarQueryId(row?.id) ?? 0
          return id
        },
        { timeout: 30_000, message: "created document is queryable" },
      )
      .toBeGreaterThan(0)
    return id
  }

  async function askRag(page: Page): Promise<RagBody> {
    const res = await page.request.post("/api/ai/rag", {
      data: { query: question, companyId },
      timeout: 120_000,
    })
    expect(res.ok(), `POST /api/ai/rag: ${res.status()} ${await res.text()}`).toBeTruthy()
    return (await res.json()) as RagBody
  }

  const ownPassages = (body: RagBody) =>
    (body.sources ?? []).filter(
      (source) => source.kind === "passage" && source.source_key === `document:${documentId}`,
    )

  /** A released, passage-grounded answer with durable claim ids. */
  function expectGroundedRelease(body: RagBody) {
    expect(ownPassages(body).length, "the ingested passage is cited as a source").toBeGreaterThan(0)
    expect(RELEASED, body.verification?.reason).toContain(body.verification?.outcome)
    expect(body.retrieval_degraded).toBe(false)
    expect(body.provider, "a live routed LLM provider handled generation").toBeTruthy()
    expect(body.model, "the live generation model is recorded").toBeTruthy()
    expect(body.answer).not.toContain("supportRefs")
    expect(body.provenance?.persisted).toBe(true)
    expect(body.provenance?.contributionId).toBeGreaterThan(0)
    expect(body.provenance?.claimIds?.length ?? 0).toBeGreaterThan(0)
    expect(
      body.provenance?.claims.some((claim) => (claim.passageSupport?.length ?? 0) > 0),
      "a claim is bound to a server-known passage",
    ).toBe(true)
  }

  /** Nothing about the passage reaches the caller, and no answer is admitted. */
  function expectNoPassageDisclosure(body: RagBody) {
    expect(ownPassages(body)).toHaveLength(0)
    expect((body.sources ?? []).filter((source) => source.kind === "passage")).toHaveLength(0)
    const serialized = JSON.stringify(body)
    for (const leaked of [marker, "731 EUR", "review board"]) {
      expect(serialized, `response leaked "${leaked}"`).not.toContain(leaked)
    }
    expect(body.provenance?.claimIds?.length ?? 0).toBe(0)
    expect(body.provenance?.persisted ?? false).toBe(false)
  }

  /** Ask until the passage is indexed and released. Retries only model flakiness. */
  async function askUntilGrounded(page: Page): Promise<RagBody> {
    const deadline = Date.now() + 240_000
    let last: RagBody | undefined
    while (Date.now() < deadline) {
      last = await askRag(page)
      if (ownPassages(last).length > 0 && RELEASED.includes(last.verification?.outcome ?? "")) {
        return last
      }
      await page.waitForTimeout(3_000)
    }
    throw new Error(`no released passage-grounded answer before the deadline: ${JSON.stringify(last)}`)
  }

  test("an authorized user ingests a document and gets a passage-grounded answer with claim ids", async ({
    page,
  }) => {
    await page.goto("/overview")
    await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/)
    await requireGateway(page)

    organizationId = await fetchSessionOrganizationId(page)
    companyId = await fetchDefaultCompanyId(page)
    roleId = await membershipRoleId(page)

    // Default-deny: nothing is seeded. The grant is the only authority.
    await setGrant(page, RETRIEVE, { maxRows: 5, maxBytes: 16_384 })
    await setGrant(page, INSPECT, { maxRows: 5, maxBytes: 16_384 })

    documentId = await uploadPolicyDocument(page)
    const ingest = await page.request.post("/api/ai/evidence/ingestion/documents", {
      data: { companyId, documentId },
    })
    expect(ingest.ok(), `evidence ingestion: ${ingest.status()} ${await ingest.text()}`).toBeTruthy()

    // The embedding job runs asynchronously; ask until Qdrant serves the passage.
    const body = await askUntilGrounded(page)
    expectGroundedRelease(body)
    expect(body.run_id, "released RAG answer exposes its durable run id").toBeGreaterThan(0)

    // Navigate from the answer -> durable run -> contribution/claims -> exact
    // evidence inspections. The transcript is deliberately redacted: it exposes
    // input hashes and bounded result status, never raw tool arguments/results.
    const runInspect = await page.request.post("/api/ai/evidence/runs/inspect", {
      data: { companyId, runId: body.run_id },
    })
    expect(
      runInspect.ok(),
      `inspect run ${body.run_id}: ${runInspect.status()} ${await runInspect.text()}`,
    ).toBeTruthy()
    const runInspection = (await runInspect.json()) as {
      runId: number
      answer?: string
      transcript: Array<{
        inputHash: string
        resultSummary: string
        outputSummary?: unknown
      }>
      contributionIds: number[]
      claimIds: number[]
      claims: Array<{ targetKind: string; targetId: number; passages: unknown[] }>
    }
    expect(runInspection.runId).toBe(body.run_id)
    expect(runInspection.answer).toBe(body.answer)
    expect(runInspection.contributionIds.length).toBeGreaterThan(0)
    expect(runInspection.claimIds).toEqual(expect.arrayContaining(body.provenance!.claimIds!))
    expect(
      runInspection.claims.some(
        (claim) =>
          claim.targetKind === "claim" &&
          body.provenance!.claimIds!.includes(claim.targetId) &&
          claim.passages.length > 0,
      ),
    ).toBe(true)
    for (const step of runInspection.transcript) {
      expect(step.inputHash.length).toBeGreaterThan(0)
      expect(step.resultSummary.length).toBeGreaterThan(0)
      expect(step.outputSummary).toBeUndefined()
    }

    const runExport = await page.request.post("/api/ai/evidence/runs/export", {
      data: { companyId, runId: body.run_id },
    })
    expect(runExport.ok(), `export run ${body.run_id}: ${runExport.status()}`).toBeTruthy()
    expect(runExport.headers()["content-disposition"]).toContain(
      `lumiere-run-${body.run_id}-evidence.json`,
    )
    const exported = (await runExport.json()) as {
      schemaVersion: number
      kind: string
      run: { runId: number; claimIds: number[] }
    }
    expect(exported.schemaVersion).toBe(1)
    expect(exported.kind).toBe("lumiere_run_evidence_export")
    expect(exported.run.runId).toBe(body.run_id)
    expect(exported.run.claimIds).toEqual(expect.arrayContaining(body.provenance!.claimIds!))

    // The claim ids are durable and inspectable by an authorized actor.
    const claimId = body.provenance!.claimIds![0]
    const inspect = await page.request.post("/api/ai/evidence/inspect", {
      data: { kind: "claim", id: claimId },
    })
    expect(inspect.ok(), `inspect claim ${claimId}: ${inspect.status()}`).toBeTruthy()
    expect(JSON.stringify(await inspect.json())).toContain(`document:${documentId}`)
  })

  test("the browser assistant streams only the gated answer and its provenance", async ({ page }) => {
    await page.goto("/overview")
    await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/)
    await requireGateway(page)
    expect(documentId, "the ingestion test must have run").toBeGreaterThan(0)

    await openErpAiChat(page)

    let sse: { deltas: string; metadata: SseMetadata } | undefined
    for (let attempt = 0; attempt < 3 && !sse; attempt += 1) {
      const streamed = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/ai/rag/stream") && response.request().method() === "POST",
        { timeout: 120_000 },
      )
      await page.getByTestId("erp-ai-chat-input").fill(question)
      await page.getByTestId("erp-ai-chat-send").click()
      const raw = await (await streamed).text()

      let deltas = ""
      let metadata: SseMetadata = { sources: [] }
      for (const block of raw.split(/\r?\n\r?\n/)) {
        const event = /^event:\s*(.+)$/m.exec(block)?.[1]?.trim()
        const data = [...block.matchAll(/^data:\s?(.*)$/gm)].map((match) => match[1]).join("\n")
        if (event === "delta") deltas += data
        if (event === "sources") metadata = JSON.parse(data)
      }
      expect(deltas, "the raw candidate is never streamed").not.toContain("supportRefs")
      expect(deltas).not.toContain('"claims"')
      if (RELEASED.includes(metadata.verification?.outcome ?? "")) sse = { deltas, metadata }
      await expect(page.getByTestId("erp-ai-chat-message-assistant").last()).toBeVisible({
        timeout: 60_000,
      })
    }
    expect(sse, "the streamed answer was released by the gate").toBeTruthy()

    const { deltas, metadata } = sse!
    expect(deltas.length).toBeGreaterThan(0)
    expect(metadata.retrieval_degraded).toBe(false)
    expect(metadata.provider, "stream metadata records the live routed LLM provider").toBeTruthy()
    expect(metadata.model, "stream metadata records the live generation model").toBeTruthy()
    expect(metadata.provenance?.persisted).toBe(true)
    expect(metadata.provenance?.claimIds?.length ?? 0).toBeGreaterThan(0)
    expect(
      metadata.sources.some(
        (source) => source.kind === "passage" && source.source_key === `document:${documentId}`,
      ),
    ).toBe(true)
    await expectNoAppError(page)
  })

  test("an oversized grant, a missing grant and a revoked source each disclose nothing", async ({
    page,
  }) => {
    await page.goto("/overview")
    await requireGateway(page)
    expect(documentId, "the ingestion test must have run").toBeGreaterThan(0)

    // Byte budget below the passage size: the passage is never loaded.
    await setGrant(page, RETRIEVE, { maxRows: 5, maxBytes: 8 })
    expectNoPassageDisclosure(await askRag(page))

    // Role grant removed: the next request is denied, with no cache to expire.
    await setGrant(page, RETRIEVE, { maxRows: 5, maxBytes: 16_384 }, false)
    expectNoPassageDisclosure(await askRag(page))

    // Restored, the same user is answered again.
    await setGrant(page, RETRIEVE, { maxRows: 5, maxBytes: 16_384 })
    expectGroundedRelease(await askUntilGrounded(page))

    // Source revoked. Qdrant still holds the vector until its asynchronous
    // deletion runs, so a passing check here is the authoritative graph failing
    // closed, not cache freshness.
    const revoke = await page.request.post("/api/ai/evidence/ingestion/documents/lifecycle", {
      data: {
        companyId,
        documentId,
        changeKind: "access_revoked",
        reason: "e2e: revoke document evidence access",
      },
    })
    expect(revoke.ok(), `revoke evidence: ${revoke.status()} ${await revoke.text()}`).toBeTruthy()
    expectNoPassageDisclosure(await askRag(page))
  })
})

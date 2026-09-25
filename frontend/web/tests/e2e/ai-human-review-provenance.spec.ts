import { createHash, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import {
  callReducerBff,
  callReducerBffResult,
  callReducerOwner,
  expectNoAppError,
  fetchDefaultCompanyId,
  fetchDraftWorkflowVersionId,
  fetchSessionOrganizationId,
  fetchWorkflowIdByKey,
  isAiGatewayAvailable,
  scalarQueryId,
  smokeName,
  waitForWorkflowVersionStatus,
} from "./helpers"

/**
 * Human-review reuse and automatic workflow provenance, end to end.
 *
 *   source passage → claim → accepted decision → workflow step
 *
 * Seeded and real. Evidence is created by the database-owner identity (standing
 * in for the trusted gateway), so the signed-in browser user is an *independent*
 * reviewer and separation of duties holds. Everything the user does — review,
 * accept, confirm, publish, inspect — goes through the real browser, BFF,
 * api-server and reducers.
 *
 *   E2E_CLEAR_DB=1 make e2e-single E2E_SPEC=ai-human-review-provenance.spec.ts
 *
 * The first case needs the gateway but no model. The reuse case also needs
 * Qdrant, an embedder, and a chat LLM. `E2E_REQUIRE_AI=1` makes either missing
 * prerequisite blocking; other lanes record an explicit skip.
 *
 *   E2E_CLEAR_DB=1 make e2e-single E2E_SPEC=ai-human-review-provenance.spec.ts E2E_GREP="workflow publication"
 */

const none = { none: [] as [] }
const some = <T,>(value: T) => ({ some: value })

const INSPECT = "ai.evidence.inspect"
const RETRIEVE = "ai.evidence.retrieve"
const HASH_LENGTH = 64

type Row = Record<string, unknown>

async function ownerSql(sql: string): Promise<Row[]> {
  const host = (process.env.E2E_STDB_HOST ?? process.env.STDB_HOST ?? "http://127.0.0.1:3000").replace(/\/$/, "")
  const moduleName = process.env.STDB_MODULE?.trim()
  const token = process.env.STDB_SERVER_TOKEN?.trim()
  if (!moduleName || !token) throw new Error("owner SQL needs STDB_MODULE and STDB_SERVER_TOKEN")
  const response = await fetch(`${host}/v1/database/${moduleName}/sql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
    body: sql,
  })
  if (!response.ok) throw new Error(`owner SQL failed (${response.status}): ${await response.text()}`)
  const sets = (await response.json()) as Array<{
    schema?: { elements?: Array<{ name?: { some?: string } }> }
    rows?: unknown[][]
  }>
  const names = (sets[0]?.schema?.elements ?? []).map((element) => element.name?.some ?? "")
  return (sets[0]?.rows ?? []).map((values) =>
    Object.fromEntries(names.map((name, index) => [name, values[index]])),
  )
}

/** The hex identity inside a SATS `Identity` or `Option<Identity>` cell, or null. */
function identityHex(cell: unknown): string | null {
  const match = /0x([0-9a-f]{64})/.exec(JSON.stringify(cell ?? null))
  return match ? match[1]! : null
}

async function firstId(sql: string, label: string): Promise<number> {
  const rows = await ownerSql(sql)
  const id = scalarQueryId(rows[0]?.id)
  if (id == null) throw new Error(`${label} was not found`)
  return id
}

async function rowById(table: string, id: number): Promise<Row> {
  const rows = await ownerSql(`SELECT * FROM ${table} WHERE id = ${id}`)
  if (!rows[0]) throw new Error(`${table} ${id} not found`)
  return rows[0]
}

test.describe.configure({ mode: "serial" })

test.describe("AI human review and workflow provenance", () => {
  test.setTimeout(420_000)

  const tag = randomUUID().slice(0, 8)
  const sourceKey = `hr-${tag}`
  const statement = `Refunds above 731 EUR need written board sign-off (${tag}).`
  const passageText = `Policy ${tag}: refunds above 731 EUR require written board sign-off before payment.`

  let organizationId = 0
  let companyId = 0
  let roleId = 0
  let sourceVersionId = 0
  let passageId = 0
  let claimId = 0
  let decisionId = 0
  let runId = 0
  let workflowId = 0
  let firstVersionId = 0
  let firstComponentId = 0

  async function openReviewer(page: Page) {
    await page.goto("/ai-harness")
    await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/)
    await page.getByRole("tab", { name: "Evidence reviewer" }).click()
    await expect(page.getByText("Review queue")).toBeVisible()
    await page.getByRole("button", { name: "Refresh" }).click()
  }

  async function requireGateway(page: Page, prerequisite: string) {
    if (await isAiGatewayAvailable(page)) return
    if (process.env.E2E_REQUIRE_AI === "1") {
      throw new Error(`E2E_REQUIRE_AI=1 but ${prerequisite} is unavailable`)
    }
    test.skip(true, `requires ${prerequisite}`)
  }

  async function membershipRoleId(page: Page): Promise<number> {
    const res = await page.request.get("/api/query/user-organization")
    expect(res.ok(), `user-organization query: ${res.status()}`).toBeTruthy()
    const json = (await res.json()) as { data?: Array<Record<string, unknown>> }
    const row =
      (json.data ?? []).find((membership) => membership.isDefault ?? membership.is_default) ?? json.data?.[0]
    const id = scalarQueryId(row?.roleId ?? row?.role_id)
    if (id == null) throw new Error("the signed-in user has no role to grant capabilities to")
    return id
  }

  async function grant(page: Page, capability: string) {
    await callReducerBff(page, "set_ai_capability_role_grant", [
      organizationId,
      roleId,
      capability,
      5,
      16_384,
      true,
    ])
  }

  async function inspectStep(page: Page, versionId: number, nodeKey: string) {
    const response = await page.request.post("/api/ai/evidence/inspect", {
      data: { companyId, kind: "workflow_step", id: versionId, nodeKey },
    })
    expect(response.ok(), `inspect workflow step ${versionId}/${nodeKey}: ${response.status()}`).toBeTruthy()
    return (await response.json()) as {
      revisions: Array<{ id: number; parentComponentId: number | null; linkState: string; status: string }>
      decisions: Array<{ id: number; status: string }>
      claims: Array<{ id: number; verificationMethod: string; reviewerUid: string | null; statement: string }>
      passages: Array<{ id: number; availability: string; excerpt: string | null }>
      lineagePasses: boolean
    }
  }

  test("independent review, workflow publication and component inspection", { tag: "@p0" }, async ({ page }) => {
    await page.goto("/overview")
    await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/)
    await requireGateway(page, "the ai-gateway evidence service")
    organizationId = await fetchSessionOrganizationId(page)
    companyId = await fetchDefaultCompanyId(page)
    roleId = await membershipRoleId(page)
    // Default-deny: the grant is the only authority to inspect or see the queue.
    await grant(page, INSPECT)

    await test.step("a trusted writer records source, passage, claim and decision", async () => {
      await callReducerOwner("record_ai_evidence_source", [
        organizationId,
        companyId,
        {
          source_kind: "book",
          source_key: sourceKey,
          title: `Refund policy ${tag}`,
          author_attribution: "known",
          authors: ["Board of Directors"],
          author_organization: none,
          scope: "company",
          retention_policy: "retain_snapshot",
        },
      ])
      const sourceId = await firstId(
        `SELECT id FROM ai_evidence_source WHERE organization_id = ${organizationId} AND source_key = '${sourceKey}'`,
        "source",
      )
      await callReducerOwner("record_ai_evidence_source_version", [
        organizationId,
        companyId,
        sourceId,
        {
          version: "1",
          edition: some("1st"),
          publication_date_micros: some(1_000_000),
          uri: none,
          retrieved_at_micros: some(2_000_000),
          content_hash: some(createHash("sha256").update(passageText).digest("hex")),
          snapshot_ref: some("files/1"),
          origin: "book_paper",
          verification: "inspected",
          supersedes_version_id: none,
        },
      ])
      sourceVersionId = await firstId(
        `SELECT id FROM ai_evidence_source_version WHERE source_id = ${sourceId}`,
        "source version",
      )
      await callReducerOwner("record_ai_evidence_passage", [
        organizationId,
        companyId,
        {
          source_kind: "book",
          source_key: sourceKey,
          source_version: "1",
          passage_key: "p1",
          passage_text: passageText,
          effective_from_micros: none,
          effective_to_micros: none,
          applicability: [],
          source_version_id: some(sourceVersionId),
          coordinates: ["page:12"],
          text_origin: "original",
          processor_ref: none,
        },
      ])
      passageId = await firstId(
        `SELECT id FROM ai_evidence_passage WHERE organization_id = ${organizationId} AND source_key = '${sourceKey}'`,
        "passage",
      )
      // A model-assisted claim: exactly what an answer records, never a human review.
      await callReducerOwner("record_ai_evidence_claim", [
        organizationId,
        companyId,
        {
          kind: "sourced_fact",
          statement,
          supporting_passage_ids: [passageId],
          contradicting_passage_ids: [],
          calculation_ref: none,
          assumptions: [],
          contribution_id: none,
          verification_method: "model_assisted",
          verification_outcome: "supported",
          verification_note: some("model-assisted check (not domain approval)"),
          supersedes_claim_id: none,
        },
      ])
      claimId = await firstId(
        `SELECT id FROM ai_evidence_claim WHERE organization_id = ${organizationId} AND statement = '${statement}'`,
        "claim",
      )
      await callReducerOwner("record_ai_evidence_decision", [
        organizationId,
        companyId,
        {
          title: `Require sign-off ${tag}`,
          adopted_claim_ids: [claimId],
          supporting_claim_ids: [],
          applicability: [],
          alternatives: ["no sign-off"],
          adaptations: [],
          assumptions: [],
          rationale: "Company policy requires written board sign-off.",
          contribution_id: none,
          supersedes_decision_id: none,
        },
      ])
      decisionId = await firstId(
        `SELECT id FROM ai_evidence_decision WHERE organization_id = ${organizationId} AND title = 'Require sign-off ${tag}'`,
        "decision",
      )
    })

    await test.step("the reviewer sees the claim and decision in the queue and reviews both", async () => {
      await openReviewer(page)
      const claimCard = page.getByTestId(`queue-claim-${claimId}`)
      await expect(claimCard).toBeVisible({ timeout: 30_000 })
      await expect(claimCard).toContainText(statement)
      await expect(claimCard).toContainText("model_assisted")
      await expect(claimCard).toContainText(`Refund policy ${tag}`)
      // The browser user did not create it, so they may review it.
      await claimCard.getByRole("button", { name: "Supported" }).click()
      await expect(page.getByText(`claim #${claimId}: supported.`)).toBeVisible({ timeout: 30_000 })

      const reviewed = await rowById("ai_evidence_claim", claimId)
      expect(reviewed.verification_method).toBe("human_reviewed")
      expect(reviewed.status).toBe("current")
      const reviewer = identityHex(reviewed.reviewer_uid)
      expect(reviewer, "the reviewer identity is persisted on the claim").toBeTruthy()
      expect(reviewer).not.toBe(identityHex(reviewed.create_uid))
      expect(JSON.stringify(reviewed.reviewed_at), "the review time is persisted").toMatch(/\d{6,}/)

      const decisionCard = page.getByTestId(`queue-decision-${decisionId}`)
      await expect(decisionCard).toBeVisible()
      await decisionCard.getByRole("button", { name: "Accept" }).click()
      await expect(page.getByText(`decision #${decisionId}: accepted.`)).toBeVisible({ timeout: 30_000 })
      expect((await rowById("ai_evidence_decision", decisionId)).status).toBe("accepted")
      await expectNoAppError(page)
    })

    await test.step("a harness-generated workflow cannot publish without provenance", async () => {
      // A run is only ever attributed after the server resolves it, so give it a
      // real one: any active skill this organization may use, and its agent.
      const agentId = await firstId(
        `SELECT id FROM ai_agent WHERE organization_id = ${organizationId} AND is_active = true LIMIT 1`,
        "an active AI agent",
      )
      const skills = await ownerSql("SELECT id FROM ai_skill WHERE is_active = true LIMIT 25")
      let created = false
      for (const skill of skills) {
        try {
          await callReducerOwner("create_ai_agent_run", [
            organizationId,
            {
              company_id: companyId,
              skill_id: scalarQueryId(skill.id),
              skill_config_id: none,
              agent_id: agentId,
              team_member_id: none,
              run_key: `hr-${tag}`,
              inputs_json: "{}",
              triggered_by_hex: "00".repeat(HASH_LENGTH / 2),
              metadata: none,
            },
          ])
          created = true
          break
        } catch {
          // Not this organization's skill; try the next.
        }
      }
      expect(created, "an AI run could be created for the workflow to name").toBe(true)
      runId = await firstId(`SELECT id FROM ai_agent_run WHERE run_key = 'hr-${tag}'`, "run")

      const workflowKey = smokeName("hrwf").toLowerCase().replace(/-/g, "_")
      await callReducerBff(page, "create_workflow", [
        organizationId,
        some(companyId),
        {
          workflowKey,
          model: "purchase_order",
          name: `Refund approval ${tag}`,
          description: none,
          trigger: { tag: "Manual" },
          schemaVersion: 1,
          snapshotFields: [],
          metadata: none,
        },
      ])
      workflowId = await fetchWorkflowIdByKey(page, workflowKey)
      const draft = await fetchDraftWorkflowVersionId(page, workflowId)
      firstVersionId = draft.versionId
      let revision = draft.draftRevision
      const node = (nodeKey: string, name: string, kind: string, sequence: number, timer = false) => ({
        nodeKey,
        name,
        kind: { tag: kind },
        sequence,
        splitKind: { tag: "None" },
        joinKind: { tag: "None" },
        action: none,
        taskPolicy: none,
        timerPolicy: timer
          ? some({ kind: { tag: "Delay" }, delaySeconds: 60, calendarKey: none })
          : none,
        retryPolicy: none,
        subflow: none,
        metadata: none,
      })
      for (const definition of [
        node("start", "Start", "Start", 1),
        node("review", "Board sign-off wait", "Timer", 2, true),
        node("end", "End", "End", 3),
      ]) {
        await callReducerOwner("upsert_workflow_node", [organizationId, firstVersionId, revision, definition])
        revision += 1
      }
      for (const [edgeKey, from, to, sequence] of [
        ["e_start_review", "start", "review", 1],
        ["e_review_end", "review", "end", 2],
      ] as const) {
        await callReducerOwner("upsert_workflow_edge", [
          organizationId,
          firstVersionId,
          revision,
          {
            edgeKey,
            fromNodeKey: from,
            toNodeKey: to,
            sequence,
            signalKey: none,
            condition: none,
            metadata: none,
          },
        ])
        revision += 1
      }

      // The trusted writer marks the draft as generated by a governed run.
      await callReducerOwner("begin_ai_workflow_generation", [
        organizationId,
        companyId,
        firstVersionId,
        revision,
        runId,
      ])
      const refused = await callReducerBffResult(page, "publish_workflow_version", [
        organizationId,
        firstVersionId,
        revision,
      ])
      expect(refused.ok, "a generated draft with no provenance must not publish").toBe(false)
      expect(refused.error ?? "").toMatch(/provenance|permission|denied/i)
      await waitForWorkflowVersionStatus(page, firstVersionId, "Draft")

      await callReducerOwner("stage_ai_workflow_node_provenance", [
        organizationId,
        companyId,
        firstVersionId,
        revision,
        { node_key: "review", decision_ids: [decisionId], claim_ids: [claimId] },
      ])
      await callReducerBff(page, "publish_workflow_version", [organizationId, firstVersionId, revision])
      await waitForWorkflowVersionStatus(page, firstVersionId, "Published")

      const components = await ownerSql(
        `SELECT id, component_key, component_kind, link_state, status FROM ai_artifact_component WHERE artifact_ref = 'workflow-version:${firstVersionId}'`,
      )
      expect(components).toHaveLength(1)
      expect(components[0]).toMatchObject({
        component_key: "node:review",
        component_kind: "workflow_step",
        link_state: "linked",
        status: "current",
      })
      firstComponentId = Number(components[0]!.id)
    })

    await test.step("the inspector reconstructs source → claim → decision → workflow step", async () => {
      const inspection = await inspectStep(page, firstVersionId, "review")
      expect(inspection.lineagePasses).toBe(true)
      expect(inspection.decisions.map((decision) => decision.id)).toEqual([decisionId])
      expect(inspection.decisions[0]!.status).toBe("accepted")
      expect(inspection.claims[0]).toMatchObject({ id: claimId, verificationMethod: "human_reviewed" })
      expect(inspection.claims[0]!.reviewerUid, "the reviewer of the claim is shown").toMatch(/^[0-9a-f]{64}$/)
      expect(inspection.passages[0]).toMatchObject({ id: passageId, availability: "available" })
      expect(inspection.passages[0]!.excerpt).toContain(`Policy ${tag}`)

      // The same chain through the reviewer screen.
      await openReviewer(page)
      await page.getByRole("combobox").filter({ hasText: /Decision|Claim|Workflow step/ }).click()
      await page.getByRole("option", { name: "Workflow step" }).click()
      await page.getByLabel("Workflow version ID").fill(String(firstVersionId))
      await page.getByLabel("Step node key").fill("review")
      await page.getByRole("button", { name: "Inspect lineage" }).click()
      await expect(page.getByText(`Decision #${decisionId}`)).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText(statement)).toBeVisible()
      await expect(page.getByText(`Policy ${tag}`)).toBeVisible()
      await expect(page.getByTestId(`inspection-revision-${firstComponentId}`)).toBeVisible()
    })

    await test.step("an edited clone keeps ancestry, needs confirmation of the exact hash, then publishes", async () => {
      await callReducerBff(page, "clone_workflow_version_to_draft", [
        organizationId,
        firstVersionId,
        (await rowById("workflow_version", firstVersionId)).draft_revision,
      ])
      const draft = await fetchDraftWorkflowVersionId(page, workflowId)
      const secondVersionId = draft.versionId
      const forked = await ownerSql(
        `SELECT id, parent_component_id, link_state FROM ai_artifact_component WHERE artifact_ref = 'workflow-version:${secondVersionId}'`,
      )
      expect(forked, "the clone forks the parent component").toHaveLength(1)
      expect(JSON.stringify(forked[0]!.parent_component_id)).toContain(String(firstComponentId))

      // Edit the step, then restage it: changed content reads `changed`.
      await callReducerOwner("upsert_workflow_node", [
        organizationId,
        secondVersionId,
        draft.draftRevision,
        {
          nodeKey: "review",
          name: "Board sign-off wait (tightened)",
          kind: { tag: "Timer" },
          sequence: 2,
          splitKind: { tag: "None" },
          joinKind: { tag: "None" },
          action: none,
          taskPolicy: none,
          timerPolicy: some({ kind: { tag: "Delay" }, delaySeconds: 60, calendarKey: none }),
          retryPolicy: none,
          subflow: none,
          metadata: none,
        },
      ])
      const revision = Number((await rowById("workflow_version", secondVersionId)).draft_revision)
      await callReducerOwner("stage_ai_workflow_node_provenance", [
        organizationId,
        companyId,
        secondVersionId,
        revision,
        { node_key: "review", decision_ids: [decisionId], claim_ids: [claimId] },
      ])
      const changed = await ownerSql(
        `SELECT id, link_state, content_hash FROM ai_artifact_component WHERE artifact_ref = 'workflow-version:${secondVersionId}' AND status = 'current'`,
      )
      expect(changed).toHaveLength(1)
      expect(changed[0]!.link_state).toBe("changed")
      const secondComponentId = Number(changed[0]!.id)

      const blocked = await callReducerBffResult(page, "publish_workflow_version", [
        organizationId,
        secondVersionId,
        revision,
      ])
      expect(blocked.ok, "changed links must not publish before review").toBe(false)

      // The reviewer confirms exactly the content shown in the queue.
      await openReviewer(page)
      const card = page.getByTestId(`queue-component-${secondComponentId}`)
      await expect(card).toBeVisible({ timeout: 30_000 })
      await expect(card).toContainText(String(changed[0]!.content_hash))
      await card.getByRole("button", { name: "Confirm this content" }).click()
      await expect(page.getByText(`component #${secondComponentId}: confirmed.`)).toBeVisible({ timeout: 30_000 })
      expect((await rowById("ai_artifact_component", secondComponentId)).link_state).toBe("linked")

      await callReducerBff(page, "publish_workflow_version", [organizationId, secondVersionId, revision])
      await waitForWorkflowVersionStatus(page, secondVersionId, "Published")

      const inspection = await inspectStep(page, secondVersionId, "review")
      const chain = inspection.revisions.map((revisionRow) => revisionRow.id)
      expect(chain.length).toBeGreaterThanOrEqual(3)
      expect(chain).toContain(firstComponentId)
      expect(inspection.revisions.at(-1)!.parentComponentId).toBeNull()
      expect(inspection.claims[0]!.id).toBe(claimId)
      expect(inspection.passages[0]!.id).toBe(passageId)
    })

    await test.step("revoked evidence fails the workflow closed", async () => {
      await callReducerOwner("record_ai_evidence_source_change", [
        organizationId,
        companyId,
        sourceVersionId,
        { change_kind: "retracted", replacement_version_id: none, reason: `e2e retraction ${tag}` },
      ])
      expect((await rowById("ai_evidence_claim", claimId)).status).toBe("needs_review")
      const flagged = await ownerSql(
        `SELECT link_state FROM ai_artifact_component WHERE component_kind = 'workflow_step' AND artifact_ref = 'workflow-version:${firstVersionId}'`,
      )
      expect(flagged[0]!.link_state).toBe("unresolved")

      await openReviewer(page)
      await expect(page.getByTestId(`queue-component-${firstComponentId}`)).toContainText("unresolved")
      await expect(page.getByTestId(`queue-claim-${claimId}`)).toContainText("Needs review")

      // The evidence is gone for good, so the claim cannot be re-blessed.
      const rereview = await page.request.post("/api/ai/evidence/reviews", {
        data: { companyId, kind: "claim", id: claimId, outcome: "supported", note: null },
      })
      expect(rereview.ok(), "a claim on retracted evidence cannot be reviewed").toBe(false)
    })
  })

  test("a fresh run reuses an exact reviewed claim and nothing else", { tag: ["@p0", "@ai-live"] }, async ({ page }) => {
    test.setTimeout(600_000)
    await page.goto("/overview")
    await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/)
    await requireGateway(page, "the live ai-gateway (Qdrant + STDB + LLM)")
    organizationId = await fetchSessionOrganizationId(page)
    companyId = await fetchDefaultCompanyId(page)
    roleId = await membershipRoleId(page)
    await grant(page, INSPECT)
    await grant(page, RETRIEVE)

    const marker = `Aurora-${tag}`
    const policy = `Policy ${tag}: any refund above 731 EUR requires written sign-off from the ${marker} review board before payment.`
    const question = `Under policy ${tag}, who must sign off a refund above 731 EUR?`

    const bytes = Buffer.from(policy, "utf8")
    const checksum = createHash("sha256").update(bytes).digest("hex")
    const name = smokeName("hr-reuse")
    const presign = await page.request.post("/api/documents/blobs/presign", {
      data: { fileName: `${name}.txt`, contentType: "text/plain", contentLength: bytes.length, companyId, checksum },
    })
    expect(presign.ok(), `presign: ${presign.status()}`).toBeTruthy()
    const presigned = (await presign.json()) as { objectKey: string; uploadUrl: string }
    const put = await page.request.put(presigned.uploadUrl, { data: bytes, headers: { "Content-Type": "text/plain" } })
    expect(put.ok(), `blob upload: ${put.status()}`).toBeTruthy()
    const complete = await page.request.post("/api/documents/blobs/complete", {
      data: { objectKey: presigned.objectKey, checksum },
    })
    expect(complete.ok(), `blob complete: ${complete.status()}`).toBeTruthy()
    const blob = (await complete.json()) as { url: string; fileSize: number; checksum: string; mimetype: string }
    await callReducerBff(page, "create_document", [
      organizationId,
      some(companyId),
      {
        name,
        description: some("human-review reuse e2e policy"),
        file_name: `${name}.txt`,
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
    let documentId = 0
    await expect
      .poll(
        async () => {
          const res = await page.request.get("/api/query/documents")
          const json = (await res.json()) as { data?: Array<{ id?: unknown; name?: string }> }
          documentId = scalarQueryId(json.data?.find((doc) => String(doc.name ?? "") === name)?.id) ?? 0
          return documentId
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0)
    const ingest = await page.request.post("/api/ai/evidence/ingestion/documents", {
      data: { companyId, documentId },
    })
    expect(ingest.ok(), `evidence ingestion: ${ingest.status()} ${await ingest.text()}`).toBeTruthy()

    type RagBody = {
      verification?: { outcome: string }
      provenance?: {
        claimIds?: number[]
        claims: Array<{ text?: string; verificationMethod?: string }>
      }
    }
    const ask = async (): Promise<RagBody> => {
      const res = await page.request.post("/api/ai/rag", { data: { query: question, companyId }, timeout: 120_000 })
      expect(res.ok(), `POST /api/ai/rag: ${res.status()}`).toBeTruthy()
      return (await res.json()) as RagBody
    }
    const released = (body: RagBody) =>
      ["admitted", "qualified"].includes(body.verification?.outcome ?? "") &&
      (body.provenance?.claimIds?.length ?? 0) > 0

    // Run one: the answer's claims are model-assisted, awaiting a person.
    let first: RagBody | undefined
    for (const deadline = Date.now() + 240_000; Date.now() < deadline; await page.waitForTimeout(3_000)) {
      first = await ask()
      if (released(first)) break
    }
    expect(first && released(first), "a released, passage-grounded first answer").toBeTruthy()
    const reviewedIds = first!.provenance!.claimIds!
    expect(first!.provenance!.claims.every((claim) => claim.verificationMethod !== "human_reviewed")).toBe(true)

    // A person reviews every claim of that answer as supported.
    await openReviewer(page)
    for (const id of reviewedIds) {
      const card = page.getByTestId(`queue-claim-${id}`)
      if (await card.count()) {
        await card.getByRole("button", { name: "Supported" }).click()
        await expect(page.getByText(`claim #${id}: supported.`)).toBeVisible({ timeout: 30_000 })
      }
    }

    // Run two, a fresh run: an exact restatement reuses the review. Wording may
    // vary between model calls; only an exact match may be reused.
    let reused = false
    for (let attempt = 0; attempt < 8 && !reused; attempt += 1) {
      const next = await ask()
      if (!released(next)) continue
      const methods = next.provenance!.claims.map((claim) => claim.verificationMethod)
      const exact = next.provenance!.claimIds!.filter((id) => reviewedIds.includes(id))
      if (methods.includes("human_reviewed") && exact.length > 0) {
        reused = true
        // The reviewed claim is referenced, not copied: it is still the original row.
        for (const id of exact) {
          const row = await rowById("ai_evidence_claim", id)
          expect(row.verification_method).toBe("human_reviewed")
          expect(identityHex(row.reviewer_uid)).toBeTruthy()
        }
      }
    }
    expect(reused, "a fresh run reused an exactly matching human-reviewed claim").toBe(true)
  })
})

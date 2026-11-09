import assert from "node:assert/strict"
import { afterEach, beforeEach, test } from "node:test"
import {
  createLumiereApiClient,
  registerLumiereApiClient,
} from "@lumiere/api-client"
import { dispatchDocumentLocationCommand } from "../operations/document-location-commands"
import type { DocumentLocationAction } from "./document-location-effect"

beforeEach(() => {
  registerLumiereApiClient(
    createLumiereApiClient({ baseUrl: "http://api.test", credentials: "omit" }),
  )
})

afterEach(() => registerLumiereApiClient(null))

const largeId = "18446744073709551615"
const largeParent = 9007199254740993n
const cases = [
  {
    action: { kind: "moveFolder", id: 41n, parentId: largeParent },
    operationId: "erp.move_document_folder",
    body: { folderId: 41, parentId: "9007199254740993" },
  },
  {
    action: { kind: "trashFolder", id: largeId },
    operationId: "erp.trash_document_folder",
    body: { folderId: largeId },
  },
  {
    action: { kind: "restoreFolder", id: largeId, parentId: null },
    operationId: "erp.restore_document_folder",
    body: { folderId: largeId, parentId: null },
  },
  {
    action: { kind: "moveDocument", id: largeId, folderId: null },
    operationId: "erp.move_document",
    body: { documentId: largeId, folderId: null },
  },
] satisfies Array<{
  action: DocumentLocationAction
  operationId: string
  body: object
}>

for (const { action, operationId, body } of cases) {
  test(`dispatches ${action.kind} through the generated operation registry`, async (context) => {
    const correlationId = "synthetic-location-command"
    const requests = context.mock.method(
      globalThis,
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        assert.equal(
          String(input),
          `http://api.test/api/operations/${operationId}`,
        )
        assert.equal(init?.method, "POST")
        assert.deepEqual(JSON.parse(String(init?.body)), body)
        return Response.json({ ok: true, operationId, correlationId })
      },
    )

    assert.deepEqual(await dispatchDocumentLocationCommand(action), {
      kind: "accepted",
      operationId,
      correlationId,
    })
    assert.equal(requests.mock.callCount(), 1)
  })
}

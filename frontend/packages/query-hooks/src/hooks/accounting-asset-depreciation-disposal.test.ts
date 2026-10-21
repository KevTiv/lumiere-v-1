import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  resolveAccountAssetDepreciationBoardEffect,
  resolveAccountAssetStateEffect,
} from "./accounting/assets"
import { AmbiguousOperationEffectError } from "./operation-effect"

const lines = [
  { id: "102", assetId: "41", companyId: "8", sequence: 2 },
  { id: "101", asset_id: "41", company_id: "8", sequence: 1 },
] as const

describe("COV-08d2 fixed-asset exact effects", () => {
  it("resolves one contiguous company-scoped depreciation board by asset id", () => {
    assert.deepEqual(
      resolveAccountAssetDepreciationBoardEffect(lines, 8n, 41n),
      {
        resource: "depreciation-lines",
        id: "41",
        lineIds: ["101", "102"],
      },
    )
  })

  it("fails closed for an incomplete or mis-scoped depreciation board", () => {
    assert.equal(
      resolveAccountAssetDepreciationBoardEffect(
        [{ id: "101", assetId: "41", companyId: "9", sequence: 1 }],
        8n,
        41n,
      ),
      null,
    )
    assert.equal(
      resolveAccountAssetDepreciationBoardEffect(
        [
          { id: "101", assetId: "41", companyId: "8", sequence: 1 },
          { id: "103", assetId: "41", companyId: "8", sequence: 3 },
        ],
        8n,
        41n,
      ),
      null,
    )
  })

  it("rejects duplicate board identity or sequence", () => {
    assert.throws(
      () =>
        resolveAccountAssetDepreciationBoardEffect(
          [
            { id: "101", assetId: "41", companyId: "8", sequence: 1 },
            { id: "101", assetId: "41", companyId: "8", sequence: 2 },
          ],
          8n,
          41n,
        ),
      AmbiguousOperationEffectError,
    )
    assert.throws(
      () =>
        resolveAccountAssetDepreciationBoardEffect(
          [
            { id: "101", assetId: "41", companyId: "8", sequence: 1 },
            { id: "102", assetId: "41", companyId: "8", sequence: 1 },
          ],
          8n,
          41n,
        ),
      AmbiguousOperationEffectError,
    )
  })

  it("resolves disposal only when the same asset reads back Removed", () => {
    assert.deepEqual(
      resolveAccountAssetStateEffect(
        [{ id: "41", companyId: "8", state: { tag: "Removed" } }],
        8n,
        41n,
        "Removed",
      ),
      { resource: "account-assets", id: "41" },
    )
    assert.equal(
      resolveAccountAssetStateEffect(
        [{ id: "41", companyId: "8", state: { tag: "Running" } }],
        8n,
        41n,
        "Removed",
      ),
      null,
    )
  })
})

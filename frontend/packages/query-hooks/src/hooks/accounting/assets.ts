"use client"


import { decodeOperationDispatch } from "@lumiere/api-client"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import type {
  AccountAccountTypeQueryRow,
  AccountAccountQueryRow,
  AccountJournalQueryRow,
  AccountMoveLineQueryRow,
  AccountMoveQueryRow,
  AccountTaxQueryRow,
} from "@lumiere/stdb/resource-reads"
import { createStdbSdk } from "@lumiere/stdb/sdk"
import { apiFetch, fetchQueryList } from "../../http"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  paymentParamsToJson,
  type ClearablePatch,
} from "@lumiere/erp-shared/accounting-create-params"
import { stdbParamsToJson, encodeOptionalU64 } from "@lumiere/erp-shared/stdb-params-json"
import { parseStrictU64, scalarToU64 as toScalarU64 } from "@lumiere/erp-shared/u64"
import type {
  AccountFiscalYear,
  AccountPeriod,
  AddAccountMoveLineParams,
  AllocatePaymentParams,
  CreateAccountAccountParams,
  CreateAccountAccountTypeParams,
  CreateAccountAssetParams,
  CreateAccountBankStatementParams,
  CreateAccountGroupParams,
  CreateAccountJournalParams,
  CreateAccountMoveParams,
  CreateAccountTaxParams,
  CreateCreditNoteParams,
  CreateCrossoveredBudgetLineParams,
  CreateCrossoveredBudgetParams,
  CreateCurrencyRateParams,
  CreatePaymentAccountParams,
  CreatePaymentFeeParams,
  CreatePaymentParams,
  CreatePaymentTransactionParams,
  CrossoveredBudget,
  DeleteAccountMoveLineParams,
  DeprecateAccountAccountParams,
  ReversePaymentTransactionParams,
  StageBankStatementImportParams,
  UpdateAccountAccountParams,
  UpdateAccountAssetParams,
  UpdateAccountBankStatementParams,
  UpdateAccountAccountTypeParams,
  UpdateAccountGroupParams,
  UpdateAccountJournalParams,
  UpdateAccountTaxParams,
  UpdateCrossoveredBudgetLineParams,
  UpdateCrossoveredBudgetParams,
} from "@lumiere/stdb/types"
import {
  invalidateStdbQueryResources,
  useCompanyScopedTypedQuery,
  useTypedStdbQuery,
} from "../stdb"
import { stdbInvalidationFor } from "@lumiere/contracts/stdb-reducer-invalidation"

import { responseErrorMessage as parseCallError } from "@lumiere/api-client/response-error"
import {
  AmbiguousOperationEffectError,
  executeOperationWithCanonicalReadback,
  requireResolvedOperationEffect,
  type CanonicalRecordRef,
  type ResolvedOperationEffectOutcome,
} from "../operation-effect"
export function useAccountFixedAssets(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean }
) {
  return useTypedStdbQuery("fixed-assets", organizationId, options)
}

export function useCreateAccountAsset(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { companyId: bigint; params: CreateAccountAssetParams }) => {
      const { urlPath, init } = stdbBffCommandPost("create_account_asset", {
        companyId: args.companyId,
        // No struct name: the option-field table lists a stale `salvage_move_id` that is not a field of
        // CreateAccountAssetParams, so the encoder would send an unknown field. Callers spell every
        // Option field as SATS `{some}` / `{none: []}` (see accounting/asset-actions.ts).
        params: stdbParamsToJson(args.params as object),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      invalidateStdbQueryResources(qc, organizationId, stdbInvalidationFor("create_account_asset")),
  })
}

export function useUpdateAccountAsset(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      companyId: bigint
      assetId: bigint
      params: UpdateAccountAssetParams
    }) => {
      const { urlPath, init } = stdbBffCommandPost("update_account_asset", {
        companyId: args.companyId,
        assetId: args.assetId,
        params: stdbParamsToJson(args.params as object, "UpdateAccountAssetParams"),
      })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () =>
      invalidateStdbQueryResources(qc, organizationId, stdbInvalidationFor("update_account_asset")),
  })
}

export interface DisposeAccountAssetInput {
  readonly assetId: bigint
  readonly disposalDate: Date
  readonly gainAccountId?: bigint
  readonly lossAccountId?: bigint
}

export function useDisposeAccountAsset(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation<
    ResolvedOperationEffectOutcome<CanonicalRecordRef>,
    Error,
    DisposeAccountAssetInput
  >({
    mutationFn: async (args) => {
      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: async () =>
          resolveAccountAssetStateEffect(
            await fetchQueryList("/api/query/account-assets", "Failed to read fixed asset"),
            companyId,
            args.assetId,
            "Removed",
          ),
        dispatch: async () => {
          const { urlPath, init } = stdbBffCommandPost("dispose_account_asset", {
            companyId,
            assetId: args.assetId,
            params: {
              disposal_date: {
                __timestamp_micros_since_unix_epoch__: args.disposalDate.getTime() * 1000,
              },
              gain_account_id: encodeOptionalU64(args.gainAccountId),
              loss_account_id: encodeOptionalU64(args.lossAccountId),
            },
          })
          return decodeOperationDispatch(
            await apiFetch(urlPath, init),
            "Failed to dispose fixed asset",
          )
        },
        afterDispatch: () =>
          invalidateStdbQueryResources(
            qc,
            organizationId,
            stdbInvalidationFor("dispose_account_asset"),
          ),
        readbackAttempts: 6,
        readbackDelayMs: 150,
      })

      return requireResolvedOperationEffect(outcome)
    },
  })
}

export function useDepreciationLines(
  organizationId: bigint,
  options?: { staleTime?: number; enabled?: boolean },
) {
  return useTypedStdbQuery("depreciation-lines", organizationId, options)
}

export function useDeleteAccountAsset(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (assetId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("delete_account_asset", { companyId: companyId, assetId: assetId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFixedAssetQueries(qc, organizationId),
  })
}

export type AccountAssetLifecycleState = "Running" | "Close" | "Removed"

export interface AccountAssetStateProjection {
  readonly id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly state?: unknown
}


export interface AccountAssetDepreciationLineProjection {
  readonly id?: unknown
  readonly assetId?: unknown
  readonly asset_id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly sequence?: unknown
}

export interface AccountAssetDepreciationBoardRef extends CanonicalRecordRef {
  readonly resource: "depreciation-lines"
  readonly lineIds: readonly string[]
}

function accountAssetStateTag(value: unknown): string {
  if (typeof value === "string") return value
  if (value && typeof value === "object" && !Array.isArray(value) && "tag" in value) {
    return String((value as { tag?: unknown }).tag ?? "")
  }
  return ""
}

/**
 * Exact lifecycle readback for one fixed asset: the same company-scoped asset
 * id must be in the expected state. The account-assets projection carries no
 * organization column; the query route already scopes rows to the session's
 * organization, so company + id + state is the stable identity here.
 */
export function resolveAccountAssetStateEffect(
  rows: readonly AccountAssetStateProjection[],
  companyId: bigint,
  assetId: bigint,
  expected: AccountAssetLifecycleState,
): CanonicalRecordRef | null {
  const matches = rows.filter((row) => parseStrictU64(row.id) === assetId)
  if (matches.length > 1) throw new AmbiguousOperationEffectError(`Expected one fixed asset, found ${matches.length}`)
  const row = matches[0]
  if (!row
    || parseStrictU64(row.companyId ?? row.company_id) !== companyId
    || accountAssetStateTag(row.state) !== expected) return null
  return { resource: "account-assets", id: assetId.toString() }
}


function depreciationSequence(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

/**
 * Exact board readback keyed by the parent asset. A canonical board is a
 * company-scoped, contiguous sequence with unique row identities. The query
 * route already provides organization scope.
 */
export function resolveAccountAssetDepreciationBoardEffect(
  rows: readonly AccountAssetDepreciationLineProjection[],
  companyId: bigint,
  assetId: bigint,
): AccountAssetDepreciationBoardRef | null {
  const matches = rows.filter(
    (row) => parseStrictU64(row.assetId ?? row.asset_id) === assetId,
  )
  if (matches.length === 0) return null

  const normalized = matches.map((row) => {
    const id = parseStrictU64(row.id)
    const rowCompanyId = parseStrictU64(row.companyId ?? row.company_id)
    const sequence = depreciationSequence(row.sequence)
    if (id == null || rowCompanyId !== companyId || sequence == null) return null
    return { id, sequence }
  })
  if (normalized.some((row) => row == null)) return null

  const board = normalized.filter(
    (row): row is { id: bigint; sequence: number } => row != null,
  )
  const ids = new Set(board.map((row) => row.id.toString()))
  const sequences = new Set(board.map((row) => row.sequence))
  if (ids.size !== board.length || sequences.size !== board.length) {
    throw new AmbiguousOperationEffectError(
      "Depreciation board contains duplicate identity or sequence",
    )
  }

  board.sort((left, right) => left.sequence - right.sequence)
  if (board.some((row, index) => row.sequence !== index + 1)) return null

  return {
    resource: "depreciation-lines",
    id: assetId.toString(),
    lineIds: board.map((row) => row.id.toString()),
  }
}

async function readAccountAssetStateEffect(
  companyId: bigint,
  assetId: bigint,
  expected: AccountAssetLifecycleState,
): Promise<CanonicalRecordRef> {
  const rows = await fetchQueryList("/api/query/account-assets", "Failed to read fixed asset")
  const effect = resolveAccountAssetStateEffect(rows, companyId, assetId, expected)
  if (!effect) throw new Error(`Fixed asset did not read back as ${expected}`)
  return effect
}

export function useConfirmAccountAsset(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (assetId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("confirm_account_asset", { companyId: companyId, assetId: assetId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
      return readAccountAssetStateEffect(companyId, assetId, "Running")
    },
    onSuccess: () => invalidateFixedAssetQueries(qc, organizationId),
  })
}

export function useCloseAccountAsset(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (assetId: bigint) => {
      const { urlPath, init } = stdbBffCommandPost("close_account_asset", { companyId: companyId, assetId: assetId })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
      return readAccountAssetStateEffect(companyId, assetId, "Close")
    },
    onSuccess: () => invalidateFixedAssetQueries(qc, organizationId),
  })
}

export function useSetAccountAssetActive(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { assetId: bigint; active: boolean }) => {
      const { urlPath, init } = stdbBffCommandPost("set_asset_active", { companyId: companyId, assetId: args.assetId, active: args.active })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFixedAssetQueries(qc, organizationId),
  })
}

export function useCreateDepreciationLine(organizationId: number, companyId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: Record<string, unknown>) => {
      const { urlPath, init } = stdbBffCommandPost("create_depreciation_line", { companyId: companyId, params: stdbParamsToJson(params as object) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error(await parseCallError(r))
    },
    onSuccess: () => invalidateFixedAssetQueries(qc, organizationId),
  })
}

export function useComputeDepreciationBoard(
  organizationId: number,
  companyId: bigint,
) {
  const qc = useQueryClient()
  return useMutation<
    ResolvedOperationEffectOutcome<AccountAssetDepreciationBoardRef>,
    Error,
    bigint
  >({
    mutationFn: async (assetId) => {
      const resolveEffect = async () =>
        resolveAccountAssetDepreciationBoardEffect(
          await fetchQueryList(
            "/api/query/depreciation-lines",
            "Failed to read depreciation board",
          ),
          companyId,
          assetId,
        )

      const outcome = await executeOperationWithCanonicalReadback({
        // Board computation is intentionally non-replayable: arbitrary manual
        // depreciation rows are not proof that this command already ran.
        resolveBeforeDispatch: false,
        resolveEffect,
        dispatch: async () => {
          const { urlPath, init } = stdbBffCommandPost(
            "compute_depreciation_board",
            { companyId, assetId },
          )
          return decodeOperationDispatch(
            await apiFetch(urlPath, init),
            "Failed to compute depreciation board",
          )
        },
        afterDispatch: () => invalidateFixedAssetQueries(qc, organizationId),
        readbackAttempts: 6,
        readbackDelayMs: 150,
      })

      return requireResolvedOperationEffect(outcome)
    },
  })
}

export function invalidateFixedAssetQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint | number) {
  const k = organizationId
  void qc.invalidateQueries({ queryKey: ["stdb", "fixed-assets", k] })
  void qc.invalidateQueries({ queryKey: ["stdb", "depreciation-lines", k] })
}

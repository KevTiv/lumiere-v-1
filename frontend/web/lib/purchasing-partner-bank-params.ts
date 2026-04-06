/**
 * Partner bank forms → SpacetimeDB reducer params.
 */

import type { CreatePartnerBankParams, UpdatePartnerBankParams } from '@lumiere/stdb/generated/types'

import { stdbParamsToJson } from '@/lib/stdb-params-json'

function numU64(v: unknown): bigint | null {
  if (v == null || v === '') return null
  const n = typeof v === 'bigint' ? v : BigInt(Math.trunc(Number(v)))
  if (n < 0n) return null
  return n
}

export function toCreatePartnerBankParams(
  formData: Record<string, unknown>,
  companyId?: bigint,
): CreatePartnerBankParams | null {
  const partnerId = numU64(formData.partnerId)
  const accNumber = String(formData.accNumber ?? '').trim()
  if (partnerId == null || !accNumber) return null

  return {
    partnerId,
    accNumber,
    accHolderName:
      formData.accHolderName != null && String(formData.accHolderName).trim() !== ''
        ? String(formData.accHolderName)
        : undefined,
    bankId: numU64(formData.bankId) ?? undefined,
    currencyId: numU64(formData.currencyId) ?? undefined,
    companyId: companyId ?? undefined,
    allowOutPayment: Boolean(formData.allowOutPayment),
    sequence: undefined,
    journalId: numU64(formData.journalId) ?? undefined,
    metadata: undefined,
  }
}

export function createPartnerBankParamsJson(
  formData: Record<string, unknown>,
  companyId?: bigint,
): Record<string, unknown> | null {
  const p = toCreatePartnerBankParams(formData, companyId)
  if (!p) return null
  return stdbParamsToJson(p)
}

export function toUpdatePartnerBankParams(
  formData: Record<string, unknown>,
): { bankId: bigint; params: Record<string, unknown> } | null {
  const bankId = numU64(formData.bankId)
  if (bankId == null) return null

  const accRaw = formData.accNumber
  const accNumber =
    accRaw != null && String(accRaw).trim() !== '' ? String(accRaw).trim() : undefined

  const holderRaw = formData.accHolderName
  const accHolderName =
    holderRaw != null && String(holderRaw).trim() !== '' ? String(holderRaw) : undefined

  const params: UpdatePartnerBankParams = {
    accNumber,
    accHolderName,
    allowOutPayment:
      formData.allowOutPayment === undefined ? undefined : Boolean(formData.allowOutPayment),
    active: formData.active === undefined ? undefined : Boolean(formData.active),
  }

  return { bankId, params: stdbParamsToJson(params) }
}

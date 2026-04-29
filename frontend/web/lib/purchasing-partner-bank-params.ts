/**
 * Partner bank forms → SpacetimeDB reducer params.
 */

import type { CreatePartnerBankParams } from '@lumiere/stdb/generated/types'

function numU64(v: unknown): bigint | null {
  if (v == null || v === '') return null
  const n = typeof v === 'bigint' ? v : BigInt(Math.trunc(Number(v)))
  if (n < 0n) return null
  return n
}

export function toCreatePartnerBankParams(
  formData: Record<string, unknown>,
): CreatePartnerBankParams | null {
  const partnerId = numU64(formData.partnerId)
  const accStr = String(formData.accNumber ?? '')
  if (partnerId == null || accStr.trim() === '') return null

  return {
    partnerId,
    accNumber: accStr.trim(),
    accHolderName:
      formData.accHolderName != null && String(formData.accHolderName).trim() !== ''
        ? String(formData.accHolderName)
        : undefined,
    currencyId: numU64(formData.currencyId) ?? undefined,
    allowOutPayment: Boolean(formData.allowOutPayment),
  }
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

  return {
    bankId,
    params: {
      accNumber,
      accHolderName,
      allowOutPayment:
        formData.allowOutPayment === undefined ? undefined : Boolean(formData.allowOutPayment),
      active: formData.active === undefined ? undefined : Boolean(formData.active),
    } as Record<string, unknown>,
  }
}

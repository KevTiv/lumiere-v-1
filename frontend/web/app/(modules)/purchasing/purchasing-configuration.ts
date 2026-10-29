
import { i18n } from "@lumiere/i18n"
import { workflowDelegationMetadata } from "@lumiere/erp-shared/workflow-delegation"

export const PURCHASING_CONFIGURATION_KINDS = [
  "contract",
  "scorecard",
  "riskFlag",
  "approvalDelegate",
  "commodityIndex",
  "consignment",
  "integrationIntent",
] as const

export type PurchasingConfigurationKind =
  (typeof PURCHASING_CONFIGURATION_KINDS)[number]

export type PurchasingConfigurationValues = Record<string, string | boolean>

export type PurchasingConfigurationSubmission =
  | {
      kind: "contract"
      params: {
        name: string
        partnerId: bigint
        dateStart: string | null
        dateEnd: string | null
        metadata: null
      }
    }
  | {
      kind: "scorecard"
      params: {
        partnerId: bigint
        otifScore: number
        qualityScore: number
        metadata: null
      }
    }
  | {
      kind: "riskFlag"
      params: {
        partnerId: bigint
        isFlagged: boolean
        riskLevel: string
        reason: string | null
        metadata: null
      }
    }
  | {
      kind: "approvalDelegate"
      params: {
        principalIdentity: string
        delegateIdentity: string
        isActive: boolean
        metadata: string | null
      }
    }
  | {
      kind: "commodityIndex"
      params: {
        code: string
        rate: number
        asOf: string
        metadata: null
      }
    }
  | {
      kind: "consignment"
      params: {
        name: string
        partnerId: bigint
        productId: bigint
        warehouseId: bigint
        metadata: null
      }
    }
  | {
      kind: "integrationIntent"
      params: {
        provider: string
        intentType: string
        purchaseOrderId: bigint | null
        idempotencyKey: string
        requestPayload: string | null
        metadata: null
      }
    }

function required(values: PurchasingConfigurationValues, key: string, label: string) {
  const value = String(values[key] ?? "").trim()
  if (!value) throw new Error(i18n.t("purchasing.purchasingConfiguration.isRequired", { value1: label }))
  return value
}

function requiredU64(
  values: PurchasingConfigurationValues,
  key: string,
  label: string,
): bigint {
  const value = required(values, key, label)
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(i18n.t("purchasing.purchasingConfiguration.mustBeAPositiveId", { value1: label }))
  }
  return BigInt(value)
}

function optionalU64(
  values: PurchasingConfigurationValues,
  key: string,
  label: string,
): bigint | null {
  const value = String(values[key] ?? "").trim()
  if (!value) return null
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(i18n.t("purchasing.purchasingConfiguration.mustBeAPositiveId", { value1: label }))
  }
  return BigInt(value)
}

function boundedScore(
  values: PurchasingConfigurationValues,
  key: string,
  label: string,
): number {
  const value = Number(required(values, key, label))
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(i18n.t("purchasing.purchasingConfiguration.mustBeBetween0And100", { value1: label }))
  }
  return value
}

function finiteNumber(
  values: PurchasingConfigurationValues,
  key: string,
  label: string,
): number {
  const value = Number(required(values, key, label))
  if (!Number.isFinite(value)) throw new Error(i18n.t("purchasing.purchasingConfiguration.mustBeANumber", { value1: label }))
  return value
}

export function initialPurchasingConfigurationValues(
  kind: PurchasingConfigurationKind,
): PurchasingConfigurationValues {
  if (kind === "scorecard") return { otifScore: "95", qualityScore: "90" }
  if (kind === "riskFlag") return { isFlagged: true, riskLevel: "medium" }
  if (kind === "approvalDelegate") return { isActive: true }
  if (kind === "commodityIndex") {
    return { asOf: new Date().toISOString().slice(0, 10), rate: "1" }
  }
  return {}
}

export function buildPurchasingConfigurationSubmission(
  kind: PurchasingConfigurationKind,
  values: PurchasingConfigurationValues,
): PurchasingConfigurationSubmission {
  switch (kind) {
    case "contract": {
      const dateStart = String(values.dateStart ?? "").trim() || null
      const dateEnd = String(values.dateEnd ?? "").trim() || null
      if (dateStart && dateEnd && dateStart > dateEnd) {
        throw new Error(i18n.t("purchasing.purchasingConfiguration.endDateMustBeOnOrAfterStartDate"))
      }
      return {
        kind,
        params: {
          name: required(values, "name", i18n.t("purchasing.purchasingConfiguration.fields.contractName")),
          partnerId: requiredU64(values, "partnerId", i18n.t("purchasing.purchasingConfiguration.fields.vendor")),
          dateStart,
          dateEnd,
          metadata: null,
        },
      }
    }
    case "scorecard":
      return {
        kind,
        params: {
          partnerId: requiredU64(values, "partnerId", i18n.t("purchasing.purchasingConfiguration.fields.vendor")),
          otifScore: boundedScore(values, "otifScore", i18n.t("purchasing.purchasingConfiguration.fields.oTIFScore")),
          qualityScore: boundedScore(values, "qualityScore", i18n.t("purchasing.purchasingConfiguration.fields.qualityScore")),
          metadata: null,
        },
      }
    case "riskFlag":
      return {
        kind,
        params: {
          partnerId: requiredU64(values, "partnerId", i18n.t("purchasing.purchasingConfiguration.fields.vendor")),
          isFlagged: values.isFlagged === true,
          riskLevel: required(values, "riskLevel", i18n.t("purchasing.purchasingConfiguration.fields.riskLevel")),
          reason: String(values.reason ?? "").trim() || null,
          metadata: null,
        },
      }
    case "approvalDelegate": {
      const principalIdentity = required(
        values,
        "principalIdentity",
        "Principal identity",
      ).replace(/^0x/i, "").toLowerCase()
      const delegateIdentity = required(
        values,
        "delegateIdentity",
        "Delegate identity",
      ).replace(/^0x/i, "").toLowerCase()
      if (principalIdentity === delegateIdentity) {
        throw new Error(i18n.t("purchasing.purchasingConfiguration.principalAndDelegateMustBeDifferentUsers"))
      }
      if (!/^[0-9a-f]{64}$/.test(principalIdentity) || !/^[0-9a-f]{64}$/.test(delegateIdentity)) {
        throw new Error(i18n.t("purchasing.purchasingConfiguration.principalAndDelegateMustBeValidIdentities"))
      }
      return {
        kind,
        params: {
          principalIdentity,
          delegateIdentity,
          isActive: values.isActive === true,
          metadata: values.isActive === true
            ? workflowDelegationMetadata(String(values.validFrom ?? ""), String(values.validUntil ?? ""), String(values.reason ?? ""))
            : null,
        },
      }
    }
    case "commodityIndex":
      return {
        kind,
        params: {
          code: required(values, "code", i18n.t("purchasing.purchasingConfiguration.fields.commodityCode")),
          rate: finiteNumber(values, "rate", i18n.t("purchasing.purchasingConfiguration.fields.rate")),
          asOf: required(values, "asOf", i18n.t("purchasing.purchasingConfiguration.fields.asOfDate")),
          metadata: null,
        },
      }
    case "consignment":
      return {
        kind,
        params: {
          name: required(values, "name", i18n.t("purchasing.purchasingConfiguration.fields.agreementName")),
          partnerId: requiredU64(values, "partnerId", i18n.t("purchasing.purchasingConfiguration.fields.vendor")),
          productId: requiredU64(values, "productId", i18n.t("purchasing.purchasingConfiguration.fields.product")),
          warehouseId: requiredU64(values, "warehouseId", i18n.t("purchasing.purchasingConfiguration.fields.warehouse")),
          metadata: null,
        },
      }
    case "integrationIntent":
      return {
        kind,
        params: {
          provider: required(values, "provider", i18n.t("purchasing.purchasingConfiguration.fields.provider")),
          intentType: required(values, "intentType", i18n.t("purchasing.purchasingConfiguration.fields.intentType")),
          purchaseOrderId: optionalU64(
            values,
            "purchaseOrderId",
            "Purchase order",
          ),
          idempotencyKey: required(
            values,
            "idempotencyKey",
            "Idempotency key",
          ),
          requestPayload: String(values.requestPayload ?? "").trim() || null,
          metadata: null,
        },
      }
  }
}

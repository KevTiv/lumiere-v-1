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
        metadata: null
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
  if (!value) throw new Error(`${label} is required`)
  return value
}

function requiredU64(
  values: PurchasingConfigurationValues,
  key: string,
  label: string,
): bigint {
  const value = required(values, key, label)
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(`${label} must be a positive id`)
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
    throw new Error(`${label} must be a positive id`)
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
    throw new Error(`${label} must be between 0 and 100`)
  }
  return value
}

function finiteNumber(
  values: PurchasingConfigurationValues,
  key: string,
  label: string,
): number {
  const value = Number(required(values, key, label))
  if (!Number.isFinite(value)) throw new Error(`${label} must be a number`)
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
        throw new Error("End date must be on or after start date")
      }
      return {
        kind,
        params: {
          name: required(values, "name", "Contract name"),
          partnerId: requiredU64(values, "partnerId", "Vendor"),
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
          partnerId: requiredU64(values, "partnerId", "Vendor"),
          otifScore: boundedScore(values, "otifScore", "OTIF score"),
          qualityScore: boundedScore(values, "qualityScore", "Quality score"),
          metadata: null,
        },
      }
    case "riskFlag":
      return {
        kind,
        params: {
          partnerId: requiredU64(values, "partnerId", "Vendor"),
          isFlagged: values.isFlagged === true,
          riskLevel: required(values, "riskLevel", "Risk level"),
          reason: String(values.reason ?? "").trim() || null,
          metadata: null,
        },
      }
    case "approvalDelegate": {
      const principalIdentity = required(
        values,
        "principalIdentity",
        "Principal identity",
      )
      const delegateIdentity = required(
        values,
        "delegateIdentity",
        "Delegate identity",
      )
      if (principalIdentity === delegateIdentity) {
        throw new Error("Principal and delegate must be different users")
      }
      return {
        kind,
        params: {
          principalIdentity,
          delegateIdentity,
          isActive: values.isActive === true,
          metadata: null,
        },
      }
    }
    case "commodityIndex":
      return {
        kind,
        params: {
          code: required(values, "code", "Commodity code"),
          rate: finiteNumber(values, "rate", "Rate"),
          asOf: required(values, "asOf", "As-of date"),
          metadata: null,
        },
      }
    case "consignment":
      return {
        kind,
        params: {
          name: required(values, "name", "Agreement name"),
          partnerId: requiredU64(values, "partnerId", "Vendor"),
          productId: requiredU64(values, "productId", "Product"),
          warehouseId: requiredU64(values, "warehouseId", "Warehouse"),
          metadata: null,
        },
      }
    case "integrationIntent":
      return {
        kind,
        params: {
          provider: required(values, "provider", "Provider"),
          intentType: required(values, "intentType", "Intent type"),
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

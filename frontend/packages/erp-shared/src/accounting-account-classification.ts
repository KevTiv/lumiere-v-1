export type ManualInvoiceLineAccountType = "Income" | "Expense"

export type InvoiceAccountClassificationRow = {
  organizationId?: bigint | number | string
  companyId?: bigint | number | string
  userTypeId?: bigint | number | string
  internalType?: unknown
  internalGroup?: unknown
}

export type InvoiceAccountTypeClassificationRow = {
  id: bigint | number | string
  organizationId?: bigint | number | string
  companyId?: bigint | number | string | null
  internalGroup?: unknown
  type?: string
  type_?: string
  isDeprecated?: boolean
  is_deprecated?: boolean
}

export type ManualInvoiceTaxPostingAccountRow = {
  companyId?: bigint | number | string
  deprecated?: boolean
  internalType?: unknown
  internalGroup?: unknown
  currencyId?: bigint | number | string | null
}

function enumTag(value: unknown): string {
  if (typeof value === "string") return value
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("tag" in value) return String(value.tag ?? "")
    const keys = Object.keys(value)
    if (keys.length === 1) return keys[0] ?? ""
  }
  return ""
}

/** Mirror the manual-invoice reducer's ordered income/expense classification. */
export function accountMatchesManualInvoiceLineType(
  account: InvoiceAccountClassificationRow,
  accountTypes: readonly InvoiceAccountTypeClassificationRow[],
  expectedType: ManualInvoiceLineAccountType,
): boolean {
  if (account.internalType != null) {
    return enumTag(account.internalType) === expectedType
  }
  if (account.internalGroup != null) {
    return enumTag(account.internalGroup) === expectedType
  }

  const accountType = accountTypes.find(
    (candidate) => String(candidate.id) === String(account.userTypeId),
  )
  if (
    accountType == null ||
    String(accountType.organizationId) !== String(account.organizationId) ||
    (accountType.companyId != null &&
      String(accountType.companyId) !== String(account.companyId)) ||
    accountType.isDeprecated === true ||
    accountType.is_deprecated === true
  ) {
    return false
  }

  return (
    enumTag(accountType.internalGroup) === expectedType ||
    String(accountType.type ?? accountType.type_ ?? "").trim().toLowerCase() ===
      expectedType.toLowerCase()
  )
}

/** Mirror the manual-invoice reducer's tax posting-account eligibility rules. */
export function accountIsEligibleManualInvoiceTaxPosting(
  account: ManualInvoiceTaxPostingAccountRow,
  companyId: bigint | number | string,
  currencyId: bigint | number | string,
): boolean {
  const internalType = enumTag(account.internalType)
  return (
    String(account.companyId) === String(companyId) &&
    account.deprecated === false &&
    internalType !== "Receivable" &&
    internalType !== "Payable" &&
    (account.currencyId == null || String(account.currencyId) === String(currencyId))
  )
}

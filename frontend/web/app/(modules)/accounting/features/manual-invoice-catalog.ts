import type { ResourceQueryRowMap } from "@lumiere/stdb/resource-reads"
import type { QueryRowFor } from "@lumiere/stdb/query-row-map"
import { accountJournalRowsToSelectOptions } from "@/lib/form-lookup"
import { enumTag } from "@/lib/accounting-post-draft"
import {
  accountIsEligibleManualInvoiceTaxPosting,
  accountMatchesManualInvoiceLineType,
} from "@lumiere/erp-shared"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"
// Preserve the existing legacy field aliases inside the catalog boundary.
// Public inputs remain the canonical generated resource rows.
type ManualInvoiceAccountLookup = {
  readonly id?: unknown
  readonly code?: unknown
  readonly name?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly deprecated?: unknown
  readonly isOffBalance?: unknown
  readonly internalType?: unknown
  readonly internalGroup?: unknown
  readonly allowedJournalIds?: unknown
  readonly currencyId?: unknown
  readonly currency_id?: unknown
}
type ManualInvoicePartnerLookup = {
  readonly id?: unknown
  readonly name?: unknown
  readonly displayName?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly deletedAt?: unknown
  readonly deleted_at?: unknown
  readonly isCustomer?: unknown
  readonly customerRank?: unknown
  readonly isVendor?: unknown
  readonly supplierRank?: unknown
}
type ManualInvoiceJournalLookup = {
  readonly id?: unknown
  readonly name?: unknown
  readonly code?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly active?: unknown
  readonly type?: unknown
  readonly type_?: unknown
  readonly currencyId?: unknown
  readonly currency_id?: unknown
  readonly defaultAccountId?: unknown
  readonly default_account_id?: unknown
}
type ManualInvoiceTaxGroupLookup = {
  readonly id?: unknown
  readonly taxPayableAccountId?: unknown
  readonly tax_payable_account_id?: unknown
  readonly taxReceivableAccountId?: unknown
  readonly tax_receivable_account_id?: unknown
}
type ManualInvoiceTaxLookup = {
  readonly id?: unknown
  readonly name?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly active?: unknown
  readonly typeTaxUse?: unknown
  readonly type_tax_use?: unknown
  readonly priceInclude?: unknown
  readonly hasNegativeFactor?: unknown
  readonly amount?: unknown
  readonly amountType?: unknown
  readonly amount_type?: unknown
  readonly taxGroupId?: unknown
  readonly tax_group_id?: unknown
}

interface ManualInvoiceCatalogInput {
  accounts: readonly ResourceQueryRowMap["account-accounts"][]
  contacts: readonly Pick<
    QueryRowFor<"contacts">,
    | "id"
    | "organizationId"
    | "companyId"
    | "name"
    | "displayName"
    | "isCustomer"
    | "customerRank"
    | "isVendor"
    | "supplierRank"
    | "deletedAt"
  >[]
  defaultCurrencyId: bigint
  journals: readonly ResourceQueryRowMap["account-journals"][]
  operatingCompanyId: bigint
  products: readonly QueryRowFor<"products">[]
  taxGroups: readonly ResourceQueryRowMap["tax-groups"][]
  taxes: readonly ResourceQueryRowMap["account-taxes"][]
}

interface ManualInvoiceAccountChoicesInput {
  accountTypes: readonly ResourceQueryRowMap["account-account-types"][]
  accounts: readonly ResourceQueryRowMap["account-accounts"][]
  manualInvoiceCurrencyId: bigint
  operatingCompanyId: bigint
}

interface ManualInvoiceJournalChoicesInput {
  journals: readonly ResourceQueryRowMap["account-journals"][]
  manualInvoiceCurrencyId: bigint
  operatingCompanyId: bigint
}

interface ManualInvoiceTaxChoicesInput {
  accounts: readonly ResourceQueryRowMap["account-accounts"][]
  manualInvoiceCurrencyId: bigint
  operatingCompanyId: bigint
  taxGroups: readonly ResourceQueryRowMap["tax-groups"][]
  taxes: readonly ResourceQueryRowMap["account-taxes"][]
}

export function buildManualInvoiceCatalog({
  accounts,
  contacts,
  defaultCurrencyId,
  journals,
  operatingCompanyId,
  products,
  taxGroups,
  taxes,
}: ManualInvoiceCatalogInput) {
  const companyKey = String(operatingCompanyId)
  const accountLabel = (row: ManualInvoiceAccountLookup) =>
    `${String(row.code ?? "").trim() ? `${String(row.code)} — ` : ""}${String(row.name ?? row.id ?? "")}`
  const allowedJournals = (row: ManualInvoiceAccountLookup) =>
    Array.isArray(row.allowedJournalIds) ? row.allowedJournalIds.map(String) : []
  const accountsFor = (kind: "invoice" | "bill", counterpart: boolean) =>
    (accounts as readonly ManualInvoiceAccountLookup[])
      .filter((row) => String(row.companyId ?? row.company_id ?? "") === companyKey)
      .filter((row) => row.deprecated === false && row.isOffBalance === false && Array.isArray(row.allowedJournalIds))
      .filter((row) => Object.hasOwn(row, "currencyId") || Object.hasOwn(row, "currency_id"))
      .filter((row) => row.currencyId == null && row.currency_id == null || Boolean(parseStrictU64(row.currencyId ?? row.currency_id)))
      .filter(
        (row) =>
          enumTag(counterpart ? row.internalType : row.internalGroup) ===
          (counterpart
            ? kind === "invoice"
              ? "Receivable"
              : "Payable"
            : kind === "invoice"
              ? "Income"
              : "Expense"),
      )
      .map((row) => ({
        value: String(row.id),
        label: accountLabel(row),
        allowedJournalIds: allowedJournals(row),
        currencyId: row.currencyId == null && row.currency_id == null ? undefined : String(row.currencyId ?? row.currency_id),
      }))
  const partnersFor = (kind: "invoice" | "bill") =>
    (contacts as readonly ManualInvoicePartnerLookup[])
      .filter((row) => row.deletedAt == null && row.deleted_at == null)
      .filter((row) => {
        const rowCompany = row.companyId ?? row.company_id
        return rowCompany == null || String(rowCompany) === companyKey
      })
      .filter((row) =>
        kind === "invoice"
          ? row.isCustomer === true || Number(row.customerRank ?? 0) > 0
          : row.isVendor === true || Number(row.supplierRank ?? 0) > 0,
      )
      .map((row) => ({
        value: String(row.id),
        label: String(row.displayName ?? row.name ?? row.id),
      }))
  const journalsFor = (kind: "invoice" | "bill") =>
    (journals as readonly ManualInvoiceJournalLookup[])
      .filter(
        (row) =>
          String(row.companyId ?? row.company_id ?? "") === companyKey && row.active === true,
      )
      .filter(
        (row) => enumTag(row.type ?? row.type_) === (kind === "invoice" ? "Sale" : "Purchase"),
      )
      .filter((row) => Object.hasOwn(row, "currencyId") || Object.hasOwn(row, "currency_id"))
      .filter((row) => Boolean(parseStrictU64(row.currencyId ?? row.currency_id ?? defaultCurrencyId)))
      .map((row) => ({
        value: String(row.id),
        label: `${String(row.code ?? "").trim() ? `${String(row.code)} — ` : ""}${String(row.name ?? row.id)}`,
        currencyId: String(row.currencyId ?? row.currency_id ?? defaultCurrencyId),
        defaultAccountId: row.defaultAccountId == null && row.default_account_id == null ? undefined : String(row.defaultAccountId ?? row.default_account_id),
      }))
  const taxGroupById = new Map(
    (taxGroups as readonly ManualInvoiceTaxGroupLookup[]).map((row) => [String(row.id), row]),
  )
  const taxesFor = (kind: "invoice" | "bill") =>
    (taxes as readonly ManualInvoiceTaxLookup[])
      .filter(
        (row) =>
          String(row.companyId ?? row.company_id ?? "") === companyKey && row.active !== false,
      )
      .filter((row) =>
        [kind === "invoice" ? "Sale" : "Purchase", "None"].includes(
          enumTag(row.typeTaxUse ?? row.type_tax_use),
        ),
      )
      .filter(
        (row) =>
          row.priceInclude !== true &&
          row.hasNegativeFactor !== true &&
          Number(row.amount ?? 0) >= 0,
      )
      .filter((row) =>
        ["Percent", "Fixed", "Division"].includes(enumTag(row.amountType ?? row.amount_type)),
      )
      .filter((row) => {
        const group = taxGroupById.get(String(row.taxGroupId ?? row.tax_group_id ?? ""))
        return (
          group != null &&
          (kind === "invoice"
            ? (group.taxPayableAccountId ?? group.tax_payable_account_id)
            : (group.taxReceivableAccountId ?? group.tax_receivable_account_id)) != null
        )
      })
      .map((row) => ({
        value: String(row.id),
        label: String(row.name ?? row.id),
        amount: Number(row.amount ?? 0),
        amountType: enumTag(row.amountType ?? row.amount_type) as "Percent" | "Fixed" | "Division",
      }))
  const productsFor = (kind: "invoice" | "bill") =>
    products
      .filter(
        (row) =>
          row.active !== false &&
          (kind === "invoice" ? row.saleOk === true : row.purchaseOk === true),
      )
      .map((row) => ({
        value: String(row.id),
        label: String(row.displayName ?? row.name ?? row.id),
        description: String(
          (kind === "invoice" ? row.descriptionSale : row.descriptionPurchase) ?? row.name ?? "",
        ),
        price: Number(
          kind === "invoice" ? (row.listPrice ?? row.price ?? 0) : (row.standardPrice ?? 0),
        ),
        accountId:
          String(
            (kind === "invoice" ? row.propertyAccountIncomeId : row.propertyAccountExpenseId) ?? "",
          ) || undefined,
        taxIds: (Array.isArray(kind === "invoice" ? row.taxesId : row.supplierTaxesId)
          ? ((kind === "invoice" ? row.taxesId : row.supplierTaxesId) as unknown[])
          : []
        ).map(String),
      }))
  return {
    invoice: {
      journals: journalsFor("invoice"),
      partners: partnersFor("invoice"),
      counterpart: accountsFor("invoice", true),
      commercial: accountsFor("invoice", false),
      taxes: taxesFor("invoice"),
      products: productsFor("invoice"),
    },
    bill: {
      journals: journalsFor("bill"),
      partners: partnersFor("bill"),
      counterpart: accountsFor("bill", true),
      commercial: accountsFor("bill", false),
      taxes: taxesFor("bill"),
      products: productsFor("bill"),
    },
  }
}

export function manualInvoiceAccountChoices({
  accountTypes,
  accounts,
  manualInvoiceCurrencyId,
  operatingCompanyId,
}: ManualInvoiceAccountChoicesInput) {
  const eligibleAccounts = accounts.filter(
    (account) =>
      account.companyId === operatingCompanyId &&
      account.deprecated === false &&
      (account.currencyId == null || account.currencyId === manualInvoiceCurrencyId),
  )
  const toOptions = (rows: typeof accounts) =>
    rows.map((account) => ({
      value: String(account.id),
      label: `${account.code ? `${account.code} — ` : ""}${account.name ?? account.id}`,
    }))
  const lineOptions = (expectedType: "Income" | "Expense") =>
    toOptions(
      eligibleAccounts.filter((account) =>
        accountMatchesManualInvoiceLineType(account, accountTypes, expectedType),
      ),
    )
  const counterpartOptions = (expectedType: "Receivable" | "Payable") =>
    toOptions(eligibleAccounts.filter((account) => enumTag(account.internalType) === expectedType))
  return {
    income: lineOptions("Income"),
    expense: lineOptions("Expense"),
    receivable: counterpartOptions("Receivable"),
    payable: counterpartOptions("Payable"),
  }
}

export function manualInvoiceJournalChoices({
  journals,
  manualInvoiceCurrencyId,
  operatingCompanyId,
}: ManualInvoiceJournalChoicesInput) {
  const eligible = (journalType: "Sale" | "Purchase") =>
    accountJournalRowsToSelectOptions(
      journals.filter(
        (journal) =>
          journal.companyId === operatingCompanyId &&
          journal.active === true &&
          enumTag(journal.type) === journalType &&
          (journal.currencyId == null || journal.currencyId === manualInvoiceCurrencyId),
      ),
    )
  return { sales: eligible("Sale"), purchases: eligible("Purchase") }
}

export function manualInvoiceTaxChoices({
  accounts,
  manualInvoiceCurrencyId,
  operatingCompanyId,
  taxGroups,
  taxes,
}: ManualInvoiceTaxChoicesInput) {
  const accountById = new Map(accounts.map((account) => [account.id, account]))
  const groupById = new Map(taxGroups.map((group) => [group.id, group]))
  const eligible = (taxUse: "Sale" | "Purchase") =>
    taxes
      .filter((tax) => {
        const amount = Number(tax.amount)
        if (
          tax.companyId !== operatingCompanyId ||
          tax.active !== true ||
          tax.hasNegativeFactor === true ||
          enumTag(tax.typeTaxUse) !== taxUse ||
          enumTag(tax.amountType) !== "Percent" ||
          !Number.isFinite(amount) ||
          amount < 0 ||
          amount > 100 ||
          tax.taxGroupId == null
        ) {
          return false
        }
        const group = groupById.get(tax.taxGroupId)
        if (group == null || group.companyId !== operatingCompanyId) return false
        const postingAccountId =
          taxUse === "Sale" ? group.taxPayableAccountId : group.taxReceivableAccountId
        if (postingAccountId == null) return false
        const postingAccount = accountById.get(postingAccountId)
        if (
          postingAccount == null ||
          !accountIsEligibleManualInvoiceTaxPosting(
            postingAccount,
            operatingCompanyId,
            manualInvoiceCurrencyId,
          )
        ) {
          return false
        }
        return true
      })
      .map((tax) => ({
        value: String(tax.id),
        label: `${tax.name} (${Number(tax.amount)}%)`,
        rate: Number(tax.amount),
        priceIncluded: Boolean(tax.priceInclude),
      }))
  return { sales: eligible("Sale"), purchases: eligible("Purchase") }
}

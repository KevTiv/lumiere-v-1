export const ACCOUNT_PURPOSES = [
  {
    value: "receivable",
    label: "Customer balances (receivable)",
    group: "asset",
    reconcile: true,
  },
  {
    value: "payable",
    label: "Supplier balances (payable)",
    group: "liability",
    reconcile: true,
  },
  {
    value: "liquidity",
    label: "Bank or cash",
    group: "asset",
    reconcile: true,
  },
  { value: "asset", label: "Other asset", group: "asset", reconcile: false },
  {
    value: "liability",
    label: "Other liability",
    group: "liability",
    reconcile: false,
  },
  { value: "equity", label: "Equity", group: "equity", reconcile: false },
  { value: "income", label: "Income", group: "income", reconcile: false },
  { value: "expense", label: "Expense", group: "expense", reconcile: false },
] as const

export type AccountPurpose = (typeof ACCOUNT_PURPOSES)[number]["value"]

/** One explicit purpose supplies the classification used by the accounting owner. */
export function accountCreationValues(input: {
  code: string
  name: string
  purpose: AccountPurpose
  openingBalance: string
}) {
  const purpose = ACCOUNT_PURPOSES.find(
    (candidate) => candidate.value === input.purpose,
  )
  if (!purpose) throw new Error("Choose an account purpose")
  const code = input.code.trim()
  const name = input.name.trim()
  if (!code || !name) throw new Error("Account code and name are required")
  const balance =
    input.openingBalance.trim() === "" ? 0 : Number(input.openingBalance)
  if (!Number.isFinite(balance))
    throw new Error("Opening balance must be a finite number")
  return {
    code,
    name,
    internalGroup: purpose.group,
    internalType: purpose.value,
    reconcile: purpose.reconcile,
    openingDebit: balance >= 0 ? balance : 0,
    openingCredit: balance < 0 ? -balance : 0,
  }
}

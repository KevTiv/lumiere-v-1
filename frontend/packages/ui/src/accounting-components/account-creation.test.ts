import { describe, expect, it } from "vitest"
import { ACCOUNT_PURPOSES, accountCreationValues } from "./account-creation"

describe("account creation classification", () => {
  it("creates customer and supplier balances with their required classifications", () => {
    const base = {
      code: "1100",
      name: "Customer balances",
      openingBalance: "0",
    }
    expect(accountCreationValues({ ...base, purpose: "receivable" })).toEqual({
      code: "1100",
      name: "Customer balances",
      internalType: "receivable",
      internalGroup: "asset",
      reconcile: true,
      openingDebit: 0,
      openingCredit: 0,
    })
    expect(
      accountCreationValues({
        ...base,
        purpose: "payable",
        openingBalance: "-4800",
      }),
    ).toMatchObject({
      internalType: "payable",
      internalGroup: "liability",
      reconcile: true,
      openingDebit: 0,
      openingCredit: 4800,
    })
  })

  it("keeps a meaningful explicit classification for every offered purpose", () => {
    for (const purpose of ACCOUNT_PURPOSES) {
      expect(
        accountCreationValues({
          code: "A",
          name: "Test",
          purpose: purpose.value,
          openingBalance: "",
        }),
      ).toMatchObject({
        internalType: purpose.value,
        internalGroup: purpose.group,
        reconcile: purpose.reconcile,
      })
    }
  })

  it("rejects missing identity and malformed balances without replacing them with zero", () => {
    const base = {
      code: "A",
      name: "Test",
      purpose: "income" as const,
      openingBalance: "0",
    }
    expect(() => accountCreationValues({ ...base, code: " " })).toThrow(
      "required",
    )
    expect(() => accountCreationValues({ ...base, name: " " })).toThrow(
      "required",
    )
    for (const balance of ["unknown", "Infinity", "1e999"]) {
      expect(() =>
        accountCreationValues({ ...base, openingBalance: balance }),
      ).toThrow("finite")
    }
  })
})

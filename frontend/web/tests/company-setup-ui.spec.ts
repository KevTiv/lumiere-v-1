import { expect, test } from "@playwright/test"
import type { CompanySetupDraft } from "../lib/company-setup-model"

test("new company setup retains reviewed country, currency, VAT, units and history after refresh", async ({
  page,
}) => {
  const saved: CompanySetupDraft[] = []
  await page.route("**/__fixture/company-setup", async (route) => {
    expect(route.request().method()).toBe("POST")
    saved.push(route.request().postDataJSON() as CompanySetupDraft)
    await route.fulfill({ json: { companyId: "7" } })
  })

  await page.goto("/company-setup?mode=new")
  await expect(page.getByText(/no live ERP effects/)).toBeVisible()
  await page.getByLabel("Company name", { exact: true }).fill("Mugisha Farm")
  await page.getByLabel("Company code", { exact: true }).fill("FARM")
  await page.getByLabel("Country", { exact: true }).fill("RW")
  await page
    .getByLabel("Base currency", { exact: true })
    .selectOption({ label: "RWF — Rwandan Franc" })
  await page
    .getByLabel("VAT registration", { exact: true })
    .selectOption("registered")
  await page
    .getByLabel("Tax / VAT registration number", { exact: true })
    .fill("TIN-FARM")
  await page
    .getByRole("checkbox", { name: "Kilograms (kg)", exact: true })
    .check()
  await page
    .getByLabel("Historical data", { exact: true })
    .selectOption("full-history")
  await page
    .getByRole("button", { name: "Review linked setup", exact: true })
    .click()
  await expect(
    page.getByText("Review before saving", { exact: true }),
  ).toBeVisible()
  expect(saved).toHaveLength(0)

  await page.reload()
  await expect(
    page.getByText("Rwanda · RWF — Rwandan Franc", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText("VAT registered · TIN-FARM", { exact: true }),
  ).toBeVisible()
  await expect(page.getByText("Kilograms (kg)", { exact: true })).toBeVisible()
  await expect(
    page.getByText("Historical transactions as drafts for review", {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByText(
      /Choosing a unit here does not convert quantities or prices/,
    ),
  ).toBeVisible()
  expect(saved).toHaveLength(0)

  await page
    .getByRole("button", { name: "Confirm and create company", exact: true })
    .click()
  await expect(page.getByRole("status")).toContainText("Company details saved")
  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({
    companyId: null,
    countryCode: "RW",
    currencyId: "4",
    taxRegistration: "registered",
    taxId: "TIN-FARM",
    unitIds: ["8"],
    historicalMode: "full-history",
  })
  await expect(
    page.getByRole("link", { name: "Review accounts", exact: true }),
  ).toHaveAttribute("href", "/accounting?tab=accounts&companyId=7")

  await page.reload()
  await expect(page.getByRole("status")).toContainText("Company details saved")
  expect(saved).toHaveLength(1)
})

test("existing company setup resumes an uncertain save without changing its base currency or resubmitting", async ({
  page,
}) => {
  let submission: CompanySetupDraft | null = null
  let saves = 0
  let checks = 0
  await page.route("**/__fixture/company-setup**", async (route) => {
    if (route.request().method() === "POST") {
      saves++
      submission = route.request().postDataJSON() as CompanySetupDraft
      // The synthetic server commits the request, then the connection loses its reply.
      await route.abort("failed")
      return
    }
    checks++
    expect(
      new URL(route.request().url()).searchParams.get("submissionId"),
    ).toBe(submission?.submissionId)
    await route.fulfill({ json: { companyId: submission ? "7" : null } })
  })

  await page.goto("/company-setup")
  const currency = page.getByLabel("Base currency", { exact: true })
  await expect(currency).toBeDisabled()
  await expect(currency).toHaveValue("4")
  await page.getByLabel("Country", { exact: true }).fill("KE")
  await page
    .getByLabel("Historical data", { exact: true })
    .selectOption("opening-balances")
  await page
    .getByRole("button", { name: "Review linked setup", exact: true })
    .click()
  await expect(
    page.getByText("VAT registration still unknown", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText("Still unknown — decide per source row", { exact: true }),
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Confirm company details", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "Check saved company", exact: true }),
  ).toBeVisible()

  await page.reload()
  await expect(
    page.getByRole("button", { name: "Confirm company details", exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByText("Kenya · RWF — Rwandan Franc", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText("Opening balances and outstanding documents", {
      exact: true,
    }),
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Check saved company", exact: true })
    .click()
  await expect(page.getByRole("status")).toContainText("Company details saved")
  expect(saves).toBe(1)
  expect(checks).toBe(1)
  expect(submission).toMatchObject({
    companyId: "7",
    currencyId: "4",
    countryCode: "KE",
    taxRegistration: "unknown",
    unitIds: [],
    historicalMode: "opening-balances",
  })
})

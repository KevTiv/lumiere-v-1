import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { i18n, useTranslation } from "@lumiere/i18n"
import { incidentCategories, reportTemplates, sampleForensicReports } from "./forensic-report-types"
import { onboardingTemplatesTableConfig } from "./hr-entity-configs"
import { warehouseLayer, vehicleLayer } from "./map-pin-configs"
import { newProjectRateCardLineForm } from "./projects-form-configs"
import { SECTION_TEMPLATES } from "./proposal-workspace-types"
import { parseInlineValue } from "./inline-edit"
import { RBACProvider, withPermission } from "./rbac-context"
import { sanitizeDocumentTemplateHtml } from "./document-template-designer"

let frenchResources: Record<string, unknown>
beforeEach(async () => {
  frenchResources = structuredClone(i18n.getResourceBundle("fr", "translation"))
  await i18n.changeLanguage("en")
})
afterEach(async () => {
  cleanup()
  i18n.removeResourceBundle("fr", "translation")
  i18n.addResourceBundle("fr", "translation", frenchResources, true, true)
  await i18n.changeLanguage("en")
})

function ConfigurationLabels() {
  const { t } = useTranslation()
  const form = newProjectRateCardLineForm(t)
  const scope = form.sections.flatMap((section) => section.fields).find((field) => field.name === "scope")
  const employee = scope?.type === "select" ? scope.options.find((option) => option.value === "employee") : undefined
  return <>
    <h1>{onboardingTemplatesTableConfig(t).title}</h1>
    <p>{warehouseLayer.label}</p>
    <p>{incidentCategories["process-failure"].label}</p>
    <p>{employee?.label}</p>
    <p>{SECTION_TEMPLATES[0]?.title}</p>
  </>
}

describe("full workspace configuration translations", () => {
  it("updates rendered map, forensic, project and HR labels while preserving values and sample content", async () => {
    const originalSamples = JSON.stringify(sampleForensicReports)
    const originalSuggestedContent = reportTemplates.map((template) => [...template.suggestedActions, ...template.suggestedRootCauses])
    const staticMap = warehouseLayer
    const vehicleStatus = vehicleLayer.fields.find((field) => field.key === "status")
    render(<ConfigurationLabels />)
    expect(screen.getByRole("heading", { name: "Onboarding templates" })).toBeTruthy()
    const translations = [
      ["hr.builtIn.hrEntityConfigs.onboardingTemplatesTableConfig.onboardingTemplatesTable.title", "Modèles d’intégration"],
      ["map.builtIn.mapPinConfigs.warehouseLayer.warehouse.label", "Entrepôts"],
      ["forensics.builtIn.forensicReportTypes.incidentCategories.processFailure.label", "Défaillance du processus"],
      ["projects.resourceAllocation.columns.employee", "Employé traduit"],
      ["proposals.builtIn.proposalWorkspaceTypes.sectionTemplates.executiveSummary.title", "Résumé de direction"],
      ["common.active", "Actif"],
    ]
    for (const [key, value] of translations) i18n.addResource("fr", "translation", key, value)
    await act(async () => { await i18n.changeLanguage("fr") })
    expect(screen.getByRole("heading", { name: "Modèles d’intégration" })).toBeTruthy()
    expect(screen.getByText("Entrepôts")).toBeTruthy()
    expect(screen.getByText("Défaillance du processus")).toBeTruthy()
    expect(screen.getByText("Employé traduit")).toBeTruthy()
    expect(screen.getByText("Résumé de direction")).toBeTruthy()
    expect(staticMap.label).toBe("Entrepôts")
    expect(staticMap.id).toBe("warehouse")
    expect(vehicleStatus?.badgeLabels?.active).toBe("Actif")
    expect(Object.keys(vehicleStatus?.badgeLabels ?? {})).toEqual(["active", "idle", "maintenance"])
    const translatedForm = newProjectRateCardLineForm(i18n.t.bind(i18n))
    const translatedScope = translatedForm.sections.flatMap((section) => section.fields).find((field) => field.name === "scope")
    expect(translatedScope?.type === "select" ? translatedScope.options.map((option) => option.value) : []).toEqual(["employee", "task", "project"])
    expect(JSON.stringify(sampleForensicReports)).toBe(originalSamples)
    expect(reportTemplates.map((template) => [...template.suggestedActions, ...template.suggestedRootCauses])).toEqual(originalSuggestedContent)
  })

  it("resolves runtime validation in the current language without changing valid document content", async () => {
    i18n.addResource("fr", "translation", "common.inlineEdit.enterNumber", "Saisissez un nombre")
    i18n.addResource("fr", "translation", "documents.builtIn.documentTemplateDesigner.sanitizeTemplateHtml.error", "Le contenu dépasse la limite.")
    expect(parseInlineValue("number", "invalid")).toEqual({ ok: false, error: "Enter a number" })
    await i18n.changeLanguage("fr")
    expect(parseInlineValue("number", "invalid")).toEqual({ ok: false, error: "Saisissez un nombre" })
    expect(parseInlineValue("number", "12.5")).toEqual({ ok: true, value: 12.5 })
    expect(() => sanitizeDocumentTemplateHtml("x".repeat(1_000_001))).toThrow("Le contenu dépasse la limite.")
    expect(sanitizeDocumentTemplateHtml("<p>Customer-authored text</p>")).toBe("<p>Customer-authored text</p>")
  })
  it("updates the permission notice while keeping protected content hidden", async () => {
    const Protected = withPermission(() => <span>Private content</span>, "module:inventory", "read")
    render(<RBACProvider><Protected /></RBACProvider>)
    expect(screen.getByText("You don't have permission to access this resource.")).toBeTruthy()
    expect(screen.queryByText("Private content")).toBeNull()
    i18n.addResource("fr", "translation", "common.permissions.accessDenied", "Accès à cette ressource refusé.")
    await act(async () => { await i18n.changeLanguage("fr") })
    expect(screen.getByText("Accès à cette ressource refusé.")).toBeTruthy()
    expect(screen.queryByText("Private content")).toBeNull()
  })

})

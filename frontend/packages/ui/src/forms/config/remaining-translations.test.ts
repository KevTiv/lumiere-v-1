import { afterEach, describe, expect, it } from "vitest"
import { i18n } from "@lumiere/i18n"
import { inventoryForms } from "./modules/inventory.config"
import { projectsForms } from "./modules/projects.config"

let frenchResources: Record<string, unknown> | undefined

afterEach(async () => {
  if (frenchResources) {
    i18n.removeResourceBundle("fr", "translation")
    i18n.addResourceBundle("fr", "translation", frenchResources, true, true)
    frenchResources = undefined
  }
  await i18n.changeLanguage("en")
})

describe("remaining module form translations", () => {
  it("updates cached product labels and placeholders without changing reducer field names", async () => {
    await i18n.changeLanguage("en")
    frenchResources = structuredClone(i18n.getResourceBundle("fr", "translation"))
    const entry = inventoryForms.find((form) => form.formId === "new-product")!
    const configuration = entry.defaultConfig()
    const field = configuration.fields.find((item) => item.fieldId === "name")!
    const initialValidation = field.validation
    i18n.addResource("fr", "translation", "inventory.forms.newProduct.title", "Nouveau produit traduit")
    i18n.addResource("fr", "translation", "inventory.forms.newProduct.fields.name", "Nom du produit traduit")
    i18n.addResource("fr", "translation", "forms.defaults.inventory.enterProductName", "Saisissez le nom du produit")

    await i18n.changeLanguage("fr")

    expect(entry.name).toBe("Nouveau produit traduit")
    expect(configuration.name).toBe("Nouveau produit traduit")
    expect(field.label).toBe("Nom du produit traduit")
    expect(field.placeholder).toBe("Saisissez le nom du produit")
    expect(field.fieldId).toBe("name")
    expect(field.name).toBe("name")
    expect(field.validation).toBe(initialValidation)
  })

  it("translates project option labels while preserving stored status values", async () => {
    await i18n.changeLanguage("en")
    frenchResources = structuredClone(i18n.getResourceBundle("fr", "translation"))
    const configuration = projectsForms.find((form) => form.formId === "new-project")!.defaultConfig()
    const status = configuration.fields.find((field) => field.options?.some((option) => option.value === "active"))!
    const values = status.options!.map((option) => option.value)
    const active = status.options!.find((option) => option.value === "active")!
    expect(active.label).toBe("Active")
    i18n.addResource("fr", "translation", "common.active", "Actif traduit")

    await i18n.changeLanguage("fr")

    expect(active.label).toBe("Actif traduit")
    expect(active.value).toBe("active")
    expect(status.options!.map((option) => option.value)).toEqual(values)
  })
})

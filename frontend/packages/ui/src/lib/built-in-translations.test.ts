import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { i18n } from "@lumiere/i18n"
import { buildAccountsTableConfig } from "./entity-configs"
import { defaultColumns, priorityConfig } from "./task-board-types"
import { noteTypeConfig } from "./journal-types"

let frenchResources: Record<string, unknown>

beforeEach(async () => {
  frenchResources = structuredClone(i18n.getResourceBundle("fr", "translation"))
  await i18n.changeLanguage("en")
})

afterEach(async () => {
  i18n.removeResourceBundle("fr", "translation")
  i18n.addResourceBundle("fr", "translation", frenchResources, true, true)
  await i18n.changeLanguage("en")
})

describe("built-in Alpha configuration translations", () => {
  it("updates an existing account configuration without changing keys or filter values", async () => {
    const config = buildAccountsTableConfig()
    if (config.view.mode !== "table") throw new Error("Expected account table configuration")
    const status = config.view.filters?.find((filter) => filter.key === "active")
    expect(config.title).toBe("Chart of Accounts")
    expect(status?.options?.[0].value).toBe("true")
    i18n.addResource("fr", "translation", "accounting.builtIn.entityConfigs.buildAccountsTableConfig.accountsTable.title", "Plan comptable")
    i18n.addResource("fr", "translation", "common.active", "Actif")

    await i18n.changeLanguage("fr")

    expect(config.id).toBe("accounts-table")
    expect(config.title).toBe("Plan comptable")
    expect(status?.options?.[0].label).toBe("Actif")
    expect(status?.options?.[0].value).toBe("true")
    expect(config.view.rowKey).toBe("id")
  })

  it("updates cached board and journal labels without changing their enum values", async () => {
    const backlog = defaultColumns[0]
    expect(backlog.title).toBe("Backlog")
    expect(noteTypeConfig.observation.label).toBe("Observation")
    const translations = [
      ["tasks.statuses.backlog", "À traiter"],
      ["tasks.priorities.low", "Faible"],
      ["journal.builtIn.journalTypes.noteTypeConfig.observation.label", "Observation française"],
    ]
    for (const [key, value] of translations) i18n.addResource("fr", "translation", key, value)

    await i18n.changeLanguage("fr")

    expect(backlog.id).toBe("backlog")
    expect(backlog.title).toBe("À traiter")
    expect(priorityConfig.low.label).toBe("Faible")
    expect(noteTypeConfig.observation.label).toBe("Observation française")
    expect(noteTypeConfig.observation.icon).toBe("eye")
  })
})

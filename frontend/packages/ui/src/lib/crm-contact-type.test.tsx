import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { TFunction } from "i18next"
import { contactDetailConfig, contactsTableConfig } from "./crm-entity-configs"
import { formatEntityFieldValue } from "./entity-row-utils"

const t = ((_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key) as TFunction

describe("contact entity type", () => {
  it.each([[true, "Company"], [false, "Person"], [undefined, "—"]] as const)("renders %s consistently in list and detail", (value, expected) => {
    const config = contactsTableConfig(t)
    if (config.view.mode !== "table") throw new Error("Expected contact table")
    const column = config.view.columns.find((item) => item.key === "isCompany")!
    const detail = contactDetailConfig(t).sections.flatMap((section) => section.fields).find((item) => item.key === "isCompany")!
    for (const field of [column, detail]) {
      expect(renderToStaticMarkup(formatEntityFieldValue(value, field.type, field.badgeVariants, field.badgeLabels))).toContain(expected)
    }
  })
})

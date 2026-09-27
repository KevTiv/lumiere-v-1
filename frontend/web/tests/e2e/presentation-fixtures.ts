import { expect, type Page } from "@playwright/test"

import { fetchDefaultCompanyId, smokeName } from "./helpers"

export type PresentationDefinition = Record<string, unknown> & {
  moduleId: string
  title: string
  baseRevision: string | null
}

type PreviewOptions = {
  applicationContract: string
  fields: string[]
}

export function presentationModuleKey(prefix: string): string {
  return smokeName(prefix)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-")
    .slice(0, 64)
}

export async function presentationOptions(page: Page): Promise<PreviewOptions> {
  const response = await page.request.get("/api/presentation/preview", {
    failOnStatusCode: false,
  })
  expect(response.status(), await response.text()).toBe(200)
  const body = (await response.json()) as Partial<PreviewOptions>
  expect(typeof body.applicationContract).toBe("string")
  expect(Array.isArray(body.fields)).toBe(true)
  expect(body.fields?.length ?? 0).toBeGreaterThan(0)
  return {
    applicationContract: body.applicationContract!,
    fields: body.fields!,
  }
}

export function presentationDefinition(
  moduleId: string,
  title: string,
  options: PreviewOptions,
  baseRevision: string | null = null,
): PresentationDefinition {
  return {
    schemaVersion: 1,
    moduleId,
    title,
    applicationContract: options.applicationContract,
    componentCatalogVersion: 1,
    baseRevision,
    pages: [
      {
        id: "overview",
        title: "Overview",
        nodes: [
          {
            kind: "collection",
            id: "entries",
            slot: "primary",
            component: { id: "erp.collection", version: 1 },
            resource: "account-moves",
            fields: options.fields.slice(0, 2),
            pageSize: 10,
          },
        ],
      },
    ],
  }
}

export async function savePresentationDraft(
  page: Page,
  definition: PresentationDefinition,
  expectedRevision: string | null,
) {
  return page.request.post("/api/presentation/drafts", {
    data: { expectedRevision, definition },
    failOnStatusCode: false,
  })
}

export async function presentationDraft(page: Page, moduleKey: string) {
  return page.request.get(`/api/presentation/drafts/${moduleKey}`, {
    failOnStatusCode: false,
  })
}

export async function previewPresentation(page: Page, definition: PresentationDefinition) {
  return page.request.post("/api/presentation/preview", {
    data: {
      companyId: String(await fetchDefaultCompanyId(page)),
      definition,
    },
    failOnStatusCode: false,
  })
}

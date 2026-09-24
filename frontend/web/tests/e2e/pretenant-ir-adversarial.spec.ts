import { expect, test } from "@playwright/test"

import { callReducerBff, fetchSessionOrganizationId } from "./helpers"
import {
  presentationDefinition,
  presentationDraft,
  presentationModuleKey,
  presentationOptions,
  savePresentationDraft,
} from "./presentation-fixtures"
import {
  CAPABILITIES,
  CAPABILITY_PENDING,
  openOwnerPages,
  pendingContract,
  pretenantTags,
  provisionActor,
  requireCapability,
  withActor,
} from "./pretenant-support"

test.describe("Pre-tenant presentation IR adversarial", { tag: pretenantTags("@presentation-ir") }, () => {
  test("IR-01 corrupt definitions are rejected and persist nothing", async ({ page }) => {
    await requireCapability(page, CAPABILITIES.presentationPreview)
    const options = await presentationOptions(page)

    const cases: Array<{
      name: string
      mutate: (definition: ReturnType<typeof presentationDefinition>) => void
    }> = [
      {
        name: "duplicate-node-id",
        mutate: (definition) => {
          const pageDefinition = definition.pages as Array<{ nodes: unknown[] }>
          pageDefinition[0].nodes.push(structuredClone(pageDefinition[0].nodes[0]))
        },
      },
      {
        name: "unknown-resource",
        mutate: (definition) => {
          const node = (definition.pages as Array<{ nodes: Array<Record<string, unknown>> }>)[0].nodes[0]
          node.resource = "definitely-not-a-resource"
        },
      },
      {
        name: "wrong-component-kind",
        mutate: (definition) => {
          const node = (definition.pages as Array<{ nodes: Array<Record<string, unknown>> }>)[0].nodes[0]
          node.component = { id: "erp.detail", version: 1 }
        },
      },
      {
        name: "future-schema-version",
        mutate: (definition) => {
          definition.schemaVersion = 999
        },
      },
    ]

    for (const item of cases) {
      const moduleKey = presentationModuleKey("pt-ir01-" + item.name)
      const definition = presentationDefinition(moduleKey, item.name, options)
      item.mutate(definition)
      const response = await savePresentationDraft(page, definition, null)
      expect(response.status(), item.name + ": " + (await response.text())).toBeGreaterThanOrEqual(400)
      expect(response.status(), item.name).toBeLessThan(500)

      const persisted = await presentationDraft(page, moduleKey)
      expect(persisted.status(), item.name + " unexpectedly persisted").toBe(404)
    }
  })

  test("IR-02 sensitive field permission revoked reauthorizes saved draft", async ({ page, browser }) => {
    await requireCapability(page, CAPABILITIES.presentationFieldRevocation)
    const organizationId = await fetchSessionOrganizationId(page)
    const actor = await provisionActor(page, "ir02-field", ["account-moves:read"])

    const created = await withActor(browser, actor, async (actorPage) => {
      const options = await presentationOptions(actorPage)
      expect(options.fields.length).toBeGreaterThan(1)
      const moduleKey = presentationModuleKey("pt-ir02-field")
      const response = await savePresentationDraft(
        actorPage,
        presentationDefinition(moduleKey, "Field revocation", options),
        null,
      )
      expect(response.status(), await response.text()).toBe(200)
      return { moduleKey, options }
    })

    await callReducerBff(page, "grant_field_permission", [
      organizationId,
      {
        subject: { tag: "Role", value: actor.roleId },
        resource: "account-moves",
        action: { tag: "Read" },
        allowed_fields: [created.options.fields[0]],
      },
    ])

    await withActor(browser, actor, async (actorPage) => {
      const denied = await presentationDraft(actorPage, created.moduleKey)
      expect(denied.status(), await denied.text()).toBe(422)
    })

    await callReducerBff(page, "grant_field_permission", [
      organizationId,
      {
        subject: { tag: "Role", value: actor.roleId },
        resource: "account-moves",
        action: { tag: "Read" },
        allowed_fields: created.options.fields,
      },
    ])

    await withActor(browser, actor, async (actorPage) => {
      const restored = await presentationDraft(actorPage, created.moduleKey)
      expect(restored.status(), await restored.text()).toBe(200)
      const body = (await restored.json()) as { revision: string; definition: { title: string } }
      expect(body.revision).toBe("1")
      expect(body.definition.title).toBe("Field revocation")
    })
  })

  test("IR-02 resource permission revoked reauthorizes saved draft", async ({ page, browser }) => {
    await requireCapability(page, CAPABILITIES.presentationSavedDrafts)
    const actor = await provisionActor(page, "ir02-resource", ["account-moves:read"])

    const moduleKey = await withActor(browser, actor, async (actorPage) => {
      const options = await presentationOptions(actorPage)
      const key = presentationModuleKey("pt-ir02-resource")
      const response = await savePresentationDraft(
        actorPage,
        presentationDefinition(key, "Resource revocation", options),
        null,
      )
      expect(response.status(), await response.text()).toBe(200)
      return key
    })

    await callReducerBff(page, "update_role", [
      actor.roleId,
      { name: null, description: null, permissions: ["organization:read"], is_active: null },
    ])

    await withActor(browser, actor, async (actorPage) => {
      const denied = await presentationDraft(actorPage, moduleKey)
      expect([403, 422]).toContain(denied.status())
    })

    await callReducerBff(page, "update_role", [
      actor.roleId,
      {
        name: null,
        description: null,
        permissions: ["organization:read", "account-moves:read"],
        is_active: null,
      },
    ])

    await withActor(browser, actor, async (actorPage) => {
      const restored = await presentationDraft(actorPage, moduleKey)
      expect(restored.status(), await restored.text()).toBe(200)
    })
  })

  test("IR-02 company membership removed prevents saved draft reopen", async ({ page, browser }) => {
    await requireCapability(page, CAPABILITIES.presentationMembershipRevocation)
    const organizationId = await fetchSessionOrganizationId(page)
    const actor = await provisionActor(page, "ir02-membership", ["account-moves:read"])

    const moduleKey = await withActor(browser, actor, async (actorPage) => {
      const options = await presentationOptions(actorPage)
      const key = presentationModuleKey("pt-ir02-membership")
      const response = await savePresentationDraft(
        actorPage,
        presentationDefinition(key, "Membership revocation", options),
        null,
      )
      expect(response.status(), await response.text()).toBe(200)
      return key
    })

    await callReducerBff(page, "remove_user_from_organization", [
      actor.identityHex,
      organizationId,
    ])

    await withActor(browser, actor, async (actorPage) => {
      const denied = await presentationDraft(actorPage, moduleKey)
      expect(denied.status()).not.toBe(200)
      expect([401, 403]).toContain(denied.status())
    })
  })

  test("IR-02 resource disabled after save reauthorizes at reopen", { tag: CAPABILITY_PENDING }, async ({ page }) => {
    await requireCapability(page, CAPABILITIES.presentationResourceToggle)
    pendingContract(
      CAPABILITIES.presentationResourceToggle,
      "IR-02",
      "save a draft using an enabled resource; disable the resource; reopen keeps the definition but refuses data acquisition until the resource is re-enabled",
    )
  })

  test("IR-02 operation/capability removed after save reauthorizes at reopen", { tag: CAPABILITY_PENDING }, async ({ page }) => {
    await requireCapability(page, CAPABILITIES.presentationOperationToggle)
    pendingContract(
      CAPABILITIES.presentationOperationToggle,
      "IR-02",
      "save a definition containing an allowed operation/capability; remove that authority; reopen preserves the definition but refuses the operation and never serves cached authority",
    )
  })

  test("IR-03 two contexts editing revision N produce one N+1 and an explicit stale conflict", async ({ page, browser }) => {
    await requireCapability(page, CAPABILITIES.presentationSavedDrafts)
    const options = await presentationOptions(page)
    const moduleKey = presentationModuleKey("pt-ir03")
    const first = await savePresentationDraft(
      page,
      presentationDefinition(moduleKey, "Revision one", options),
      null,
    )
    expect(first.status(), await first.text()).toBe(200)

    const sessions = await openOwnerPages(browser, 2)
    try {
      const [writerA, writerB] = sessions.pages
      const [openedA, openedB] = await Promise.all([
        presentationDraft(writerA, moduleKey),
        presentationDraft(writerB, moduleKey),
      ])
      expect(openedA.status()).toBe(200)
      expect(openedB.status()).toBe(200)

      const [resultA, resultB] = await Promise.all([
        savePresentationDraft(
          writerA,
          presentationDefinition(moduleKey, "Writer A", options, "1"),
          "1",
        ),
        savePresentationDraft(
          writerB,
          presentationDefinition(moduleKey, "Writer B", options, "1"),
          "1",
        ),
      ])
      const statuses = [resultA.status(), resultB.status()].sort((a, b) => a - b)
      expect(statuses).toEqual([200, 409])

      const winner = resultA.status() === 200 ? "Writer A" : "Writer B"
      const final = await presentationDraft(page, moduleKey)
      expect(final.status(), await final.text()).toBe(200)
      const body = (await final.json()) as { revision: string; definition: { title: string } }
      expect(body.revision).toBe("2")
      expect(body.definition.title).toBe(winner)
    } finally {
      await sessions.close()
    }
  })

  for (const interruption of [
    "company switch",
    "module definition edited",
    "logout and login as another user",
    "permission revoked",
  ]) {
    test("IR-04 late preview response after " + interruption + " is never rendered", { tag: CAPABILITY_PENDING }, async ({ page }) => {
      await requireCapability(page, CAPABILITIES.presentationCompanySwitch)
      pendingContract(
        CAPABILITIES.presentationCompanySwitch,
        "IR-04",
        "a preview request starts, " + interruption + " happens, the delayed response arrives: it is discarded and never rendered under the new scope/definition/user",
      )
    })
  }

  test("IR-05 human, harness and import definitions take the identical validation/authorization path", { tag: CAPABILITY_PENDING }, async ({ page }) => {
    await requireCapability(page, CAPABILITIES.harnessGeneratedPresentation)
    pendingContract(
      CAPABILITIES.harnessGeneratedPresentation,
      "IR-05",
      "an equivalent definition produced by the human editor, the AI harness and import/reopen passes the same schema validation, authorization, resource resolution, versioning, publication and rendering, with no AI-trusted shortcut and identical rejection of forbidden content",
    )
  })
})

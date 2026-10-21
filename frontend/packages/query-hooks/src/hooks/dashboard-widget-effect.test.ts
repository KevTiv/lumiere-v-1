import assert from "node:assert/strict"
import test from "node:test"

import { AmbiguousOperationEffectError } from "./operation-effect"
import {
  resolveDashboardWidgetAttachmentEffect,
  resolveDashboardWidgetCreationEffect,
} from "./dashboard-widget-effect"
import { dashboardWidgetCreationMetadata } from "@lumiere/erp-shared/reports-dashboard-params"

test("widget creation resolves only the exact organization and request key", () => {
  const metadata = dashboardWidgetCreationMetadata("request-1")
  const rows = [
    { id: 7, organizationId: 3, metadata },
    { id: 8, organizationId: 4, metadata },
    { id: 9, organizationId: 3, metadata: dashboardWidgetCreationMetadata("request-2") },
  ]

  assert.deepEqual(resolveDashboardWidgetCreationEffect(rows, 3n, "request-1"), {
    resource: "dashboard-widgets",
    id: "7",
    href: "/reports?tab=dashboard-widgets&filter=id:7",
  })
  assert.equal(resolveDashboardWidgetCreationEffect(rows, 3n, "absent"), null)
})

test("duplicate creation request keys fail instead of choosing the newest widget", () => {
  const metadata = dashboardWidgetCreationMetadata("duplicate")
  assert.throws(
    () =>
      resolveDashboardWidgetCreationEffect(
        [
          { id: 7, organizationId: 3, metadata },
          { id: 8, organizationId: 3, metadata },
        ],
        3n,
        "duplicate",
      ),
    AmbiguousOperationEffectError,
  )
})

test("attachment resolves only from the exact dashboard widget_ids relation", () => {
  const rows = [{ id: 12, organization_id: 3, widget_ids: [4, 9] }]
  assert.deepEqual(resolveDashboardWidgetAttachmentEffect(rows, 3n, 12n, 9n), {
    resource: "dashboards",
    id: "12",
    href: "/reports?tab=dashboards&filter=id:12",
  })
  assert.equal(resolveDashboardWidgetAttachmentEffect(rows, 3n, 99n, 9n), null)
  assert.equal(resolveDashboardWidgetAttachmentEffect(rows, 3n, 12n, 10n), null)
})

test("duplicate exact dashboards are an invariant failure", () => {
  assert.throws(
    () =>
      resolveDashboardWidgetAttachmentEffect(
        [
          { id: 12, organizationId: 3, widgetIds: [9] },
          { id: 12, organizationId: 3, widgetIds: [9] },
        ],
        3n,
        12n,
        9n,
      ),
    AmbiguousOperationEffectError,
  )
})

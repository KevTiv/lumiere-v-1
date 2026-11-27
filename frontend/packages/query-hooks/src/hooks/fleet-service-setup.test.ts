import assert from "node:assert/strict"
import test from "node:test"
import { resolveFleetServiceTypeEffect } from "./fleet"
import { AmbiguousOperationEffectError } from "./operation-effect"

const otherChoices = [
  { id: "1", organization_id: "11", company_id: null, name: "Annual inspection", is_active: true },
  { id: "2", organizationId: 11n, companyId: 13n, name: "Annual inspection", isActive: true },
  { id: "3", organizationId: 23n, companyId: 12n, name: "Annual inspection", isActive: true },
  { id: "4", organizationId: 11n, companyId: 12n, name: "Annual inspection", isActive: false },
  { id: "5", organizationId: 11n, companyId: 12n, name: "Annual Inspection", isActive: true },
]
const saved = {
  id: "9007199254740993",
  organizationId: 11n,
  companyId: 12n,
  name: "Annual inspection",
  isActive: true,
}

test("service setup acknowledges only the exact active service type in the target company", () => {
  assert.equal(resolveFleetServiceTypeEffect(otherChoices, 11n, 12n, saved.name), null)
  assert.deepEqual(resolveFleetServiceTypeEffect([...otherChoices, saved], 11n, 12n, saved.name), {
    resource: "fleet-service-types",
    id: saved.id,
  })
  assert.throws(
    () => resolveFleetServiceTypeEffect([saved, { ...saved, id: "7" }], 11n, 12n, saved.name),
    AmbiguousOperationEffectError,
  )
})

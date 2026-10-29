import assert from "node:assert/strict"
import test from "node:test"
import { authorizedPeopleOptions, selectedPerson, type DirectoryPerson } from "./authorized-people"

const identity = "ab".repeat(32)
const person = (patch: Partial<DirectoryPerson> = {}): DirectoryPerson => ({ identity, name: "Alex", email: "alex@example.test", isActive: true,
  membership: { organizationId: 7, userIdentity: identity, isActive: true }, ...patch })

test("people picker preserves exact identities and only offers named active current memberships", () => {
  const rows = [person(), person({ identity: "cd".repeat(32), membership: { organizationId: 8, userIdentity: "cd".repeat(32), isActive: true } }),
    person({ identity: "ef".repeat(32), membership: undefined }), person({ name: "", email: "", identity: "12".repeat(32) })]
  const options = authorizedPeopleOptions(rows, 7)
  assert.deepEqual(options, [{ value: identity, label: "Alex · alex@example.test" }])
  assert.equal(selectedPerson(`0x${identity.toUpperCase()}`, options), identity)
  assert.equal(selectedPerson("cd".repeat(32), options), null)
})

test("redacted, inactive, ambiguous and mismatched directory rows cannot become options", () => {
  assert.deepEqual(authorizedPeopleOptions([person({ isActive: undefined }), person({ isActive: false }),
    person({ membership: { organizationId: 7, userIdentity: identity, isActive: false } }),
    person({ membership: { organizationId: 7, userIdentity: "cd".repeat(32), isActive: true } })], 7), [])
  assert.deepEqual(authorizedPeopleOptions([person(), person()], 7), [])
  assert.equal(selectedPerson(identity, []), null)
})

import assert from "node:assert/strict"
import test from "node:test"
import { parseProgramInputSchema, programInputFromControl, validateProgramInputs } from "./work-program-inputs"

const wire = { type: "object", additionalProperties: false, required: ["period", "includeEmpty", "limit"], properties: {
  period: { type: "string", format: "date", title: "Period" },
  includeEmpty: { type: "boolean" }, limit: { type: "integer", minimum: 0, maximum: 50 },
} }
test("closed declared inputs preserve explicit false and zero and reject missing or extra authority", () => {
  const schema = parseProgramInputSchema(wire)!
  assert.ok(schema)
  assert.deepEqual(validateProgramInputs(schema, { period: "2026-11-01", includeEmpty: false, limit: 0 }), { valid: true, values: { period: "2026-11-01", includeEmpty: false, limit: 0 } })
  for (const input of [{ period: "2026-11-01", limit: 1 }, { period: "2026-11-01", includeEmpty: false, limit: 1, actorIdentity: "forged" }, { period: "2026-02-30", includeEmpty: false, limit: 1 }, { period: "2026-11-01", includeEmpty: false, limit: "1" }]) assert.equal(validateProgramInputs(schema, input).valid, false)
})
test("unknown schema keywords and authority fields fail closed rather than dropping constraints", () => {
  for (const changed of [{ additionalProperties: true }, { oneOf: [] }, { required: ["missing"] }, { properties: { query: { type: "string", pattern: "allowed" } } }, { properties: { organizationId: { type: "integer" } }, required: [] }, { properties: { query: { type: "array" } }, required: [] }]) assert.equal(parseProgramInputSchema({ ...wire, ...changed }), null)
})
test("enum constraints, string bounds, and missing/blank number retain exact semantics", () => {
  const schema = parseProgramInputSchema({ type: "object", additionalProperties: false, properties: { currency: { type: "string", minLength: 3, maxLength: 3, enum: ["USD", "RWF"] }, count: { type: "integer" } } })!
  assert.ok(schema)
  assert.equal(validateProgramInputs(schema, { currency: "EUR" }).valid, false)
  assert.equal(validateProgramInputs(schema, {}).valid, true)
  const count = schema.fields[1]!
  assert.equal(programInputFromControl(count, ""), undefined)
  assert.equal(programInputFromControl(count, "0"), 0)
  assert.equal(programInputFromControl(count, "1e3"), "1e3")
  assert.equal(validateProgramInputs(schema, { count: programInputFromControl(count, "1e3") }).valid, false)
  assert.equal(validateProgramInputs(schema, { count: Number.MAX_SAFE_INTEGER + 1 }).valid, false)
})
test("invalid schema bounds and oversized descriptors reject before rendering", () => {
  for (const properties of [{ name: { type: "string", minLength: 5, maxLength: 4 } }, { name: { type: "string", maxLength: 2001 } }, { count: { type: "integer", minimum: 5, maximum: 4 } }, { enabled: { type: "boolean", minimum: 0 } }, { count: { type: "integer", enum: [1, 1] } }]) assert.equal(parseProgramInputSchema({ type: "object", additionalProperties: false, properties }), null)
})
test("root, properties, fields and inputs require plain objects with exact structural keys", () => {
  const schema = parseProgramInputSchema(wire)!
  for (const value of [null, [], "object", 0, true, new Date()]) {
    assert.equal(parseProgramInputSchema(value), null)
    assert.equal(validateProgramInputs(schema, value).valid, false)
    assert.equal(parseProgramInputSchema({ ...wire, properties: value }), null)
    assert.equal(parseProgramInputSchema({ ...wire, required: [], properties: { query: value } }), null)
  }
  assert.equal(parseProgramInputSchema({ ...wire, required: null }), null)
  assert.equal(parseProgramInputSchema({ ...wire, required: [], properties: { query: { type: { toString: null } } } }), null)
  assert.equal(parseProgramInputSchema({ ...wire, required: [], properties: { query: { type: "string", unknownConstraint: true } } }), null)
  const inherited = Object.create({ period: "2026-11-01" }) as object
  assert.equal(validateProgramInputs(schema, inherited).valid, false)
  let accessorCalls = 0
  const accessor = Object.defineProperty({ type: "string" }, "maxLength", { enumerable: true, get() { accessorCalls += 1; return 1 } })
  assert.equal(parseProgramInputSchema({ ...wire, required: [], properties: { query: accessor } }), null)
  assert.equal(accessorCalls, 0)
})

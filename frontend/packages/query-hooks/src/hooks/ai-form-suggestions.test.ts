import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

import { decodeAiFormSuggestions } from "./ai-form-suggestions"
import type { AiFormFieldSchema } from "./ai-forms"

const fields: AiFormFieldSchema[] = [
  { name: "name", type: "text", required: true },
  { name: "amount", type: "number", required: true },
  { name: "active", type: "checkbox", required: false },
  { name: "contactId", type: "select", required: false, options: [
    { value: "9007199254740993", label: "Exact contact" },
    { value: "12", label: "Unavailable contact", disabled: true },
  ] },
  { name: "companyId", type: "hidden", required: true },
]

function response(suggestions: unknown = {}) {
  return { suggestions, validation_notes: [], sources: [] }
}

function suggestion(value: unknown) {
  // This is the gateway's normal shape when no note or sources were generated.
  return { value, confidence: 0.8, note: null, sources: [] }
}

test("decodes the gateway shape without changing exact IDs, false, zero or empty strings", () => {
  const decoded = decodeAiFormSuggestions(response({
    name: suggestion(""), amount: suggestion(0), active: suggestion(false),
    contactId: suggestion("9007199254740993"),
  }), fields)
  assert.equal(decoded.suggestions.name.value, "")
  assert.equal(decoded.suggestions.amount.value, 0)
  assert.equal(decoded.suggestions.active.value, false)
  assert.equal(decoded.suggestions.contactId.value, "9007199254740993")
  assert.equal(Object.hasOwn(decoded.suggestions.name, "note"), false)
  assert.deepEqual(decoded.sources, [])
  assert.deepEqual(decodeAiFormSuggestions(response(), fields), response())
})

test("keeps valid advisory notes and sources without treating them as execution evidence", () => {
  const raw = { ...response({ name: { ...suggestion("Acme"), note: "From text", sources: [
    { type: "text", label: "Prompt", value: "Acme", field: "name" },
  ] } }), validation_notes: [{ field: "name", message: "Review the name", severity: "warning" }],
  sources: [{ type: "text", label: "Prompt text" }] }
  assert.deepEqual(decodeAiFormSuggestions(raw, fields), raw)
})

test("rejects missing and null proposal values without inventing a clear or default", () => {
  for (const field of fields.filter((field) => field.type !== "hidden")) {
    for (const raw of [suggestion(null), { confidence: 0.8 }]) {
      assert.throws(() => decodeAiFormSuggestions(response({ [field.name]: raw }), fields), /could not be verified/)
    }
  }
})

test("rejects fields outside the requested editable schema and unsupported field types", () => {
  for (const name of ["unknown", "companyId"]) {
    assert.throws(() => decodeAiFormSuggestions(response({ [name]: suggestion("7") }), fields))
  }
  for (const type of ["file", "password", "custom", "unrecognized"]) {
    assert.throws(() => decodeAiFormSuggestions(response({ value: suggestion("text") }), [
      { name: "value", type, required: false },
    ]))
  }
  assert.throws(() => decodeAiFormSuggestions(response(), [fields[0], fields[0]]))
})

test("rejects prototype-related keys even when the request contains them", () => {
  for (const name of ["__proto__", "constructor", "prototype"]) {
    const raw = JSON.parse(`{"${name}":{"value":"unsafe","confidence":0.8}}`)
    assert.throws(() => decodeAiFormSuggestions(response(raw), [{ name, type: "text", required: false }]))
  }
  assert.equal(Object.hasOwn(Object.prototype, "unsafe"), false)
})

test("requires exact enabled option values and preserves explicitly empty options", () => {
  for (const value of ["Exact contact", "12", "7", 9007199254740992]) {
    assert.throws(() => decodeAiFormSuggestions(response({ contactId: suggestion(value) }), fields))
  }
  assert.throws(() => decodeAiFormSuggestions(response({ contactId: suggestion("7") }), [
    { name: "contactId", type: "select", required: false, options: [] },
  ]))
  assert.equal(decodeAiFormSuggestions(response({ contactId: suggestion("") }), [
    { name: "contactId", type: "select", required: false, options: [{ value: "", label: "None" }] },
  ]).suggestions.contactId.value, "")
})

test("rejects scalar type changes instead of coercing amounts, booleans or text", () => {
  for (const [name, values] of [
    ["name", [0, false, [], {}]], ["amount", ["0", false, NaN, Infinity]], ["active", ["false", 0, {}]],
  ] as const) {
    for (const value of values) assert.throws(() => decodeAiFormSuggestions(response({ [name]: suggestion(value) }), fields))
  }
})

test("rejects malformed envelopes, confidence and metadata before Apply", () => {
  for (const raw of [null, [], {}, response(null), response([]), { ...response(), sources: {} },
    { ...response(), validation_notes: null }, { ...response(), validation_notes: [{ message: 7 }] },
    { ...response(), validation_notes: [{ message: "Review", severity: "success" }] },
    { ...response(), validation_notes: [{ message: "Review", field: 7 }] },
    { ...response(), sources: [{ type: "text", label: 7 }] },
    { ...response(), sources: [{ type: "" }] }]) {
    assert.throws(() => decodeAiFormSuggestions(raw, fields), /could not be verified/)
  }
  for (const patch of [{ confidence: -1 }, { confidence: 2 }, { confidence: "0.8" },
    { confidence: NaN }, { note: 7 }, { sources: null }, { sources: [{ type: 7 }] }]) {
    assert.throws(() => decodeAiFormSuggestions(response({ name: { ...suggestion("Acme"), ...patch } }), fields))
  }
})

type SuggestArgs = { companyId: number; formId: string; entityType: string; fields: AiFormFieldSchema[]; rawText: string }
type Mutation = { retry: boolean; mutationFn(args: SuggestArgs): Promise<unknown> }

function mutation(fetch: (url: string, init: RequestInit) => Promise<Response>): Mutation {
  const compiled = ts.transpileModule(readFileSync(new URL("./ai-forms.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} as { useAiFormSuggest(): Mutation } }
  const dependencies = {
    "@tanstack/react-query": { useMutation: (options: Mutation) => options },
    "@lumiere/api-client/response-error": { responseErrorMessage: async () => "Denied" },
    "../http": { apiFetch: fetch },
    "./ai-form-suggestions": { decodeAiFormSuggestions },
  }
  runInNewContext(compiled, { module, exports: module.exports, require: (name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`)
    return dependencies[name as keyof typeof dependencies]
  } })
  return module.exports.useAiFormSuggest()
}

const args: SuggestArgs = { companyId: 7, formId: "new-contact", entityType: "contact", fields, rawText: "Acme" }

test("the actual suggestion mutation decodes one POST and disables inherited retries", async () => {
  const requests: { url: string; body: unknown }[] = []
  const hook = mutation(async (url, init) => {
    requests.push({ url, body: JSON.parse(String(init.body)) })
    return Response.json(response({ name: suggestion("Acme") }))
  })
  assert.equal(hook.retry, false)
  assert.deepEqual(await hook.mutationFn(args), {
    suggestions: { name: { value: "Acme", confidence: 0.8, sources: [] } }, validation_notes: [], sources: [],
  })
  assert.deepEqual(requests, [{ url: "/api/ai/forms/suggest", body: {
    companyId: 7, form_id: "new-contact", entity_type: "contact", fields, raw_text: "Acme",
  } }])
})

test("malformed, rejected and lost responses reject after one POST without retry", async () => {
  for (const result of ["malformed", "denied", "lost"] as const) {
    let posts = 0
    const hook = mutation(async () => {
      posts += 1
      if (result === "lost") throw new Error("Connection lost")
      if (result === "denied") return new Response(null, { status: 403 })
      return Response.json(response({ companyId: suggestion("99") }))
    })
    await assert.rejects(hook.mutationFn(args), result === "malformed" ? /could not be verified/ : result === "denied" ? /Denied/ : /Connection lost/)
    assert.equal(hook.retry, false)
    assert.equal(posts, 1)
  }
})

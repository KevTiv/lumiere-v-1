import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import * as paramsJson from "@lumiere/erp-shared/stdb-params-json"
import * as scalar from "@lumiere/erp-shared/u64"

function memberMutation() {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = []
  const dependencies: Record<string, unknown> = {
    "@lumiere/stdb/commands": { stdbBffCommandPost },
    "@lumiere/stdb/browser-http": {},
    "@tanstack/react-query": { useQueryClient: () => ({}), useMutation: (options: unknown) => options },
    "../http": {},
    "../operation-dispatch": {
      dispatchNamedOperation: async (...[name, input]: Parameters<typeof stdbBffCommandPost>) => {
        const { urlPath, init } = stdbBffCommandPost(name, input)
        calls.push({ url: urlPath, body: JSON.parse(String(init.body)) })
      },
    },
    "../subscription-query": {},
    "@lumiere/erp-shared/settings-create-params": {},
    "@lumiere/erp-shared/stdb-params-json": paramsJson,
    "@lumiere/erp-shared/u64": scalar,
    "./auth-role-assignment": {},
  }
  const compiled = ts.transpileModule(readFileSync(new URL("./auth.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} as { useSetMemberAccess(org: bigint): { mutationFn(input: unknown): Promise<void> } } }
  runInNewContext(compiled, {
    module, exports: module.exports,
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency ${name}`)
      return dependencies[name]
    },
  })
  return { calls, mutation: module.exports.useSetMemberAccess(1n) }
}

test("member access saves encode optional job titles and preserve the optimistic access snapshot", async () => {
  const { calls, mutation } = memberMutation()
  const user = { id: "ab".repeat(32), primaryRoleId: "7", accessRevision: "41", roles: ["7", "8"], status: "active" }
  for (const jobTitle of [undefined, "", "Manager"]) {
    await mutation.mutationFn({ user, primaryRoleId: "7", roleIds: ["7", "9"], isActive: false, jobTitle })
  }
  assert.equal(calls.length, 3)
  for (const [index, call] of calls.entries()) {
    assert.equal(call.url, "/api/operations/erp.set_member_access")
    assert.deepEqual(call.body.userIdentity, { __identity__: `0x${user.id}` })
    assert.deepEqual(call.body.params, {
      primary_role_id: 7, additional_role_ids: [9], expected_primary_role_id: 7,
      expected_role_ids: [7, 8], expected_access_revision: 41, expected_is_active: true, is_active: false,
      job_title: [{ none: [] }, { some: "" }, { some: "Manager" }][index],
    })
  }
})


test("member access cannot save a row without its server revision", async () => {
  const { calls, mutation } = memberMutation()
  await assert.rejects(mutation.mutationFn({ user: {}, primaryRoleId: "7", roleIds: ["7"], isActive: true }), /Reload users/)
  assert.equal(calls.length, 0)
})

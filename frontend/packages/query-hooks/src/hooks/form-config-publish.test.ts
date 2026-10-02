import assert from "node:assert/strict"
import test from "node:test"

import { AmbiguousOperationEffectError } from "./operation-effect"
import {
  formConfigUpdatedAtMicros,
  formConfigVersion,
  nextFormConfigVersion,
  resolvePublishedFormConfig,
  type FormConfigKey,
  type FormConfigProjection,
} from "./form-config-publish"

const key: FormConfigKey = { organizationId: 1n, moduleId: "crm", formId: "new-lead" }

const config = (extra: Partial<FormConfigProjection> = {}): FormConfigProjection => ({
  id: 5n,
  organizationId: 1n,
  moduleId: "crm",
  formId: "new-lead",
  isActive: true,
  configVersion: 1n,
  ...extra,
})

test("computes the version a publish must produce", () => {
  assert.equal(nextFormConfigVersion(null), 1n)
  assert.equal(nextFormConfigVersion(3n), 4n)
})

test("reads the exact configuration's version", () => {
  const rows = [config({ id: 4n, formId: "other", configVersion: 9n }), config({ configVersion: 2n })]
  assert.equal(formConfigVersion(rows, key), 2n)
  assert.equal(formConfigVersion([], key), null)
  assert.equal(formConfigVersion([config({ organizationId: 2n })], key), null)
})

test("resolves the exact configuration at the expected version", () => {
  assert.deepEqual(resolvePublishedFormConfig([config()], key, 1n), { resource: "form-configs", id: "5" })
  assert.deepEqual(
    resolvePublishedFormConfig([{ id: "5", organization_id: "1", module_id: "crm", form_id: "new-lead", is_active: true, config_version: "2" }], key, 2n),
    { resource: "form-configs", id: "5" },
  )
})

test("returns null for another version, an inactive or missing configuration, or another scope", () => {
  assert.equal(resolvePublishedFormConfig([config({ configVersion: 2n })], key, 1n), null)
  assert.equal(resolvePublishedFormConfig([config({ isActive: false })], key, 1n), null)
  assert.equal(resolvePublishedFormConfig([], key, 1n), null)
  assert.equal(resolvePublishedFormConfig([config({ moduleId: "sales" })], key, 1n), null)
  assert.equal(resolvePublishedFormConfig([config({ organizationId: 2n })], key, 1n), null)
})

test("throws on duplicate configurations for one form", () => {
  assert.throws(() => resolvePublishedFormConfig([config(), config({ id: 6n })], key, 1n), AmbiguousOperationEffectError)
  assert.throws(() => formConfigVersion([config(), config({ id: 6n })], key), AmbiguousOperationEffectError)
})

test("reads the compare-and-set token in its Timestamp shapes", () => {
  const at = (updatedAt: unknown) => formConfigUpdatedAtMicros([config({ updatedAt })], key)
  assert.equal(at({ __timestamp_micros_since_unix_epoch__: 1_700_000_000_123_456 }), 1_700_000_000_123_456)
  assert.equal(at({ microsSinceUnixEpoch: 1_700_000_000_123_456n }), 1_700_000_000_123_456)
  assert.equal(at("1700000000123456"), 1_700_000_000_123_456)
  assert.equal(
    formConfigUpdatedAtMicros([{ id: "5", organization_id: "1", module_id: "crm", form_id: "new-lead", updated_at: 42 }], key),
    42,
  )
  assert.equal(at(undefined), null)
  assert.equal(at("soon"), null)
  assert.equal(formConfigUpdatedAtMicros([], key), null)
})

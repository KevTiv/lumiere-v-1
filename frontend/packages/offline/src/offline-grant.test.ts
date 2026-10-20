import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { grantFixture } from "../tests/grant-fixture.ts";
import {
  checkedGrantTrust,
  encodeGrantBytes,
  verifyOfflineGrant,
  OfflineGrantError,
} from "./offline-grant.ts";
import { OfflineGrantCache } from "../../../web/offline-categories/grant-cache.ts";
import {
  OFFLINE_GRANT_KEY,
  OFFLINE_REVOCATION_KEY,
} from "../../../web/lib/offline-lifecycle.ts";

test("ES256 verifies the exact signed category scope without numeric identity conversion", async () => {
  const fixture = await grantFixture();
  const claims = {
    ...fixture.claims,
    scope: { ...fixture.claims.scope, companyId: "18446744073709551615" },
  };
  const verified = await verifyOfflineGrant(
    await fixture.sign(claims),
    fixture.trust,
    {
      audience: claims.audience,
      now: claims.issuedAt,
      companyId: claims.scope.companyId,
    },
  );
  assert.deepEqual(verified, claims);
});
for (const [name, mutate] of Object.entries({
  "wrong origin": (c: Awaited<ReturnType<typeof grantFixture>>["claims"]) => ({
    ...c,
    audience: "https://other.example",
  }),
  "wrong deployment": (
    c: Awaited<ReturnType<typeof grantFixture>>["claims"],
  ) => ({ ...c, deploymentId: "other-deployment" }),
  "wrong resource": (
    c: Awaited<ReturnType<typeof grantFixture>>["claims"],
  ) => ({ ...c, resource: "invoices" }),
  "wrong schema": (c: Awaited<ReturnType<typeof grantFixture>>["claims"]) => ({
    ...c,
    schemaHash: "wrong",
  }),
  "future issuance": (
    c: Awaited<ReturnType<typeof grantFixture>>["claims"],
  ) => ({ ...c, issuedAt: c.issuedAt + 60 }),
  expired: (c: Awaited<ReturnType<typeof grantFixture>>["claims"]) => ({
    ...c,
    expiresAt: c.issuedAt,
  }),
  "unbounded lifetime": (
    c: Awaited<ReturnType<typeof grantFixture>>["claims"],
  ) => ({ ...c, expiresAt: c.expiresAt + 1 }),
  "unsafe company ID": (
    c: Awaited<ReturnType<typeof grantFixture>>["claims"],
  ) => ({ ...c, scope: { ...c.scope, companyId: "18446744073709551616" } }),
  "unknown claim": (c: Awaited<ReturnType<typeof grantFixture>>["claims"]) => ({
    ...c,
    extra: "unexpected",
  }),
})) {
  test(`signed ${name} refuses offline admission`, async () => {
    const f = await grantFixture();
    await assert.rejects(
      verifyOfflineGrant(await f.sign(mutate(f.claims)), f.trust, {
        audience: f.claims.audience,
        now: f.claims.issuedAt,
      }),
      OfflineGrantError,
    );
  });
}
test("tampering, wrong key, algorithm confusion and expired boundary fail closed", async () => {
  const f = await grantFixture(),
    grant = await f.sign();
  const expected = { audience: f.claims.audience, now: f.claims.issuedAt };
  for (const changed of [
    { ...grant, signature: encodeGrantBytes(new Uint8Array(64)) },
    {
      ...grant,
      payload: encodeGrantBytes(
        new TextEncoder().encode(
          JSON.stringify({ ...f.claims, audience: "other" }),
        ),
      ),
    },
    { ...grant, keyId: "untrusted" },
    { ...grant, algorithm: "none" },
    { ...grant, publicKey: f.trust.keys[0].publicKey },
    { ...grant, signature: grant.signature + "=" },
    { ...grant, version: 2 },
  ])
    await assert.rejects(
      verifyOfflineGrant(changed, f.trust, expected),
      OfflineGrantError,
    );
  const other = await grantFixture();
  await assert.rejects(
    verifyOfflineGrant(grant, other.trust, expected),
    OfflineGrantError,
  );
  await assert.rejects(
    verifyOfflineGrant(grant, f.trust, {
      ...expected,
      now: f.claims.expiresAt,
    }),
    OfflineGrantError,
  );
  await assert.rejects(
    verifyOfflineGrant(grant, f.trust, { ...expected, companyId: "8" }),
    OfflineGrantError,
  );
  for (const scope of [
    { ...f.claims.scope, actorId: "other" },
    { ...f.claims.scope, organizationId: "8" },
    { ...f.claims.scope, environmentId: "other" },
    { ...f.claims.scope, authorizationVersion: "other" },
  ])
    await assert.rejects(
      verifyOfflineGrant(grant, f.trust, { ...expected, scope }),
      OfflineGrantError,
    );
});
test("build trust rejects malformed and duplicate pins and excessive lifetime", async () => {
  const f = await grantFixture();
  for (const trust of [
    { ...f.trust, keys: [] },
    { ...f.trust, keys: [...f.trust.keys, ...f.trust.keys] },
    { ...f.trust, maximumLifetimeSeconds: 86_401 },
    { ...f.trust, keys: [{ keyId: "k", publicKey: "invalid" }] },
    { ...f.trust, deploymentId: "bad deployment" },
  ])
    assert.throws(() => checkedGrantTrust(trust));
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}
test("cached grant survives a new reader; observed clock rollback, expiry and revocation refuse admission", async () => {
  const f = await grantFixture(),
    storage = memoryStorage();
  let now = f.claims.issuedAt;
  const cache = new OfflineGrantCache(
    f.trust,
    f.claims.audience,
    storage,
    () => now,
  );
  await cache.save(await f.sign(), f.claims.scope);
  const reopened = new OfflineGrantCache(
    f.trust,
    f.claims.audience,
    storage,
    () => now,
  );
  const claims = await reopened.load("9");
  now += 100;
  reopened.requireCurrent(claims);
  now--;
  await assert.rejects(reopened.load("9"), OfflineGrantError);
  now = f.claims.expiresAt;
  await assert.rejects(reopened.load("9"), OfflineGrantError);
  now = f.claims.issuedAt;
  await cache.save(await f.sign(), f.claims.scope);
  storage.setItem(OFFLINE_REVOCATION_KEY, "logout");
  await assert.rejects(reopened.load("9"), OfflineGrantError);
});
test("cached metadata cannot replace a pinned key or a currently verified lease", async () => {
  const f = await grantFixture(),
    storage = memoryStorage();
  const cache = new OfflineGrantCache(
    f.trust,
    f.claims.audience,
    storage,
    () => f.claims.issuedAt,
  );
  const claims = await cache.save(await f.sign(), f.claims.scope);
  const record = JSON.parse(storage.getItem(OFFLINE_GRANT_KEY)!);
  record.grant.signature = encodeGrantBytes(new Uint8Array(64));
  storage.setItem(OFFLINE_GRANT_KEY, JSON.stringify(record));
  assert.throws(() => cache.requireCurrent(claims), OfflineGrantError);
  await assert.rejects(cache.load(), OfflineGrantError);
  const disabled = new OfflineGrantCache(null, f.claims.audience, storage);
  await assert.rejects(disabled.load(), OfflineGrantError);
});
test("actual Rust ring signer is compatible with WebCrypto ES256 verification", async () => {
  // Committed vector is generated by the actual production Rust signer, never a TS mirror.
  const vector = JSON.parse(
    await readFile(
      new URL("../tests/fixtures/rust-offline-grant.json", import.meta.url),
      "utf8",
    ),
  );
  const trust = {
    deploymentId: "test-deployment",
    maximumLifetimeSeconds: 3600,
    keys: [{ keyId: "k1", publicKey: vector.publicKey }],
  };
  const claims = await verifyOfflineGrant(vector.grant, trust, {
    audience: "https://erp.example",
    now: 1_700_000_001,
  });
  assert.equal(claims.scope.companyId, "9");
  assert.equal(claims.expiresAt, 1_700_003_600);
});

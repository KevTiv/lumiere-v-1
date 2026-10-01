import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildCategoryApp } from "../scripts/build-category-app.ts";
import { grantFixture } from "../tests/grant-fixture.ts";

test("production category shell bundles reproducibly with all offline startup assets", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "lumiere-shell-build-"));
  try {
    const first = await buildCategoryApp(path.join(temporary, "first"));
    const second = await buildCategoryApp(path.join(temporary, "second"));
    assert.equal(first.version, second.version);
    assert.deepEqual(first.urls, second.urls);
    for (const url of first.urls) {
      const name = path.basename(url);
      assert.deepEqual(
        await readFile(path.join(first.output, name)),
        await readFile(path.join(second.output, name)),
      );
    }
    const html = await readFile(path.join(first.output, "index.html"), "utf8");
    assert.ok(html.includes(first.client));
    assert.equal(html.includes("__CLIENT__"), false);
    const sw = await readFile(path.join(first.output, "sw.js"), "utf8");
    assert.ok(sw.includes(first.shell));
    assert.ok(sw.includes(first.worker));
    assert.ok(sw.includes(first.wasm));
    assert.equal(sw.includes("__ASSETS__"), false);
    assert.equal(sw.includes("__CACHE__"), false);
    assert.deepEqual(
      (
        await readFile(path.join(first.output, path.basename(first.wasm)))
      ).subarray(0, 4),
      Buffer.from([0, 97, 115, 109]),
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("pinned key rotation changes the public app generation and malformed policy fails the build", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "lumiere-grant-build-"));
  try {
    const first = await grantFixture(),
      second = await grantFixture();
    const a = await buildCategoryApp(path.join(temporary, "a"), first.trust);
    const b = await buildCategoryApp(path.join(temporary, "b"), second.trust);
    assert.notEqual(a.client, b.client);
    assert.notEqual(a.version, b.version);
    assert.equal(a.worker, b.worker);
    await assert.rejects(
      buildCategoryApp(path.join(temporary, "bad"), {
        ...first.trust,
        keys: [],
      }),
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { waitForPrintAssets } from "./print-assets.mjs";

async function withDocument(document, operation) {
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    await operation({ evaluate: (callback, value) => callback(value) });
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
}

test("print readiness waits for fonts before decoding every embedded image", async () => {
  const calls = [];
  await withDocument({
    fonts: { ready: Promise.resolve().then(() => calls.push("fonts")) },
    images: [{ decode: async () => calls.push("logo") }, { decode: async () => calls.push("second image") }],
  }, async (page) => {
    await waitForPrintAssets(page);
    assert.deepEqual(calls, ["fonts", "logo", "second image"]);
  });
});

test("invalid images fail printing instead of producing a silently missing logo", async () => {
  await withDocument({ fonts: { ready: Promise.resolve() }, images: [{ decode: async () => { throw new Error("Invalid image"); } }] },
    (page) => assert.rejects(waitForPrintAssets(page), /Invalid image/));
});

test("print asset readiness is bounded", async () => {
  await withDocument({ fonts: { ready: new Promise(() => {}) }, images: [] },
    (page) => assert.rejects(waitForPrintAssets(page, 10), /did not become ready/));
});

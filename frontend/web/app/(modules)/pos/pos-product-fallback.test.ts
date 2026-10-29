import assert from "node:assert/strict"
import test from "node:test"
import { posFallbackCategories, toPosProduct } from "./use-pos"

test("POS fallback metadata preserves canonical values and tenant-authored names", () => {
  const fallback = toPosProduct({ id: 5 })
  assert.equal(fallback.name, "Product")
  assert.equal(fallback.category, "General")
  assert.equal(fallback.nameIsFallback, true)
  assert.equal(fallback.categoryIsFallback, true)
  assert.deepEqual(posFallbackCategories([fallback]), ["General"])

  const authored = toPosProduct({ id: 6, name: "Product", categoryName: "General" })
  assert.equal(authored.nameIsFallback, false)
  assert.equal(authored.categoryIsFallback, false)
  assert.deepEqual(posFallbackCategories([fallback, authored]), [])
  assert.equal(authored.category, "General")
  const empty = toPosProduct({ id: 7, name: "", category: "" })
  assert.equal(empty.nameIsFallback, false)
  assert.equal(empty.categoryIsFallback, false)
})

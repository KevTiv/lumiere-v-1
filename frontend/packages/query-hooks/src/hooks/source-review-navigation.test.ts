import assert from "node:assert/strict";
import test from "node:test";
import { exactSourceReviewRevision, pinnedSourceReview, sourceReviewBeforeRevision, sourceReviewHistoryHref } from "./source-review-navigation";

test("source review links select the saved item/revision within the current company", () => {
  const review = { batchId: "24", itemId: "9007199254740993", revision: 3 };
  const url = new URL(sourceReviewHistoryHref("11", review), "https://erp.test");
  assert.equal(url.hash, "#source-review-history");
  assert.deepEqual(pinnedSourceReview(url.search, "11"), review);
  assert.equal(pinnedSourceReview(url.search, "12"), null);
  assert.equal(sourceReviewBeforeRevision(review), 4);
  assert.equal(sourceReviewBeforeRevision({ ...review, revision: 2_147_483_647 }), undefined);
});

test("malformed identities or revision values cannot select history", () => {
  for (const params of ["sourceReview=01&sourceReviewItem=7&sourceReviewRevision=3", "sourceReview=24&sourceReviewItem=18446744073709551616&sourceReviewRevision=3", "sourceReview=24&sourceReviewItem=7&sourceReviewRevision=2147483648", "sourceReview=24&sourceReviewItem=7&sourceReviewRevision=1e2", "sourceReview=24&sourceReviewItem=7&sourceReviewRevision=0"])
    assert.equal(pinnedSourceReview(`sourceReviewCompany=11&${params}`, "11"), null);
});

test("current or neighboring revisions never substitute for the imported revision", () => {
  const review = { batchId: "24", itemId: "700", revision: 3 };
  const entries = [{ itemId: "700", revision: 5, values: "current" }, { itemId: "700", revision: 3, values: "imported" }, { itemId: "701", revision: 3, values: "other row" }];
  assert.equal(exactSourceReviewRevision(entries, review)?.values, "imported");
  assert.equal(exactSourceReviewRevision(entries.filter((entry) => entry.values !== "imported"), review), undefined);
});

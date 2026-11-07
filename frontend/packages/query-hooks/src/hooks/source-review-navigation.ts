import { validHistoryId } from "./account-move-history-model";

export interface PinnedSourceReview {
  batchId: string;
  itemId: string;
  revision: number;
}

export function pinnedSourceReview(search: string, companyId: string): PinnedSourceReview | null {
  const params = new URLSearchParams(search);
  if (params.get("sourceReviewCompany") !== companyId) return null;
  const batchId = params.get("sourceReview");
  const itemId = params.get("sourceReviewItem");
  const revision = params.get("sourceReviewRevision");
  if (!validHistoryId(batchId) || !validHistoryId(itemId) || !revision || !/^[1-9][0-9]*$/.test(revision)) return null;
  const number = Number(revision);
  if (!Number.isSafeInteger(number) || number > 2_147_483_647) return null;
  return { batchId, itemId, revision: number };
}

export function sourceReviewHistoryHref(companyId: string, review: PinnedSourceReview): string {
  if (!validHistoryId(companyId) || !validHistoryId(review.batchId) || !validHistoryId(review.itemId)
    || !Number.isInteger(review.revision) || review.revision < 1 || review.revision > 2_147_483_647) throw new Error("Invalid source review link");
  return `/settings?${new URLSearchParams({ section: "imports", sourceReview: review.batchId,
    sourceReviewCompany: companyId, sourceReviewItem: review.itemId, sourceReviewRevision: String(review.revision) })}#source-review-history`;
}

/** The receiving workspace reauthorizes this company and saved task. */
export function sourceImportTaskHref(companyId: string, taskRequestId: string, batchId: string): string {
  if (!validHistoryId(companyId) || !validHistoryId(batchId) || !/^[a-f0-9]{32}$/.test(taskRequestId)) throw new Error("Invalid saved import link");
  return `/settings?${new URLSearchParams({ section: "imports", importTask: taskRequestId,
    importCompany: companyId, importView: "results", sourceReview: batchId, sourceReviewCompany: companyId })}#import-task`;
}

/** Before-revision cursors are exclusive; the maximum revision has no representable successor. */
export function sourceReviewBeforeRevision(review: PinnedSourceReview | null): number | undefined {
  return review && review.revision < 2_147_483_647 ? review.revision + 1 : undefined;
}

export function exactSourceReviewRevision<T extends { itemId: string; revision: number }>(entries: readonly T[], review: PinnedSourceReview): T | undefined {
  return entries.find((entry) => entry.itemId === review.itemId && entry.revision === review.revision);
}

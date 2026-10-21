import { stdbParamsToJson } from '@lumiere/erp-shared/stdb-params-json';

type Row = Record<string, unknown>;

function count(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** `delete_knowledge_category` (knowledge_article_category:delete) refuses a category that has articles. */
export function canDeleteKnowledgeCategory(category: Row): boolean {
  return count(category.articleCount ?? category.article_count) === 0;
}

/** `remove_article_member` (knowledge_article:write) has nothing to remove from an article without members. */
export function canRemoveArticleMember(article: Row): boolean {
  return count(article.articleMemberCount ?? article.article_member_count) > 0;
}

/** The member identity typed into the remove dialog, or null when blank. */
export function parseMemberIdentity(values: Row | null | undefined): string | null {
  const member = String(values?.member ?? '').trim();
  return member === '' ? null : member;
}

/**
 * `update_knowledge_category` body. The reducer keeps a field left out, so a blank description or
 * colour means "no change" rather than "clear"; a name is required, the colour is 0 to 11 and the
 * sequence a whole number from 0. Null when the name is blank or a number is out of range.
 */
export function toKnowledgeCategoryUpdateBody(values: Row | null | undefined): Record<string, unknown> | null {
  if (values == null) return null;
  const name = String(values.name ?? '').trim();
  if (name === '') return null;
  const params: Record<string, unknown> = { name };
  const description = String(values.description ?? '').trim();
  if (description !== '') params.description = description;
  const color = String(values.color ?? '').trim();
  if (color !== '') {
    const n = Number(color);
    if (!Number.isInteger(n) || n < 0 || n > 11) return null;
    params.color = n;
  }
  const sequence = String(values.sequence ?? '').trim();
  if (sequence !== '') {
    const n = Number(sequence);
    if (!Number.isInteger(n) || n < 0) return null;
    params.sequence = n;
  }
  return stdbParamsToJson(params, 'UpdateKnowledgeCategoryParams');
}

/** Delay for `schedule_document_retention_purge`: a whole number of seconds, at least 1. */
export function parseRetentionDelaySeconds(value: unknown): number | null {
  const text = String(value ?? '').trim();
  if (text === '') return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

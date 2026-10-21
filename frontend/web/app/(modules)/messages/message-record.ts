import { variantTag } from '@lumiere/erp-workflows';
import { recordPageHref } from '@/lib/record-page-href';

type Row = Record<string, unknown>;

/** Where a message's page lives. */
export function messageRecordHref(message: Row): string | undefined {
  return message.id == null ? undefined : `/messages/${String(message.id)}`;
}

/** The page of the record a message is filed on, when that record has one. */
export function messageRecordPageHref(message: Row): string | undefined {
  return recordPageHref(message.model, message.resId ?? message.res_id);
}

/** An optional id cell (`7`, `"7"`, `{ some: 7 }`, `null`) as a string, or undefined. */
export function optionalId(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'object' && 'some' in value) return optionalId((value as { some: unknown }).some);
  if (typeof value === 'object') return undefined;
  const text = String(value);
  return text === '' ? undefined : text;
}

/** The replies to a message, oldest first. */
export function repliesTo(messages: ReadonlyArray<Row>, messageId: string): Row[] {
  return messages
    .filter((row) => optionalId(row.parentId ?? row.parent_id) === messageId)
    .sort((a, b) => Number(a.date ?? 0) - Number(b.date ?? 0));
}

/** The first line of a message body with markup removed, shortened for a title. */
export function messageTitle(message: Row, max = 80): string {
  const text = String(message.body ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return `#${String(message.id ?? '')}`;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Plain label of a message type: `{ tag: 'Comment' }` → "comment". */
export function messageKind(message: Row): string {
  return variantTag(message.messageType ?? message.message_type).toLowerCase() || 'message';
}

const hexOf = (value: unknown): string => {
  if (value && typeof value === 'object' && '__identity__' in value) return hexOf((value as { __identity__: unknown }).__identity__);
  if (value && typeof value === 'object' && typeof (value as { toHexString?: unknown }).toHexString === 'function') {
    return (value as { toHexString: () => string }).toHexString().toLowerCase();
  }
  return String(value ?? '').trim().toLowerCase().replace(/^0x/, '');
};

/**
 * Display name of a message author from the users list (matched on the identity or the user id);
 * unknown authors read as a shortened identity, and a message without one as ''.
 */
export function messageAuthorName(message: Row, users: ReadonlyArray<Row>): string {
  const authorHex = hexOf(message.authorId ?? message.author_id);
  if (!authorHex) return '';
  const user = users.find((row) => [row.identity, row.id, row.userId, row.user_id].some((v) => v != null && hexOf(v) === authorHex));
  const name = String(user?.name ?? user?.displayName ?? user?.display_name ?? user?.email ?? '').trim();
  return name || (authorHex.length > 12 ? `${authorHex.slice(0, 8)}…` : authorHex);
}

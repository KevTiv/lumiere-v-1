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

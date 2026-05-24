/** Loose row shape from `/api/query/mail-messages`. */
export type MailMessageQueryRow = Record<string, unknown>;

/** Primary label for mail message rows (subject or truncated body). */
export function mailMessagePrimaryLabel(row: MailMessageQueryRow): string {
  const subject = row.subject;
  if (typeof subject === "string") {
    const t = subject.trim();
    if (t.length > 0) return t;
  }
  const body = row.body;
  if (typeof body === "string") {
    const t = body.trim();
    if (t.length > 0) return t.length > 80 ? `${t.slice(0, 77)}...` : t;
  }
  const id = row.id;
  if (typeof id === "number" || typeof id === "bigint") return `#${id}`;
  if (typeof id === "string" && id.trim() !== "") return `#${id.trim()}`;
  return "";
}

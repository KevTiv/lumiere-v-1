import MailMessageRow from "../generated/mail_message_table";
import type { Infer } from "spacetimedb";
import { getStdbConnection } from "../connection";

// ── Row types ─────────────────────────────────────────────────────────────────
export type MailMessage = Infer<typeof MailMessageRow>;

// ── Subscription SQL ──────────────────────────────────────────────────────────
export function messagesSubscriptions(organizationId: bigint): string[] {
  const id = String(organizationId);
  return [
    `SELECT * FROM mail_message WHERE organization_id = ${id}`,
  ];
}

// ── Query functions ───────────────────────────────────────────────────────────
export function queryMailMessages(): MailMessage[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.mail_message.iter()].sort(
    (a, b) => Number(b.date ?? 0) - Number(a.date ?? 0),
  );
}

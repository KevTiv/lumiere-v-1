import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * Messages mutations via Next.js BFF `POST /api/call/:reducer`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` messages hooks.
 */
export const MESSAGES_BFF_REDUCERS = [
  "create_message_batch",
  "create_invoice_reminder_batch",
  "create_message_template",
  "create_operational_message",
  "record_message_copied",
  "review_message_batch",
  "cancel_message_batch",
  "set_contact_communication_preference",
  "post_message",
  "post_internal_note",
  "subscribe_to_record",
  "unsubscribe_from_record",
] as const;

export type MessagesBffReducerKey = (typeof MESSAGES_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<MessagesBffReducerKey>();

/** Same-origin path used by `apiFetch` in the web app. */
export function messagesBffCallUrl(reducer: MessagesBffReducerKey): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

export function messagesBffPost(
  reducer: MessagesBffReducerKey,
  args: unknown[],
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: messagesBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCallBody(args),
    },
  };
}

/** Subscription resource keys whose mirrors should reflect messages reducer effects. */
export const MESSAGES_COMMAND_SUBSCRIPTION_HINTS: Record<
  MessagesBffReducerKey,
  readonly string[]
> = {
  create_message_batch: ["message-batches", "operational-messages"],
  create_invoice_reminder_batch: ["message-batches", "operational-messages"],
  create_message_template: ["message-templates"],
  create_operational_message: ["operational-messages", "message-batches"],
  record_message_copied: ["operational-messages"],
  review_message_batch: ["message-batches", "operational-messages"],
  cancel_message_batch: ["message-batches", "operational-messages"],
  set_contact_communication_preference: ["contact-communication-preferences"],
  post_message: ["mail-messages"],
  post_internal_note: ["mail-messages"],
  subscribe_to_record: ["mail-followers"],
  unsubscribe_from_record: ["mail-followers"],
};

export function messagesCommandContract(
  reducer: MessagesBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Messages reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: MESSAGES_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}

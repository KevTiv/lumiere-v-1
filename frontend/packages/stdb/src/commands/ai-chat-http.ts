
import type { ReducerCommandContractMeta } from "./types";

export const AI_CHAT_BFF_REDUCERS = [
  "append_ai_chat_message",
  "archive_ai_chat_session",
  "create_ai_chat_session",
  "update_ai_chat_session_title",
] as const;

export type AiChatBffReducerKey = (typeof AI_CHAT_BFF_REDUCERS)[number];

export const AI_CHAT_COMMAND_SUBSCRIPTION_HINTS: Record<
  AiChatBffReducerKey,
  readonly string[]
> = {
  append_ai_chat_message: ["ai-chat-messages"],
  archive_ai_chat_session: ["ai-chat-sessions"],
  create_ai_chat_session: ["ai-chat-sessions"],
  update_ai_chat_session_title: ["ai-chat-sessions"],
};

export function aiChatCommandContract(
  reducer: AiChatBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `AI chat reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: AI_CHAT_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization/company scope; args must match SpacetimeDB u64 JSON rules.",
  };
}

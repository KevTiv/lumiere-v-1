/**
 * Compile-only — Messages BFF reducer keys stay aligned with `messagesBffCallUrl`.
 */
import {
  MESSAGES_BFF_REDUCERS,
  messagesBffCallUrl,
  messagesCommandContract,
} from "../commands/messages-http";

for (const k of MESSAGES_BFF_REDUCERS) {
  void messagesBffCallUrl(k);
  void messagesCommandContract(k);
}

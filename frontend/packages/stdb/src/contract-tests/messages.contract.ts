/**
 * Compile-only — Messages BFF reducer keys stay aligned with command metadata.
 */
import {
  MESSAGES_BFF_REDUCERS,
  messagesCommandContract,
} from "../commands/messages-http";

for (const k of MESSAGES_BFF_REDUCERS) {
  void messagesCommandContract(k);
}

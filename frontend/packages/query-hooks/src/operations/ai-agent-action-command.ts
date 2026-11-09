import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { responseErrorMessage } from "@lumiere/api-client/response-error"
import { apiFetch } from "../http"

export type AiAgentActionCommand = {
  agentId: number
  action: "chat" | "analytics_read" | "analytics_run" | "web_search"
  enabled: boolean
}

/** Only changes one binding; private configuration stays on the server. */
export async function dispatchAiAgentActionCommand(
  input: AiAgentActionCommand,
) {
  const { urlPath, init } = stdbBffCommandPost("set_ai_agent_action", input)
  const response = await apiFetch(urlPath, init)
  if (!response.ok) throw new Error(await responseErrorMessage(response))
}

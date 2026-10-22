# Mistral / OpenCode compatibility check

Checked 2026-10-16. This compares source and documented contracts; it does not
claim a live Large 4 run. It supplements the
[harness readiness assessment](../plans/mistral-harness-readiness.md).

This comparison records the initial source-check state. The follow-up
[reasoning/replay implementation](./mistral-reasoning-replay-2026-10-16.md)
implements explicit effort and ephemeral replay; the durable runtime boundary
and live-provider limitations remain explicit there.

## Reproducible sources

- OpenCode `dev`, commit
  [`00e7472faa2ef15b30db6110440117e4e7e1a72a`](https://github.com/anomalyco/opencode/tree/00e7472faa2ef15b30db6110440117e4e7e1a72a),
  including its native Mistral provider, request compiler, decoder and tests.
- Its models.dev catalog, commit
  [`983e99ff2ba5f7c0c663781ad90c43210820d901`](https://github.com/anomalyco/models.dev/tree/983e99ff2ba5f7c0c663781ad90c43210820d901).
- Mistral's official Python SDK, commit
  [`6229ed96cb5bfcfc9068a11dee5ff357697a8ad9`](https://github.com/mistralai/client-python/tree/6229ed96cb5bfcfc9068a11dee5ff357697a8ad9),
  using its generated wire schemas rather than assuming generic OpenAI shapes.
- Mistral's current [chat reference](https://docs.mistral.ai/api/endpoint/chat),
  [function-calling guide](https://docs.mistral.ai/studio/conversations/function-calling),
  [reasoning guide](https://docs.mistral.ai/studio/conversations/reasoning) and
  [Large 4 model card](https://docs.mistral.ai/models/mistral-large-4-0).

## Patch checks

| Behavior | Evidence | Result |
| --- | --- | --- |
| String or chunk-list assistant content | Official SDK [`AssistantMessage`](https://github.com/mistralai/client-python/blob/6229ed96cb5bfcfc9068a11dee5ff357697a8ad9/src/mistralai/client/models/assistantmessage.py); OpenCode [`MistralChoice`](https://github.com/anomalyco/opencode/blob/00e7472faa2ef15b30db6110440117e4e7e1a72a/packages/ai/src/protocols/mistral-chat.ts#L193) | The new parser accepts both and exposes only visible text. |
| Required single-shot outcome | Mistral's guide documents `any` and `parallel_tool_calls=false`; OpenCode [`fromRequest`](https://github.com/anomalyco/opencode/blob/00e7472faa2ef15b30db6110440117e4e7e1a72a/packages/ai/src/protocols/mistral-chat.ts#L386) maps required → `any` and disabled parallel use → `false` | Matches the patch for typed single-shot requests. Ordinary requests retain automatic tool choice; this is not a global agent-loop setting. |
| Non-text units inside thinking | Official [`ThinkChunk`](https://github.com/mistralai/client-python/blob/6229ed96cb5bfcfc9068a11dee5ff357697a8ad9/src/mistralai/client/models/thinkchunk.py) permits text, references and tool references; OpenCode [`thinkingUnits`](https://github.com/anomalyco/opencode/blob/00e7472faa2ef15b30db6110440117e4e7e1a72a/packages/ai/src/protocols/mistral-chat.ts#L501) tolerates those shapes | The first patch incorrectly required every unit to have `text`. Reproduced the failure and corrected it; references remain outside visible output. |
| Object-valued tool arguments | Official [`FunctionCall`](https://github.com/mistralai/client-python/blob/6229ed96cb5bfcfc9068a11dee5ff357697a8ad9/src/mistralai/client/models/functioncall.py) permits object or string; OpenCode's [`toolText`](https://github.com/anomalyco/opencode/blob/00e7472faa2ef15b30db6110440117e4e7e1a72a/packages/ai/src/protocols/mistral-chat.ts#L595) handles both | The existing string-only parser failed a schema-valid object response. Corrected it; outgoing assistant tool arguments still serialize to JSON strings. |
| `model_length` finish reason | Official [`ChatCompletionChoice`](https://github.com/mistralai/client-python/blob/6229ed96cb5bfcfc9068a11dee5ff357697a8ad9/src/mistralai/client/models/chatcompletionchoice.py); OpenCode [`mapFinishReason`](https://github.com/anomalyco/opencode/blob/00e7472faa2ef15b30db6110440117e4e7e1a72a/packages/ai/src/protocols/mistral-chat.ts#L483) | Corrected the pre-existing unknown mapping to the existing exhausted-output state. |
| Optional function `strict` flag | Official [`Function`](https://github.com/mistralai/client-python/blob/6229ed96cb5bfcfc9068a11dee5ff357697a8ad9/src/mistralai/client/models/function.py); OpenCode explicitly sends `false` | Our omission is schema-valid. No new strict-schema guarantee is claimed. |

The regressions use synthetic messages matching these schemas. They are not
captured Large 4 responses. Thinking references, signatures and private text
are checked to stay outside `LlmResponse` and its debug representation.

## What OpenCode actually does for Large 4

The catalog has an explicit
[`mistral/mistral-large-4` entry](https://github.com/anomalyco/models.dev/blob/983e99ff2ba5f7c0c663781ad90c43210820d901/providers/mistral/models/mistral-large-4.toml),
with reasoning effort options `none` and `high`. Its
[base model metadata](https://github.com/anomalyco/models.dev/blob/983e99ff2ba5f7c0c663781ad90c43210820d901/models/mistral/mistral-large-4.toml)
declares tool calling and structured output. The
[native provider](https://github.com/anomalyco/opencode/blob/00e7472faa2ef15b30db6110440117e4e7e1a72a/packages/ai/src/providers/mistral.ts)
uses `MISTRAL_API_KEY`, the Mistral endpoint, and the shared Mistral protocol.
That compiler forwards the selected model ID and maps `reasoningEffort` to
`reasoning_effort`; it has no separate Large 4 execution loop.

This minimal example adapts OpenCode's native provider API to its catalog ID:

```typescript
import { configure } from "@opencode/ai/providers/mistral"

// MISTRAL_API_KEY is supplied to the process separately.
const model = configure({
  providerOptions: { reasoningEffort: "none" },
}).model("mistral-large-4")
```

Use the actual account-visible ID if `/v1/models` returns a different alias.
This snippet is source-derived, not a tested installation or live invocation.
For a complete request/tool-loop example, OpenCode's
[recorded provider tests](https://github.com/anomalyco/opencode/blob/00e7472faa2ef15b30db6110440117e4e7e1a72a/packages/ai/test/provider/mistral.recorded.test.ts)
show `configure`, generation limits, tool calls/results, and reasoning replay.
Those recordings identify `mistral-small-latest` (and a separate hosted GLM
case), **not Large 4**. They establish protocol examples without proving a
Large 4 run.

Do not copy the advertised 1M context into a production profile without checking
the account catalog. The direct Mistral catalog entry's comments report a
524,288-token live limit while the inherited base metadata advertises 1M. The
separate [OpenCode-hosted entry](https://github.com/anomalyco/models.dev/blob/983e99ff2ba5f7c0c663781ad90c43210820d901/providers/opencode/models/mistral-large-4.toml)
explicitly overrides context to 524,288. These are upstream statements, not
measurements made in this task.

## Differences recorded before the follow-up implementation

- **Explicit reasoning:** OpenCode sends the requested effort. Our transport
  still omits Mistral reasoning settings; the patch does not enable `high`.
- **Native replay:** OpenCode preserves original thinking units and opaque
  metadata and sends them back as thinking chunks. Mistral recommends this for
  multi-turn reasoning. Our transport discards that material and exposes only a
  presence bit. It cannot claim full reasoning/replay parity. The governed
  adapters currently make independent structured calls; adding replay requires
  a deliberate provider-state design consistent with repository policy.
- **Streaming:** OpenCode compiles `stream=true` and assembles SSE deltas. Our
  client currently handles complete JSON responses. The shape compatibility
  checks above do not establish SSE support.
- **Tool IDs:** OpenCode normalizes replay IDs to nine alphanumeric characters.
  Our direct path preserves provider IDs; it has no equivalent normalization
  for imported or cross-provider history. Mistral-specific test examples now
  use valid IDs rather than the generic OpenAI `call_123` example.
- **Provider errors:** OpenCode explicitly classifies `error` and
  `network_error` finish reasons. Our shared termination mapper still classifies
  these as unknown; typed provider-failure handling remains follow-up work.

## Validation

Before correction, the two new reference/argument regressions failed with the
original parser. After correction:

- Provider transport tests: **26 passed, 2 existing live tests ignored**.
- Full gateway suite: **666 passed, 8 ignored**.
- Package formatting, package build check, reducer-call lint, trusted-route
  boundary lint and `git diff --check` are verified with the final patch.

No Mistral credentials, live Mistral request, upstream OpenCode test execution,
deployment or full Large 4 admission is claimed.

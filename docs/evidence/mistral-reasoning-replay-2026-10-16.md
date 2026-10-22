# Mistral reasoning controls and native replay

Implemented after the [OpenCode compatibility check](./mistral-opencode-compatibility-2026-10-16.md).
This closes explicit reasoning controls and bounded in-memory native replay at
the direct-provider transport. Live Large 4 validation still needs separately
configured credentials and egress.

## Configure reasoning

On the AI gateway, opt in exact account-visible model IDs:

```dotenv
MISTRAL_REASONING_MODELS=mistral-large-4
MISTRAL_REASONING_EFFORT=high
```

Use the exact ID returned by your account's `/v1/models`; for example, use
`mistral-large-4-0` instead if that is the account-visible ID. No model aliases,
prefixes or wildcard matches are inferred. The effort accepts `none` or `high`;
configuring an effort without an explicit model list fails startup validation.
Both variables are forwarded by the main Compose file and documented in the
gateway and Docker environment examples.

This is deployment configuration, shared by the gateway process. It is not an
immutable per-organization model-profile field. Agent model allowlists,
intelligence policies, spend reservations and normal ERP authorization still
apply. A future per-profile effort setting needs a normal generated-contract
release; no generated files or pinned contracts are changed here.

For a matching direct Mistral request:

| Request thinking mode | Wire behavior |
| --- | --- |
| `ProviderDefault` | Send the configured effort, or omit it when no default is configured |
| `Disabled` | Send `reasoning_effort="none"`, overriding a configured `high` |
| `Enabled` | Send `reasoning_effort="high"` |

Unlisted models retain their previous default/disabled request shape. An
explicit enabled request for an unlisted model is rejected before spend
reservation. Kong, Gemini and Ollama do not receive these Mistral fields.
The Mistral reasoning adapter now uses the admitted profile output ceiling,
clamped to the agent ceiling before admission, instead of its former 1,024-token
cap. Decision requests continue to disable thinking. Ollama's separate bounded
thinking-starvation fallback remains Ollama-only; this work adds no automatic
Mistral high-to-none retry.

## Continue a native assistant turn

`LlmResponse::to_assistant_message()` preserves a bounded native Mistral turn
when available. A trusted transport caller can build a continuation by adding
that message and the corresponding tool result or next user message to the
next request's `messages`.

The opaque state preserves the ordered assistant content, thinking units,
signatures, `closed` and unknown native metadata. Tool arguments are normalized
to the Mistral assistant-request JSON-string form. The state:

- Is bound to the requested model ID, allowing the response to report a
  different resolved alias without changing that binding.
- Is accepted only by direct Mistral for that same requested model; proxy,
  different-provider and different-model continuations are rejected.
- Has private fields, redacted `Debug`, no serde implementation and no global
  cache. Visible answer text and typed outcomes do not contain the native
  thinking.
- Is capped at 1 MiB for one native assistant message and for aggregate replay
  history. Oversized responses omit the complete replay block while preserving
  visible output and usage; signed content is never truncated. Oversized
  request history fails preflight.
- Is omitted for partial/failed responses and invalid tool calls. If the
  caller edits the decoded visible output or provider/model identity, the
  response helper returns normalized visible-only history rather than replaying
  an obsolete native snapshot.

Transport preflight runs before a spend reservation or dispatch claim. Prompt
admission counts the entire replayed assistant wire message once, including its
thinking, visible answer and tool calls. It does not add the visible text a
second time. Provider errors and malformed-response errors use safe summaries
so an upstream echo of private content cannot enter durable attempt failures.

## Governed runtime boundary

The current Decision, Generation and Reasoning adapters make independent typed
requests. They do not automatically replay a previous model turn. Their
checkpoint, evidence, proposal, review and audit contracts remain unchanged and
contain no native thinking state. Restart/resume reconstructs governed state
from those typed records, not provider-private reasoning.

The transport can now preserve an in-memory conversation correctly. This does
not claim durable reasoning continuity across governed steps or restarts, SSE
support, provider-instance isolation, or full Large 4 production admission.

## Verification

Regression coverage includes effort selection and override, exact-model
admission, native content/tool-result roundtrip, alias binding, provider/model/
proxy rejection, redaction, whole-block and aggregate size bounds, edited-output
snapshot rejection, replay byte accounting, pre-reservation rejection, admitted
Mistral output budgets and the absence of automatic Mistral starvation retry.
Final gateway check results are recorded after the coordinated validation.

- `cargo test --offline --locked -p ai-gateway`: **683 passed, 8 ignored**.
- Final `providers::llm::tests` run: **36 passed, 2 ignored**.
- `cargo check --offline --locked -p ai-gateway`: passed with warnings.
- `cargo fmt -p ai-gateway -- --check`, reducer-call literal lint,
  trusted-route boundary lint and `git diff --check`: passed.
- Main Compose YAML parsed and both reasoning-variable pass-throughs verified.

The existing loopback HTTP fixtures required network sandbox access. No live
Mistral request was executed and no credentials were configured or inspected.

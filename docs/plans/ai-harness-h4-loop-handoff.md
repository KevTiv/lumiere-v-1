# H4 loop core handoff

This slice is stacked on H3 PR #22 and consumes the existing provider message
types and authorized tool view. It adds no skill or HTTP routing.

The loop accepts an injected completion source, executor and event recorder.
It requires a nonzero run and persists a start event before the first provider
call. The STDB recorder uses `append_ai_agent_run_step`, whose reducer checks
write authority, tenant/company ownership and active run status. The production
adapter binds recording and execution to the same `ToolContext`.

Each provider response contributes its reported usage to the token cap. Round
and tool-call caps bound providers that report zero usage. Calls must name an
advertised tool and have valid object arguments; malformed batches stop before
execution. Assistant calls and structured tool results are carried into the next
completion request. Recorder errors propagate immediately and prevent further
provider or tool work.

This token cap is based on reported usage; it cannot guarantee a monetary limit
or reserve prompt tokens before a provider accepts a request. H5 must implement
atomic budget admission and per-call policy before production activation.

Final text is a candidate answer requiring the later answer gate. It does not
mark the durable run completed. The recorded stop is evidence for the eventual
run lifecycle adapter. Resumption, duplicate invocation and durable step-number
allocation are not implemented in this fresh-invocation core.

H3's generated catalog is still empty and nonempty conversion is unsupported.
Synthetic provider/tool fixtures exercise H4 independently of production tool
admission. H5 must add policy, budgets and draft-approval stop handling; the
recorded adapter rejects `action_draft` until that handling exists. Ollama keeps
its legacy single-shot path.

Acceptance here covers the loop core and recorder adapter wiring. Live STDB
persistence and end-to-end skill admission remain separate acceptance gates.

Validation: 13 scripted loop tests passed, including evidence ordering,
transcript IDs and structured results in subsequent provider requests,
malformed/unknown calls, replayed IDs, all three caps and recorder failures.
The full gateway suite passed 184 tests with one existing Qdrant integration
test ignored. Locked compilation, workspace formatting and diff checks passed.

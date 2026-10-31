# Finance skill readiness admission contract

Status: **BLOCKED at the shared read-contract boundary.** This is a bounded A3
producer-to-consumer proposal. It does not certify or activate a Finance skill.
Base: `1b842603d950c6c94bb91c845c4cfbe5f8c5e1ec`; A1 company selector fix is separate.

The Finance form needs a no-cost answer for the exact selected skill, company and
agent before it enables paid dispatch. An active catalog row, provider key, owner
role or certification request is insufficient for that answer.

## Existing authority and missing read

The current execution path is:

`FinanceReviewPanel` -> `useAiFinanceReview` -> session-owned
`/api/ai/skills/finance/[skill]` -> trusted actor headers -> gateway
`post_finance_review` -> `policy_for`/`load_active_manifest` -> governed named read
-> `run_skill_admitted` -> current actor, company skill configuration, agent,
intelligence policy, immutable manifest and spend admission.

Existing reads cover only parts of that chain:

- `useAiSkillReleases` and `useAiSkillVersions` read authorized tenant rows through
  `api-server/src/query_exec/ai.rs`. They expose exact release/version relations,
  but do not evaluate the running adapter hash or company execution binding.
- `api-server/src/routes/ai_certifications.rs` returns server-computed promotion
  readiness for a certification request. Promotion readiness is not run admission.
- `/v1/harness/governed/readiness` is internal-secret protected. Its
  `inspect_governed_readiness` implementation is pinned to `report_analysis` and
  its company skill policy. It is not a Finance skill readiness API.
- `load_active_manifest` checks the exact tenant release and compiled adapter
  version/source hash. That authoritative result has no session-owned Finance
  readiness read adapter.

The consumer must not combine these lists in React and label the result ready.
An exact active release is a necessary prerequisite, but cannot establish the
whole positive condition. No paid request should be used as the readiness probe.

## Proposed producer contract

The coordinator should assign a gateway/BFF owner to expose a bounded readiness
read through the existing Finance execution authority. This proposal does not
add the endpoint or its outcome type locally in the form.

Suggested browser adapter: `POST /api/ai/skills/finance/[skill]/readiness`.
Input contains only the selected company ID and exact agent ID. The skill is one
of the existing five Finance keys. The BFF derives actor, organization and session
credentials, validates company access and forwards trusted context. It must not
accept role, organization, permission, token or policy authority from JSON.

The gateway producer should reuse the same canonical pre-run readers as Finance
execution, extracting shared read-only admission logic where required. The read
must not create a run, reserve or settle spend, call a provider, certify a skill,
change a binding or broaden a grant. If current derived authorization cannot be
read safely, return unavailable rather than granting access or guessing.

The typed result needs:

- `ready`, `blocked` or `unavailable`, plus a bounded reason code.
- Exact skill, company, agent and active release/version identities when those
  fields are authorized and validated. Do not return credentials or raw failures.
- A current scope/revision identity so a response from an older company or agent
  selection cannot enable the current form. Readiness is advisory; dispatch must
  still reauthorize and revalidate all admission conditions.
- Distinct reasons for missing or duplicate active release, unsupported/stale
  adapter version, unreadable configuration, mismatched company skill/agent
  binding, current authorization failure and runtime/spend admission unavailable.

Reason codes and the result type belong with the shared admission owner. Confirm
whether new contract generation is needed before choosing a release version.
No native schema or reducer change is established by this investigation alone.

## Consumer and verification after producer delivery

The query key must include actor/session generation, organization, company, skill
and selected agent. A scope change clears prior readiness and retained errors.
Loading, stale, malformed or failed reads disable submit and explain the next
required action. Request completion must be checked against the current key.
A second check is needed in the submit handler; a disabled button alone is not an
admission rule. Keep current execution-route checks.

Test the producer without provider dispatch: absent release, exact active version,
stale hash, duplicate release, wrong company, wrong actor, revoked grant,
unavailable reader and configuration mismatch. Assert zero runs, reservations and
provider calls. Test the mounted form for unavailable state and a late reply from
a prior scope. After deployment, verify the actual tenant release and exact
returned IDs. Do not infer live readiness from synthetic fixtures.

No new A3 consumer or readiness implementation was written. The convergence skill
requires a stop when a new shared outcome owner is required or current permission
behavior is unclear. A1 remains an independent tested source fix. The coordinator
can assign this producer contract while other source packets progress.

# ERP skills professional usability plan

Date: 2026-10-28. Status: proposed implementation plan.
Repository baseline: `eeb44cf50474697da2a19f28841a74e13df6cf2c`.

Improve the existing alpha skills by making each supported workflow explicit,
consistent with its executable contract, and measurable on smaller models.
The main opportunity is to reduce the decisions a model must invent: inputs,
evidence selection, response structure, and recovery should have clear recipes.
Keep calculations, authorization, release admission, and business effects in
their existing code owners.

Start with contract drift and a measured pilot for `report_analysis` and
`finance_report_review`. Extend the successful pattern across all 15 bundled
skills. Rewriting every prompt before measuring the pilot would make regressions
harder to diagnose.

## Current strengths and gaps

The five finance reviews already use closed input contracts, a fixed
`finance_review_read` capability, immutable observations, exact money, claim
support checks, and independent review. They require separately certified active
tenant releases. The existing runtime also has typed decision graphs, model
routing policies, bounded recovery, and source-bound certification. Build on
these rather than adding a second agent framework.

Sources: [finance implementation status](../plan/finance-skill-expansion-status.md),
[finance input contracts](../../crates/finance-review-core/src/lib.rs),
[governed programs](../../ai-gateway/src/orchestrator/governed_programs.rs), and
[executor and answer admission](../../ai-gateway/src/orchestrator/governed_program.rs).
The implementation status distinguishes local verification from live tenant and
provider acceptance; preserve that distinction in release labels.

| Observed gap | Evidence | Effect and proposed response |
| --- | --- | --- |
| Uneven procedural detail | Nine of 15 skill bodies contain fewer than 60 whitespace-separated words. None of the 15 bodies contains a fenced worked example. | Older skills depend heavily on model judgment. Add concise recipes and executable examples, not a minimum word count. |
| Contradictory analytics guidance | `report_analysis/references/analytics-rules.md` recommends sandbox SQL; `run.rs` rejects raw SQL inputs and the program uses `analytics_summary`. | Remove the obsolete recommendation and document supported typed analytics. |
| Prose and finance inputs differ | Bank instructions require a cutoff, but `BankInput` accepts only `statementId` and optional `query`. Expense instructions require a current version, but `ExpenseInput` accepts `recordKind`, `recordId`, and optional `query`. Variance prose mentions budgets/decomposition beyond the current date-based report contract. | Document caller inputs separately from owner-resolved metadata. Describe unsupported requests as capability limits. |
| Advertised tools and execution differ | Report Markdown lists snapshot/search/artifact tools; its compiled reviewed call is analytics. Procurement Markdown lists `fetch_url`, artifact saving, and an optional action draft; the current reviewed programs list search capabilities. | Generate the effective execution description from the manifest and program; clearly distinguish later draft workflows. Do not expand authority to satisfy old prose. |
| Folder layout does not provide selective loading | `compose_prompt` appends every declared reference and silently skips missing/unreadable files. Import mapping has four references, adding approximately 716 words to its 282-word body. | Validate references and introduce server-selected, bounded reference inclusion only where useful. |
| Release dependency coverage needs reconciliation | The report bundle hash explicitly includes `SKILL.md`, but not its appended analytics reference. The runtime-image workflow lists six individual skill Markdown files rather than the whole skill tree. | Audit the complete image/runtime/certification chain and bind all effective prompt dependencies; include reference-only changes in validation and relevant image builds. This observation alone does not establish the behavior of every outer runtime hash. |
| Deterministic helpers are described as open-ended assistants | Import mapping, daily briefing, and insights have dedicated named-read adapters. Import prose also discusses workspace paths absent from `ImportMappingInput`. | Document the actual route and response for each execution mode. Separate optional client-side preparation from gateway behavior. |
| Output guidance can compete with admission | Finance prose requests tables and sections; generation requires at most eight fully supported claims whose ordered text covers the answer. | Supply examples that pass the actual `FinalDraft` contract. Render richer tables from typed observations in the UI where appropriate. |

Relevant code: [Markdown loader](../../ai-gateway/src/skills/md_loader.rs),
[runtime loader](../../ai-gateway/src/orchestrator/skill_loader.rs),
[run and objective construction](../../ai-gateway/src/orchestrator/run.rs),
[reviewed LLM manifests](../../ai-gateway/src/harness/governed_llm_skills.rs),
[certification binding](../../ai-gateway/src/harness/certification.rs), and
[runtime-image workflow](../../.github/workflows/build-rust-runtime-image.yml).

## GitHub comparison

These are popular reference implementations, not a quality ranking or evidence
that their prompts improve our models. Approximate stars were displayed by
GitHub when checked on 2026-10-28. Inspected primary skill files were verified
against the commits linked below.

| Reference | Observed popularity | Useful pattern | ERP adaptation |
| --- | --- | --- | --- |
| [Anthropic skills](https://github.com/anthropics/skills) | About 184k stars | [Skill creator](https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/skill-creator/SKILL.md) compares revised skills against baselines, grades assertions, and tracks time/tokens and variation. It separates instructions from optional resources. | Compare current and candidate skills on identical evidence and model profiles. Track operator usefulness as well as admission success. |
| [Obra Superpowers](https://github.com/obra/superpowers) | About 307k stars | [Writing skills](https://github.com/obra/superpowers/blob/2ce8aa15d05bd57213e6f746f953aafb7ded7a8b/skills/writing-skills/SKILL.md) starts from observed failures, tests skill behavior, and distinguishes output recipes from rules for discipline failures. [Verification](https://github.com/obra/superpowers/blob/2ce8aa15d05bd57213e6f746f953aafb7ded7a8b/skills/verification-before-completion/SKILL.md) requires evidence for completion claims. | Use observable branches and filled response examples. Test pressure to guess balances, omit caveats, or imply approval. Define completion through owner evidence and admission. |
| [Vercel agent skills](https://github.com/vercel-labs/agent-skills) | About 33k stars | [React best practices](https://github.com/vercel-labs/agent-skills/blob/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/react-best-practices/SKILL.md) prioritizes rules, indexes focused files, and uses incorrect/correct examples. | Give critical ERP invariants stable identifiers, put the task procedure first, and attach only relevant examples and references. |

Apply the patterns within our existing governed runtime. Generic shell scripts,
coding-agent hooks, mandatory multi-agent loops, and framework-wide instructions
are not required for business users to operate an ERP review. Review licensing
before copying source material; write ERP-specific procedures and examples.

The [Agent Skills specification](https://agentskills.io/specification) defines
lowercase hyphenated names, matching directories, and progressive disclosure.
Our underscore keys, display names, custom metadata, and hand-written parser
form an internal format. Preserve stable runtime keys for alpha. A later exporter
can produce standards-compatible packages and map their names to those keys;
do not rename release identities as a documentation cleanup.

## Target skill contract

Each skill should answer the same practical questions, with detail scaled to its
execution mode. A deterministic helper does not need a large model prompt.

1. **Purpose and routing:** supported user requests, two or three realistic
   phrases, nearby workflows that should receive different requests, and the
   effective availability of the skill for this tenant.
2. **Inputs:** exact accepted field names/types, required values, defaults
   resolved by an owner, and a single bundled clarification for missing inputs.
   Separate model-visible inputs from trusted actor/company/run context.
3. **Procedure:** a short ordered recipe tied to existing program nodes or a
   deterministic adapter. Each branch names an observable condition and outcome.
4. **Evidence:** authoritative owner, freshness/cutoff, currency/scale, coverage,
   source identity, and treatment of untrusted source text.
5. **Response:** an example using the actual response schema, evidence identities,
   and admission rules. A business-facing result should show scope, findings,
   material limitations, and the next useful review step.
6. **Recovery:** distinguish missing inputs, unsupported requests, denied access,
   unavailable sources, stale observations, ambiguous evidence, budget exhaustion,
   and provider failures. Map these to existing runtime outcomes; additional
   public status values require an explicit contract change.
7. **Completion and handoff:** what establishes completion, what remains
   unresolved, and which separate workflow handles any consequential action.

Keep critical invariants beside the step that needs them. Start with a provisional
1,200-token budget for a compiled task prompt including its selected example and
references, excluding evidence and the provider response schema. Measure with
the actual tokenizer; use exceptions when correctness needs more context. This
is an experiment budget, not an industry standard or a hard truncation rule.

### Authoring and compilation

Keep `erp-skills/<existing_key>/SKILL.md` as the reviewed procedure. Add targeted
`references/` and `examples/` resources only when a real scenario needs them.
Store synthetic evaluation inputs and assertions outside the production prompt.
Generate input/output documentation from the Rust contracts wherever possible;
avoid maintaining another independent schema in prose or JSON.

Add an index describing each skill's route, execution mode, effective program,
supported intents, owner, release requirements, and evaluation status. The
checked-in index describes implementation; the runtime must intersect it with
the current tenant release, policy, source availability, and budget. Markdown
`status` is not an activation or certification signal.

The compiler/validator should:

- Reject invalid metadata, duplicate keys, unknown tool/resource references,
  conflicting execution modes, and missing required assets. Validate against
  compiled contracts rather than keyword checks alone.
- Resolve references within approved package roots, including symlink checks.
  Select conditional references using reviewed server predicates, never an
  arbitrary model-supplied path. Record selected paths and hashes with the run.
- Bind the effective body, examples, transitive references, compiler behavior,
  program, schemas, and owner dependencies into the release/certification chain.
  A required resource change must change the binding; absence must fail validation.
- For alpha, validate and bound the current eager composition first. Introduce
  selective loading behind a versioned compiler change after the pilot shows
  context cost or accuracy benefits. It need not become a model-visible tool.
- Keep effective authority as the intersection of release, current policy,
  reviewed program, actor access, and spend admission. Skill prose and tenant
  custom instructions cannot grant tools or change these constraints.

### Example procedure for the finance pilot

User request: “What do we owe suppliers on 27 October?”

1. Route to `finance_report_review`, with `supplier_payables_v1`. Resolve the year
   and company reporting timezone from explicit user intent or authorized company
   context; ask for unresolved values before dispatch. Do not silently use the
   server's timezone.
2. Submit only the accepted input shape. For example, in a synthetic fixture with
   an explicitly selected reporting timezone:

   ```json
   {"reportKey":"supplier_payables_v1","date":"2026-10-27","timezone":"Africa/Kigali"}
   ```

3. The registered program reads and verifies one owner observation. The model
   receives its exact money, coverage, preview status, limitations, and persisted
   evidence identity. It does not calculate payables from invoices itself.
4. Generate a small `FinalDraft`: supported claim text, copied passage support,
   and content assembled from those claims in order. A useful first example
   should show one total and one coverage caveat. Construct fixtures with actual
   projection output so citation IDs and versions remain valid.
5. If only selected supplier records are available, say how many are shown and
   omitted. A source error produces an unavailable outcome, never a zero balance.
6. Keep suggestions distinct from observed facts. Offer the supplier-payables
   review as a next step; do not promise payment or create a collection task.

An incorrect example would say “All suppliers are paid” from an empty or denied
source. The paired correct example should preserve the actual coverage or denial
state. Both examples should be tested against the real admission gate.

## Smaller model execution strategy

The working hypothesis is that smaller models perform better when they receive
one bounded job and an explicit response recipe. Measure this on our workloads;
GitHub popularity does not establish model capability.

- Continue computing money, residuals, comparison percentages, candidate matches,
  and import transformations in their deterministic owners. Give the model
  observations to explain rather than business rules to reconstruct.
- Use one focused generation job after typed evidence acquisition. Preserve
  existing decision nodes where they serve the workflow; measure their value
  and cost before removing or adding routing/reasoning calls.
- Supply one relevant successful example and, where helpful, one failure example.
  Include partial/unavailable evidence cases rather than teaching only happy paths.
- Build bounded evidence views that retain limitations and exact references to
  immutable observations. Label coverage explicitly; never truncate facts into
  an apparently complete report. Measure evidence tokens separately from prompt
  tokens because evidence may dominate total context.
- Validate structure and exact support before publication. Use the existing
  bounded repair mechanism for eligible errors; measure repair frequency and
  failures that bypass repair before adding another recovery loop.
- Select an inexpensive drafter only for the skill/profile combinations that
  pass evaluation. Keep the existing independent reviewer requirements. Include
  reviewer, repair, and fallback spend in the cost of an accepted result.
- Escalate on observed contract/admission failures or unsupported complexity,
  within authorized policy and budget. Model confidence alone cannot approve a
  match, fill missing evidence, or justify another read.
- Keep user intent visible throughout generation and independent review. Only
  `report_analysis` currently appends the extracted question in
  `governed_objective`; test query preservation on other paths before deciding
  whether their bounded node state is sufficient or needs an explicit objective.

Professional UX should show recognizable tasks such as “Review supplier
payables,” required fields with supported choices, availability reasons, source
cutoff and coverage, and safe recovery actions. Preserve run history on reload
without issuing a new provider call. Keep internal prompt names and program
identifiers in the inspector rather than the normal task flow. Evaluate English
and any explicitly supported business languages, date formats, timezones,
currencies, and accounting calendars separately; jurisdiction rules must come
from approved owner policy rather than model knowledge.

## Per skill tailoring

| Skill | First useful improvement | High-value evaluation cases |
| --- | --- | --- |
| `report_analysis` | Remove SQL drift; name supported analytics and use a complete valid `FinalDraft` example. Distinguish operational sales analytics from accounting reports. | Missing question, unrelated question, partial evidence, unsupported P&L request, foreign-run citation. |
| `finance_report_review` | Lead with the three report choices and exact inputs; demonstrate preview/coverage language in admitted claims. | All three reports, large exact money, null due dates, denied source, omitted records. |
| `bank_reconciliation_review` | Require `statementId`; explain owner-resolved cutoff and classify existing candidates with fixed labels. | Same-amount competitors, used payment, partial allocation, reversal, wrong currency. |
| `period_close_review` | Distinguish owner-enforced state requirements from advisory and unavailable checks. | Open/closed period, drafts, unreconciled lines, denied check, state changed after snapshot. |
| `expense_evidence_review` | Align `recordKind`/`recordId`; make observed, ambiguous, missing and unreadable comparisons explicit. | Image without OCR, malicious receipt, changed source version, revoked access, real mismatch. |
| `finance_variance_review` | Document only supported report/date comparisons; preserve exact rational percentages and compatible scope. | Zero/negative baseline, incompatible periods/currency, missing report, unsupported budget or causal request. |
| `process_research` | Define inputs, scope, available summaries, observed bottlenecks and unresolved hypotheses. | No delays, missing time basis, incomplete scope, unsupported causal assertion. |
| `price_search` | Require comparable product/unit/quantity context; label currencies, dates, region, tax/shipping unknowns. Separate research from draft handoff. | Different pack sizes, stale prices, missing shipping, web failure, request to order immediately. |
| `supplier_discovery` | Define region/category fit and evidence-based credibility; distinguish web claims from verified ERP vendor status. | Duplicate businesses, unsupported certifications, ambiguous identity, injected source, no suitable result. |
| `daily_briefing` | Document the dedicated read and exact window/module fields; distinguish no retrieved activity from no business action needed. | Empty results, degraded retrieval, partial modules, timezone boundary, hidden records. |
| `insights_scan` | Explain deterministic detector output, ranking, coverage, and why a finding needs review; distinguish a detector flag from a confirmed defect. | No flags, duplicate findings, incomplete scope, denied source, false causal claim. |
| `import_mapping` | Separate client file preparation from accepted gateway data; show deterministic map/preview responses and metadata review. | Duplicate headers, missing required columns, legitimate negative values under current safety rules, formula/instruction cells, preview errors. |
| `rag_generation` | Define the supplied retrieval envelope, citation recipe and insufficient-evidence response. | Conflicting passages, stale knowledge, injected text, no support, wrong-company source. |
| `form_suggestion` | Define suggestion output, field constraints, provenance and unknown values; use code constraints before model inference. | Required field unknown, invalid enum, conflicting context, suggested submission. |
| `action_draft_generation` | Provide a schema-valid advisory example and exact draft/approval handoff semantics. | Unsupported action, fabricated ID, changed record, duplicate proposal, pressure to execute. |

For deterministic helpers, test the route, adapter, and rendered result first.
Evaluate a model only if one is actually part of that path. Improving their
Markdown alone will not change code-owned output.

## Evaluation and acceptance

Use the existing certification adapters, owner fixtures, evidence catalog, and
answer gate. Add a usability benchmark beside them rather than replacing
certification with a prompt score. Keep expected answers out of model context.

### Experiment design

Pilot with two skills, 20 scenarios per skill, three repeated runs per scenario,
two configurations (current and candidate), and three fixed model profiles:
the intended inexpensive model, an alternative inexpensive profile, and a
stronger reference. That is 720 workflow runs; each can involve multiple provider
calls. Set a budget and run a smaller smoke subset before the full matrix.

Use identical evidence, runtime policies, output limits, and sampling settings
for paired comparisons. Record the immutable skill/compiler/program hash,
provider/model revision, profile, reviewer configuration, fixture hash, settings,
and attempts. If a model version cannot be pinned, record the returned identity
and test window. Compare complete workflow economics as well as drafter-only
quality. A text-only prompt test must not be reported as governed execution.

Separate intent routing from task execution tests. Fixed skill routes may need
no model router; an assistant choosing among skills needs positive, negative,
ambiguous, and multi-intent examples, with inactive skills excluded before
selection. Do not add an LLM routing call merely to imitate coding-agent skills.

Include supported normal requests, missing input, unsupported features, partial
and denied evidence, stale versions, numerical edge cases, malicious source
text, and pressure to act outside the skill. Keep development examples separate
from held-out acceptance scenarios. Expand to at least ten skill-specific cases
for each remaining skill, with additional cases for distinct failure modes.

### Proposed acceptance targets

These are initial decision thresholds to calibrate against the pilot baseline,
not measured results or guarantees. Report numerators, denominators, scenario
breakdowns, repetition variance, and confidence intervals where meaningful.

| Measure | Initial target and interpretation |
| --- | --- |
| Critical failures | Zero observed unauthorized scope/effects, fabricated financial amounts, false approval/closure, or accepted unsupported claims in the acceptance set. Any occurrence blocks that candidate. Finite tests do not prove absence. |
| First-pass structured admission | At least 95% on supported, sufficiently evidenced pilot cases, separately reported per skill/model. Count repairs and fallback successes separately. |
| Correct bounded outcomes | At least 95% correct clarification, limitation, unavailable, denial, or handoff behavior on the corresponding cases. Raw refusal on answerable cases is a failure. |
| Task completion | Candidate no worse than current on held-out paired cases; target an improvement of ten percentage points where baseline leaves room. Near-ceiling cases should preserve quality and reduce cost or friction. |
| Smaller versus stronger model | Target no more than five percentage points lower successful completion for the inexpensive profile on the supported pilot scope, with the same critical gates. Interpret uncertainty rather than declaring equivalence from a small sample. |
| Routing where applicable | Target at least 95% correct skill selection or clarification, with no false claims of tenant availability. |
| Business readability | Finance/operations reviewer blind review: accurate scope, understandable findings, visible material limits, and useful next step. Resolve every critical reviewer objection. |
| Cost and latency | Report total cost per accepted useful task, provider-call count, repair/fallback rate, input/output tokens, and p50/p95 latency. Aim for at least 20% lower cost versus current on the selected inexpensive profile without weakening gates; validate the target after baseline measurement. |

Existing local suites and transcript replay remain valuable regression evidence.
Real-provider tests, deployed UI acceptance, tenant certification/promotion, and
spend settlement remain separate gates. Current credentials and a provider budget
are prerequisites for those measurements; none are implied by this plan.

## Implementation sequence

| Package | Deliverables and likely files | Acceptance and dependency |
| --- | --- | --- |
| ERP-SKILL-01 Contract inventory | Add `erp-skills/README.md` and a generated inventory linking Markdown, Rust inputs, routes, programs, manifests and release requirements. Record current/candidate prompt snapshots and experiment configuration. | All 15 bundled skills classified as deterministic helper, governed LLM workflow, or internal generation skill. Effective inputs/tools documented without authority expansion. First package. |
| ERP-SKILL-02 Alpha consistency | Correct analytics reference, finance input wording and unsupported variance/procurement promises. Align deterministic-helper docs with actual adapters. Add required-reference validation and release/build dependency checks. | Contradictory examples reject; reference-only change is detected; existing certification remains honest. Use baseline fixtures from 01. Prompt changes trigger the existing source-bound version/certification process. |
| ERP-SKILL-03 Pilot recipes and examples | Improve `report_analysis` and `finance_report_review`; generate schema-derived docs; add valid success/partial/unavailable examples and held-out cases. | Real parser, projection and admission checks pass. Compare current/candidate using the experiment matrix. Depends on 01 and applicable corrections in 02. |
| ERP-SKILL-04 Compiler and reference selection | Version prompt assembly; record dependencies and enforce size budgets. Add server-selected reference branches only when pilot evidence justifies them. Update bindings, runtime-image paths and regression checks. | Missing/transitive/changed assets and package escapes reject; deterministic composition and correct hash invalidation verified. Depends on measured 03 needs; eager validated loading may remain sufficient for alpha. |
| ERP-SKILL-05 Remaining skill rollout | Apply the proven template across the remaining four finance reviews, operational/procurement workflows, deterministic helpers and three internal generation skills. | Per-skill negative cases and generated contract docs pass; model-backed cases meet agreed quality/cost gates. Depends on 03; use 04 if adopted. |
| ERP-SKILL-06 Professional task UX | Improve task names, required-input collection, availability reasons, evidence/coverage presentation, recovery and saved-run inspection in existing web components. | Operator walkthroughs at supported responsive sizes, keyboard operation, exact status labels, and reload without another run. Can start from 01; finish against actual 03/05 contracts. |
| ERP-SKILL-07 Qualification and release | Run authorized live-provider acceptance, attach per-profile results, prepare source-bound candidate manifests, and follow existing independent tenant certification/promotion and rollback procedures. | No changed bundle inherits an old certificate. Observe useful completion, spend, fallback and denial rates during a staged rollout; retain the prior compatible release for recovery. Depends on the packages included in the candidate. |

Use one reviewable change per package or a smaller vertical slice. Leave each
package's outcome and evidence in the existing `docs/plan/` status convention.
Provider-backed runs need explicit target/profile/budget configuration; a missing
required lane is pending, never a passing skip.

For alpha, prioritize 01–03 and the smallest 06 slice needed to operate the pilot.
Take the pilot through 07 before broad activation. Carry 04 only if measured
context problems justify it; finish 05 incrementally. A portable public skill
export, richer policy overlays, and a larger cross-language benchmark can follow
once the internal procedures are stable.

## First implementation slice

Produce the generated contract inventory and a narrow consistency patch for
`report_analysis` plus `finance_report_review`. Include the obsolete SQL reference,
one schema-valid worked response per pilot skill, missing-reference validation,
and ten initial scenarios per pilot skill. Run parser/owner/admission checks and
a budgeted provider smoke comparison before expanding the matrix.

The success criterion is an operator getting a correct, scoped, understandable
answer with fewer corrections at a measured total cost. Skill length, star count,
and the number of supporting files are inputs to design, not release criteria.

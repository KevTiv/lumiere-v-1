# ERP skill evaluation

The pilot has 40 scenario specifications: 20 each for report analysis and finance
report review, split equally into development and held-out cases. These are test
requirements, not completed executions. `review-cases.json` adds ten specific
scenario requirements for each of the remaining 13 skills, including deterministic
adapters that do not need provider trials. `baseline.json` preserves the original
two prompts and source commit. Expected outcomes stay in the grading corpus.

Prepare an offline paired experiment using explicit configured profile references:

```sh
python3 scripts/erp_skill_catalog.py --check
python3 scripts/erp_skill_benchmark.py prepare \
  --profile cheap-profile@1 --profile alternative-profile@1 \
  --profile reference-profile@1 --repetitions 3 --output /tmp/erp-trials.jsonl
```

The full matrix contains 720 workflow trials, potentially multiple provider calls
each. Start with a budgeted subset. A runner must materialize each scenario using
synthetic fixtures or an approved test tenant and the real owner contracts. The
`evidenceSetup` field is a runner setup instruction, not model context. Only the
selected prompt, user request, authorized observation and normal runtime schema
belong in generation context. Never supply expected outcomes or grader decisions
to a provider. The offline preparer does not dispatch providers or admit runs.

Local examples are exercised through the actual candidate executor and answer
gate in `candidate_certification.rs`. Its pinned independent-review replies prove
replay behavior only; they do not prove a model's semantic judgment. Existing
owner, parser, cross-scope, source and rejection tests remain necessary.

## Collect actual results

Produce one independently graded JSON object per trial with these fields:

```json
{
  "trialId": "copy from trial",
  "promptHash": "copy from trial",
  "profile": "copy from trial",
  "skill": "copy from trial",
  "configuration": "current",
  "provider": "actual provider",
  "modelRevision": "actual returned model revision",
  "runtimeBinding": "actual immutable program/release binding",
  "fixtureHash": "actual owner fixture or observation hash",
  "reviewerProfile": "actual independent reviewer configuration",
  "gradeEvidence": "path or run reference to reviewed assertions",
  "executionMode": "admitted_live",
  "taskSuccess": false,
  "firstPass": false,
  "correctOutcome": false,
  "criticalFailure": false,
  "totalCostUsd": 0,
  "latencyMs": 0,
  "inputTokens": 0,
  "outputTokens": 0,
  "providerCalls": 0,
  "repairs": 0,
  "fallbacks": 0
}
```

The numbers above are placeholders, not a measured run. Record total workflow
spend, including reviewer, repair, fallback and failed attempts. Use
`immutable_fixture_replay` for local replay, with zero provider calls and spend;
the collector keeps replay separate from live results. Retain provider settings,
sampling/output limits, test window and raw evidence with `gradeEvidence`.
Keep secrets, real customer source text and private provider reasoning out of
version control. A reviewer must assess usefulness as well as formal admission.

```sh
python3 scripts/erp_skill_benchmark.py summarize --trials /tmp/erp-trials.jsonl \
  --results /tmp/erp-results.jsonl --output /tmp/erp-benchmark.json
python3 -m unittest discover -s scripts/tests -p 'test_erp_skill_benchmark.py'
```

The report shows missing trials, per-skill/profile/configuration success and
critical failures, cost per successful task, variance and p50/p95 latency. A
critical failure cannot count as task success. Wilson intervals describe trial
proportions; repeated trials of the same case are correlated and cannot establish
model equivalence. Group results by scenario and retain paired comparisons for
review. An incomplete run, a replay pass or an aggregate score never grants tenant
certification. The proposed targets and separate deployment gates are in the
[implementation plan](../../docs/plans/erp-skills-professional-usability.md).

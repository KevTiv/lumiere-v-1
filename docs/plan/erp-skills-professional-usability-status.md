# ERP skill usability implementation status

Date: 2026-10-28. Plan: [ERP skills professional usability](../plans/erp-skills-professional-usability.md).
Implementation rebased onto main at `36578a83`; pilot baseline prompts retain
their original `dd5481dc` snapshot.

All 15 bundled procedures now explain their supported task, inputs, evidence,
response, recovery and completion/handoff. The compiled runtime continues to own
scope, calculations, evidence admission, independent review and business effects.
The generated catalog documents implementation; it is not tenant activation or
model qualification evidence.

| Package | Implemented | Remaining acceptance |
| --- | --- | --- |
| ERP-SKILL-01 | Generated catalog/README from registered routes, Rust input structs and actual prompt dependencies; Rust parity checks compare the compiler and reviewed tool allowlists. | Maintain generator checks as contracts change. |
| ERP-SKILL-02 | Remove obsolete SQL, unsupported tools/drafts, finance input drift and ambiguous deterministic-helper claims; fail on missing/escaped references and malformed metadata. Database overlays cannot restore stale tools or drafts. | Changed releases need independent certification before use. |
| ERP-SKILL-03 | Baseline snapshots, tested response examples for both pilots, 40 development/held-out scenario specifications, paired experiment preparation and provenance-checked metric collection. | Run the budgeted real-provider comparisons and independent usefulness grading. Scenarios are requirements, not completed measurements. |
| ERP-SKILL-04 | Versioned deterministic eager compiler, dependency/content hashes in synchronization metadata, package-local reference validation, 64 KiB byte bounds, complete declared prompt inputs in certification binding and image build triggers. | Conditional reference selection remains deferred by the plan until the pilot demonstrates a benefit. Actual tokenizer measurements are still needed for the provisional token budget. |
| ERP-SKILL-05 | Procedures and synthetic task-data examples across the remaining skills; ten review scenarios per remaining skill; documented closed input examples deserialize against the real contracts. | Materialize the additional scenarios through their owners; model-backed paths still need live profile qualification. |
| ERP-SKILL-06 | Explicit reporting timezone selection, workflow-specific record/date labels, required-input guidance, and honest bounded empty-briefing output. Existing saved-run inspection remains the observation path. | Deployed responsive/keyboard operator acceptance and live availability/recovery walkthroughs. |
| ERP-SKILL-07 | Source-bound proposed manifests and development seed prepared; source checks run in CI. | Actual provider/settled-spend evidence, independent tenant certification/promotion, staged activation and rollback rehearsal. |

## Release handling

The proposed report version is **1.0.7**; the five proposed finance versions are
**1.0.1**. These are local candidate artifacts, not deployed releases. No contract
schema or immutable contracts release changed. No tenant registration, promotion,
provider dispatch, deployment, migration or business effect was performed.

The report/common binding includes all declared prompt assets plus compiler and
loader code. Finance bindings include that common binding, so any shared prompt
change invalidates their proposed hashes too. This conservative coupling follows
the current architecture; it can be split in a later version if measured release
cost justifies narrower dependency sets. Runtime-image compilation now copies
the skill packages and watches `erp-skills/**`; evaluation expectations are
excluded from the Docker context.

After editing a procedure, reference or bound runtime source:

```sh
python3 -B scripts/erp_skill_catalog.py --write
python3 -B scripts/finance-skill-manifests.py --write
python3 -B scripts/erp_skill_catalog.py --check
python3 -B scripts/finance-skill-manifests.py --check
```

The manifest helper updates the report proposal, development-only seed and five
finance proposals. It never contacts a service, registers or promotes a release.

## Verification

- Gateway: 832 unit tests passed; eight existing prerequisite tests remain
  ignored. Finance owner integration: 27 tests passed.
- Finance review core: 13 tests passed.
- Python script suite: 174 tests passed, including inventory/binding parity,
  experiment pairing, hidden grading expectations, missing/forged result handling,
  critical-failure accounting and cost including failed attempts.
- Four targeted finance form/BFF/governed-route test files passed.
- Web TypeScript check passed using Node with a 12 GiB heap; the default 4 GiB
  heap exhausted memory before completing.
- Rust formatting, generated catalog/source-bound manifest checks, runtime-image
  contract check, locale duplicate/key/interpolation checks and immutable release
  compatibility verification passed.
- Offline preparation produced 720 paired trial specifications with explicit
  placeholder profile references. It dispatched no provider and measured no model.

The response examples execute through the actual candidate executor and answer
gate using synthetic owner data and pinned reviewer replies. The finance example
retains the gate's effective-date qualification; successful replay does not
establish real-model semantic judgment. The case corpus contains 170 scenario
specifications across 15 skills, not 170 executed or passing provider tests.

No full image build, deployed browser acceptance or live-provider run was
performed. This environment has no configured provider credentials. Follow the
[evaluation protocol](../../erp-skills/evals/README.md) with approved profiles,
synthetic evidence, an explicit budget and the existing tenant release process
before making a professional-readiness or smaller-model performance claim.

# ERP harness coordination source map

The coordination program intentionally does not restate every architectural detail. Use this map when a work package needs deeper semantics.

| Coordination area | Primary source plans |
| --- | --- |
| Repository cohesion / duplicate-authority removal / error-outcome ownership | `docs/plan/repository-cohesion-outcome-ownership-plan.md`, current implementation evidence from `BASE-00` |
| First-test-org module usability parity / T0 | `docs/plans/erp-module-usability-parity-program.md`, execution in `docs/plan/erp-module-usability-parity-ledger.md` |
| ERP cross-module workflow integration | `docs/plans/erp-workflow-integration-program.md` plus relevant domain gap/remediation plans |
| Module code readability/ownership cleanup | `docs/plan/module-by-module-maintainability-plan.md` and per-module cleanup ledgers; this does not substitute for T0 usability certification |
| Business invariant certification | `docs/plans/adversarial-business-invariant-certification.md`, pre-tenant adversarial plan/evidence |
| Governed loop / answer / interaction | `docs/plans/ai-harness-completion-plan.md`, `docs/plans/ai-harness-completion-issues.md` |
| One executor / scoped capabilities | `docs/plans/ai-enterprise-harness-plan.md`, `docs/plans/ai-unified-execution-capabilities-subagent-plan.md` |
| Capability IR/codegen | `docs/plans/agent-harness-capability-ir-foundation.md`, `docs/plans/agent-ir-codegen-extension-plan.md`, `docs/plans/agent-generated-erp-tool-surface-plan.md` |
| Model/provider routing/cost | `docs/plans/agent-control-plane-model-routing-plan.md`, `docs/plans/agent-performance-admission-cost-plan.md` |
| WorkProgram runtime/UI | `docs/plans/work-program-runtime-execution-plan.md`, `docs/plans/work-program-ui-harness-convergence-plan.md` |
| WorkProgram certification/security | `docs/plans/work-program-certification-compatibility-plan.md`, `docs/plans/work-program-security-provenance-plan.md` |
| Sandbox/data/artifacts | `docs/plans/agent-sandbox-data-analysis-plan.md`, `docs/plans/agent-sandbox-import-onboarding-plan.md` |
| ProgramWorkspace/terminal/CLI | `docs/plans/program-workspace-browser-terminal-plan.md` |
| HSEC/residency/retention | `docs/plans/harness-security-residency-sandbox-certification.md` |
| Decision replay/org learning | `docs/plans/harness-decision-trace-replay-organizational-learning.md` |
| Forensic introspection | `docs/plans/forensic-introspection-causality-layer.md` |
| Model refinement/datasets | `docs/plans/model-refinement-dataset-plane.md` |

Conflict rules:

1. use the authority hierarchy in `erp-harness-implementation-coordination-plan.md` for semantic conflicts;
2. use `repository-cohesion-outcome-ownership-plan.md` when the conflict is between two implementation generations of the same concern;
3. use `erp-module-usability-parity-program.md` to decide whether a module is safe to expose to the first test organization, while the workflow program owns the domain sequence and ADV owns invariant proof;
4. maintainability acceptance never implies U5 product completeness;
5. if two semantic source plans still materially disagree, stop and ask the coordinator to resolve the contract before implementation.
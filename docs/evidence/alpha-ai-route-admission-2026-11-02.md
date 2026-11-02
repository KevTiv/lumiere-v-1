# Alpha AI workbench route admission — 2026-11-02

## Scope

The Alpha workbench rendered controls whose requests stopped at the edge's generic AI 503 response. This change admits the existing authenticated handlers for the named workbench and knowledge workflows.

| Surface | Newly admitted method and path |
| --- | --- |
| Report composer | POST /api/ai/report/compose |
| Low-stock scan | POST /api/ai/inventory/low-stock |
| Finance reviews | POST /api/ai/skills/finance/{finance_report_review, bank_reconciliation_review, period_close_review, expense_evidence_review, finance_variance_review} |
| Action drafts | POST /api/ai/action-draft/bridge; POST /api/ai/actions/draft |
| Evidence workflows | POST /api/ai/evidence/{inspect, review-queue, contributions, decisions, reviews}; POST /api/ai/evidence/runs/export |
| Knowledge promotion | POST /api/ai/knowledge/skill-promotions; GET /api/ai/knowledge/skill-promotions/company/:positiveCompanyId; POST /api/ai/knowledge/skill-promotions/:positivePromotionId/review |

These are 18 additional method/path cases. The existing eight report-analysis, certification and run-inspection/history/lifecycle cases remain admitted. The Finance key set is enumerated; dynamic promotion/company identifiers reject zero, signs and leading zeroes. Methods, path endings and route priority remain explicit.

The service retains its existing name and PostgreSQL-backed, fail-closed rate and body-size limits. The web upstream continues to own authentication and trusted actor context. Existing company authorization, capability grants, source-bound certification, policy/privacy checks, budget accounting and human approval remain authoritative. Route admission does not provision roles or grants, promote a skill, change a model/provider, or execute an ERP action.

The remaining /api/ai fallback now explains that the endpoint is outside Alpha admission. Arbitrary skill dispatch, RAG, document/context ingestion, vision and import-mapping endpoints are outside this bounded workbench change; their separate rollout work is unchanged.

## Validation

- Local gateway unit suite: five tests passed, including the complete 26-case allowlist and negative method/path/id cases.
- Local render-config shell suite passed.
- Python compilation of the Docker integration test passed.
- Hosted validation must run the real Kong/PostgreSQL integration. It exercises every admitted case, verifies the Alpha service's rate-limit headers, verifies prefixed paths use the ordinary web service, and rejects unsupported methods and descendants.
- Hosted image builds, full CI and deployed acceptance are pending when this record is first added.

The shared JSON fixture is test data, independent of the production YAML. Both the unit and real-router suites consume it. A successful echo-upstream router test proves edge admission; it does not certify the downstream business handlers.

## Runtime follow-up

1. Deploy the tested main revision and verify the exact image coordinates and terminal SUCCESS states.
2. Confirm anonymous and unauthorized requests still fail at the owning handlers.
3. Exercise composer and low-stock with an already certified/promoted skill and scoped read permission.
4. Exercise each Finance skill with its source-bound certified candidate and existing actor budget. Observe permission, missing-source and readiness failures without bypassing them.
5. Exercise draft creation, then verify that approval remains necessary for ERP execution.
6. Inspect lineage, review queue and run export; verify independent-review and company isolation.
7. Propose and independently review a knowledge promotion. Certification and release remain subsequent steps.

Known independent failures from deployed main 8f16737:
- Certification enqueue used the generic dispatcher for a private reducer. PR #364 owns its fixed, actor-bound enqueue boundary.
- Run history reaches the AI gateway but its ORDER BY query is unsupported by the deployed SpacetimeDB SQL engine.
- Report analysis 1.0.8 is persisted as reviewed and certification pending; the old 1.0.7 certificate is not evidence for 1.0.8.
- Run #8 lifecycle inspection succeeds and displays five persisted steps and settled provider usage.

This evidence records admission and its remaining acceptance edges. It does not claim that all surfaced workflows are certified or active.

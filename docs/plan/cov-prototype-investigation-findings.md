# COV prototype investigation findings

## Findings from current source

1. **The server authority boundary is stronger than the frontend outcome boundary.** `POST /operations/:operation` already resolves session identity, locks to generated operation metadata, injects organization scope, authorizes company scope and dispatches through `TrustedOperationContext`.
2. **Generic reducer dispatch currently returns only `{ ok: true }`.** This cannot distinguish new application from idempotent no-op replay and carries no result record reference to the caller.
3. **Frontend mutations frequently erase outcome semantics.** Representative hooks return `void`, convert server failures into operation-specific string errors, invalidate resources, and rely on callers/tests to rediscover effects.
4. **The generated named-operation transport is the correct structural seam.** `stdbBffCommandPost` consumes immutable generated operation descriptors and generated input maps; COV should extend around it rather than create a new command registry.
5. **CRM opportunity → sale order already has a stable domain identity.** The reducer is idempotent by `sale_order.opportunity_id`, making this a good cross-module reference action.
6. **The existing E2E result helper weakens that identity.** It chooses the newest row if multiple orders match the opportunity and falls back to matching by partner when the relation is absent. These heuristics can hide duplicate or missing-correlation defects.
7. **Navigation has one presentation catalog but no product-admission dimension.** Sidebar and command palette share `navigation-catalog.ts`; adding a second route list would regress ownership. First-org admission should be a separate product-surface authority referenced by that catalog and route admission.
8. **Agent quality needs executable stop conditions, not only architecture prose.** The skill/trail in this branch explicitly treats missing effect identity, duplicate effects, release-lane requirements and direct-reducer-only UI proof as legitimate blockers.

## Design conclusions

- Keep transport acceptance and business effect outcome distinct.
- Resolve consequential effects by exact canonical business keys before and after one dispatch.
- Return `Applied`, `AlreadyApplied`, `Rejected`, or `OutcomeUnknown` to UI-facing hooks.
- Treat duplicate exact effects as invariant failures.
- Never blind-retry ambiguous consequential effects.
- Use correlation IDs for operator reconciliation as the server receipt evolves.
- Keep generated operation contracts and STDB as structural/business authorities.
- Start adoption with one representative cross-module action, review it, then extract only proven shared primitives.
- Make product exposure explicit and testable without conflating it with RBAC/backend authorization.

## Prototype scope

This branch deliberately does **not** mass-rewrite existing hooks or declare COV-01 accepted. The executable code demonstrates the common transport/effect semantics and tests them in isolation. The next implementation package should wire the reference CRM action end-to-end, repair its E2E correlation helper, and then decide which pieces deserve promotion to shared authority.

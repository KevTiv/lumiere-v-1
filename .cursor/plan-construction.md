# Plan construction — how to author the next plans

Use this when spinning **new handoff missions** after finishing work or when splitting a large effort. It matches the pattern used by `[reducer-coverage]` under `.cursor/plans/`.

## 1. Choose a handle

- Format: **`[kebab-topic]`** — short, unique, grep-friendly (e.g. `[reducer-coverage]`, `[form-config-ui]`).
- Put the handle in the **title or first paragraph** of every file in the cluster so `rg '\[your-handle\]' .cursor` finds the set.

## 2. File cluster (recommended layout)

| File | Role |
|------|------|
| `.cursor/plans/{topic}.md` | **Index** — one screen; links to mission + reference; repeats the handle. |
| `.cursor/plans/{topic}-mission.md` | **Executable handoff** — goal, context, phased steps, artifacts table, success criteria, out of scope. |
| `.cursor/plans/{topic}-triage-reference.md` (optional) | **Snapshot / tables / exclusions** — data that goes stale; label “invalidate after step X”. |

Copy from:

- [templates/plan-mission-template.md](templates/plan-mission-template.md) — mission body
- [templates/plan-triage-reference-template.md](templates/plan-triage-reference-template.md) — optional snapshot doc

**Naming:** `{topic}` is a slug (`reducer-coverage`, not `Reducer Coverage`).

## 3. Mission body rules

Each mission should give the next session **enough to run without rediscovering the repo**:

1. **Goal** — one paragraph; what “done” means (often a document or report, not necessarily shipped code).
2. **Why / context** — links to stale data, bugs, or product decisions.
3. **Primary artifacts** — table of paths (scripts, JSON, hooks, docs).
4. **Phases** — ordered, each with concrete commands or grep patterns where possible.
5. **Success criteria** — checkbox list; objective verifiable outcomes.
6. **Out of scope** — prevents scope creep in the next chat.
7. **Related** — link to older `.cursor/plans/*.plan.md` if any; state which doc is source of truth.

8. **Frontend forms** — if the mission includes **any** new or unfinished UI that collects structured user input (create/edit entities, multi-field dialogs), require the **form builder**: `FormConfig` in `frontend/packages/ui/src/lib/*-form-configs.ts` (or `forms/config/modules/`), rendered with **`FormModal`** + **`ModularForm`**, plus `mergeFieldDefaultValues` and `mergeSelectOptionsByFieldName` as needed. Do not plan ad-hoc `Dialog` + raw inputs for CRUD unless the mission explicitly exempts that screen.

## 4. Building the *next* plan from a finished mission

When Phase N produces a backlog (issues, table rows, or reducer lists):

1. **One mission per theme** — e.g. “IoT hub pairing UI” not “all IoT”.
2. **New handle** per mission cluster (`[iot-hub-onboarding]`).
3. **New index + mission**; optional reference only if you need a frozen snapshot.
4. **Register** the handle in [.cursor/plans/README.md](plans/README.md).
5. **Cross-link** from the parent mission: “Follow-ups: see `[child-handle]` in README.”

Do not duplicate huge JSON into markdown; point to generated files and line ranges.

## 5. Cursor Plan files (optional)

` .cursor/plans/<Title> <id>.plan.md` — use Cursor’s plan mode for **single-session execution**. For **multi-session or agent handoff**, prefer the mission cluster above; you can still add a short plan that says “execute `.cursor/plans/foo-mission.md` Phase 1 only.”

## 6. Maintenance

- When paths move, update **artifact tables** and **parent mission** links in triage docs.
- Mark reference docs with a **staleness rule** (e.g. “void after report regen”).

## Example clusters

| Handle | Index |
|--------|--------|
| `[reducer-coverage]` | [plans/reducer-coverage.md](plans/reducer-coverage.md) |
| `[reducer-ui-*]` | [plans/README.md](plans/README.md) — per-module reducer→UI missions |

Add new rows to [plans/README.md](plans/README.md) as you create clusters.

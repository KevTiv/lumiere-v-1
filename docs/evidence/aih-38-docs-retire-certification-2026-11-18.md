# AIH-38 — Retire certification steps from plans — 2026-11-18

Base: `main` @ `fcde3069` (#444). Docs and a CI guard only; no application code, contracts or schema changes.

## Changes

- 19 plans and status files under `docs/plan/` and `docs/plans/` gained a one-line banner pointing to
  [skill ownership and lifecycle](../plan/skill-ownership-and-lifecycle.md). Files were chosen because they tell the
  reader to certify, promote, activate or manifest-check repository-owned skills. User-created skill lifecycle docs
  (`json_projection_v1`) were left unchanged.
- AIH-19 in `docs/plans/ai-harness-completion-issues.md` now covers user-created skills and admission only, with a
  short superseded-scope note.
- AIH-30 to AIH-38 were added to the same file, and the suggested PR batching gained batches A–H.
- `docs/plans/ai-harness-chat-remediation-plan.md` records the chat remediation plan and the decisions taken on
  2026-11-18.
- `CLAUDE.md` gained a short "Skills and certification" section.
- `scripts/check-retired-skill-steps.py` fails when a file under `docs/` outside `docs/evidence/` names the removed
  manifest helper or `certification-bundles` without the banner. It runs in `ci.yml`.

## Validation

- `python3 -B scripts/check-retired-skill-steps.py`: passed (exit 0).
- `python3 -B -m unittest discover -s scripts/tests`: 403 tests passed, including 5 new tests.
- `git diff --check`: clean.

## Known limits

- No file under `docs/` currently names the removed helper literally, so the CI check guards against reintroduction.
- `erp-skills/README.md` and `scripts/erp_skill_catalog.py` still describe independent certification and promotion for
  changed skills. They are outside this docs scope and need a follow-up.
- Banner selection is a judgment call; reviewers may add or remove files.

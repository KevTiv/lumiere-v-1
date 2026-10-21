# Alpha action revalidation — 21 October 2026

The current branch integrates main `3107a6c5`, preserving its scrollable settings
tabs, contracts v0.3.132 and released PostgreSQL catalog 1–20. Invoice send actions
retain the scoped, single-document review path. The PDF menu now uses the existing
canonical `accounting.invoices.invoiceActions.downloadPDF` translation key.

Local checks on source commit `3ff62a61` passed: duplicate/static translation
validation, 858 UI tests in 134 files, full web TypeScript, release compatibility
verification and whitespace checks. Fresh remote CI passed its frontend and
typecheck gates; complete browser and image validation remain required on the
final head.

## GitGuardian incident 38351259

The reported occurrence identifies commit
`33940751dd1930998dde4625d800654eb4015bb8`, `docker-compose.workos.yml:20`.
The value is a required Compose environment expression:

```yaml
WORKOS_COOKIE_PASSWORD: ${WORKOS_COOKIE_PASSWORD:?run through scripts/workos-docker-stack.sh}
```

There is no embedded password or default value. The flagged commit's whole file
is byte-identical to current main and this branch:

`sha256:a6d35fa021e87e036cf095a0c9cde819b2edf679415e8a95761aac62f2cbce36`

Isolated `docker compose config --no-consistency --format json` checks confirmed
that missing and empty values are rejected, while an explicitly supplied
synthetic value is preserved exactly. This validation parses configuration; it
starts no services and uses no actual credentials.

The maintainer reported completing the GitGuardian dashboard classification.
The earlier GitHub check still showed its original failure afterward, so a fresh
head scan is required. No scanner suppression, fabricated check result, history
rewrite, credential rotation or environment-expression change was performed.

Incident: https://dashboard.gitguardian.com/workspace/213483/incidents/38351259

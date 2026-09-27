# CSV-04 — collision-resistant statement import identity

Status: **IMPLEMENTED — verification pending**

Stack base: PR #84 (`codex/csv03-ambiguous-slash-date-fail-closed`).

## Scope

CSV-04 replaces the browser-side 32-bit FNV statement-import key with a
collision-resistant identity.

The previous key hashed company, journal, currency and normalized CSV content
into only 32 bits. Distinct files can therefore share the same key. PAY-11B now
prevents such a collision from silently mutating or dropping a different
payload, but a false idempotency conflict is still operationally incorrect.

## Semantics

The key is now:

```text
statement-csv-sha256-<64 lowercase hex chars>
```

SHA-256 input includes:

- company id;
- journal id;
- currency id;
- BOM-normalized CSV content;
- CRLF normalized to LF;
- leading/trailing file whitespace normalization preserved from the previous
  implementation.

The backend still independently fingerprints the reducer payload under PAY-11B,
so the browser key and server replay receipt provide separate defenses.

## Certification

The focused unit suite contains two distinct statement CSVs that collide under
the legacy 32-bit FNV implementation:

- amount/reference `76303`;
- amount/reference `86018`.

The test first proves the legacy keys are equal, then proves their SHA-256
statement identities are different and have the expected 256-bit encoding.

It also proves company, journal and currency remain part of the identity scope,
and the existing CSV-BOM test proves BOM/non-BOM equivalents retain the same
identity.

## Changes

- make `statementImportIdempotencyKey` async and SHA-256-backed using Web Crypto;
- update the statement upload path to await the digest;
- update existing BOM identity certification for the async API;
- add a real legacy-collision regression fixture;
- add scope-separation fixtures;
- promote canonical CSV-04 to covered in the pre-tenant matrix.

## Deliberately excluded

- mixed European amount separators (canonical CSV-01);
- changing server-side PAY-11B payload fingerprinting;
- statement reducer/approval behavior;
- global import identity policy outside bank statements.

## Acceptance

```bash
cd frontend/web
node --import tsx --test lib/statement-import-csv.test.ts
pnpm typecheck
```

Do not mark CSV-04 accepted until the focused unit proof and typecheck pass on
this branch.

# Qdrant 1.17 cutover runbook

Status: runbook only. It changes no infrastructure; the cutover is an operations decision.

Scope: the production Qdrant (currently 1.12.6) holding the activity reference collection
(`activity_refs_collection`) and the document vector collection. The gateway SDK is
`qdrant-client ~1.17.0`, which supports servers within one minor version, so production
must reach 1.16 or 1.17 before the SDK pin is exercised against it.

## What is in Qdrant, and why a rebuild is acceptable

Activity points hold references only (organization, company, actor, resource kind and id,
fingerprint, model, time). Vectors are derived from ERP rows and are always rebuildable.
SpacetimeDB and PostgreSQL stay the source of truth. Retrieval re-authorizes every hit
against live data. Operator reindex points share the company scope, not the operator's
actor key; the projection and live-read requirements are below.

Production currently has no company or organization hits, so the activity collection holds
little or nothing worth migrating.

## Option A (recommended): fresh 1.17 and reindex

1. Provision a new Qdrant 1.17.x (latest patch) with its own volume and API key. Leave 1.12.6
   running untouched.
2. Point a staging gateway at it and start once: `ensure_collection` creates both
   collections and the payload indexes with the configured embedding model and dimension.
3. Verify `GET /collections/<name>` reports the expected vector size and cosine distance.
4. Switch the production gateway `QDRANT_URL` / key to the new instance (one config change,
   rollback is switching back).
5. Repopulate. Today records are indexed when users write them (queued by the api-server and
   drained under the writer's own session) and through the manual indexing action in AI
   settings. For existing records, use the [capped operator reindex](#operator-reindex) below
   once it has passed staging validation.
6. Watch the empty-reply wording: a company with zero points answers "This company's records
   haven't been indexed yet". That is the expected state until step 5 progresses.
7. Keep the 1.12.6 instance and its snapshot for at least one release, then retire it.

Document embeddings (evidence passages) are rebuilt by their existing embedding queue
workers; confirm queue depth drains to zero before retiring the old instance.

## Operator reindex

Use a private one-shot `gateway` process with the selected deployment's SpacetimeDB,
Qdrant and admitted Mistral configuration. Do not add the operator credential to the
serving gateway, BFF, command arguments, or logs. Supply `LUMIERE_PERSISTENT_PLATFORM_OPERATOR`
from the same deployment policy used to build the module, and supply the existing enrolled
operator's token as `AI_REINDEX_OPERATOR_STDB_TOKEN` via the command environment only.
The usual `STDB_TOKEN` and `AI_SPEND_READ_STDB_TOKEN` remain the separate spend writer and
reader. The operator's dedicated home role must have the explicit `embedding_reindex`
capability (use the existing audited `set_ai_capability_role_grant` operation).

```bash
gateway reindex-company --check ORG COMPANY KIND FIRST_ID LAST_ID CURRENCY MAX_MICROUNITS
gateway reindex-company --apply ORG COMPANY KIND FIRST_ID LAST_ID CURRENCY MAX_MICROUNITS
```

- `--check` verifies the live enrollment, capability, target, and range and reports
  counts. It does not call a provider, reserve spend, or write to Qdrant. `--apply`
  additionally requires the compiled module's operator probe and the target's normal
  `activity_indexing` agent, action, and spend admission.
- Each invocation targets one company and one inclusive numeric ID interval for
  `sale_order`, `purchase_order`, `account_move`, `project_task`, `product`, or `contact`.
  Use the owning SpacetimeDB deployment. If the scanned range exceeds the grant or
  the hard ceiling (100 source rows and 128 KiB), subdivide it; no truncated prefix is
  silently indexed. If the cap stops a run, a reviewed repeat of the same range skips
  current points and recovers already-settled outputs without a second provider call.
- Use the target budget's currency, such as `USD`. The cap is per invocation and
  counts the full native reservation before each new dispatch, not just final usage.
  A price or currency change between quote and reservation can leave an undispatched
  hold. Review native spend readback before retrying an interrupted or uncertain run.
  Do not use repeated invocations as an aggregate spending limit.
- Shared vectors use only the order reference (`sale_order`) or the record name.
  Qdrant holds no field text. Chat and ERP search re-read each candidate using the
  **asking user's** live credentials and discard it if the field is hidden, changed,
  or inaccessible. These points aren't activity events and aren't used in daily
  briefing. Per-user write indexing stays separate. Imported-history indexing is
  not covered by this command.

Before a real backfill, prove `--check`, a small capped `--apply`, and replay in staging.
Try the same semantic query with an authorized reader and a reader whose record or display
field is denied. Revoke the first reader's permission and repeat; no shared hit or citation
should survive. Check the ledger for cap-stop and replay before moving to production.

## Option B: staged in-place upgrade

Qdrant supports upgrading one minor version at a time. Upgrade in this exact order, using
the latest patch of each minor at the time of the change:

1.12.6 -> 1.13.x -> 1.14.x -> 1.15.x -> 1.16.x -> 1.17.x

For every step:

1. Create a snapshot of every collection (`POST /collections/<name>/snapshots`) and copy it
   off the instance. Record the snapshot names in the change record.
2. Stop writers (gateway indexing and embedding workers) or accept a read-only window.
3. Replace the image tag with the next minor, start, and wait for all collections to load.
4. Check `GET /collections/<name>` status is green and point counts match the pre-step count.
5. Run one retrieval smoke test as a real user (search returns references that re-authorize).
6. Only then proceed to the next minor. Never skip a minor.

Rollback for a step: stop the new version, restore the previous image tag and the snapshot
taken in step 1 of that step.

Keep the gateway SDK within one minor of the server throughout. While the server is on
1.13 to 1.15, deploy the gateway only with a pin that is within one minor of it, or pause
gateway indexing; once the server reaches 1.16 the `~1.17.0` SDK is within range.

Reference: https://qdrant.tech/documentation/upgrades/

## Choosing

Option A is simpler, has an instant rollback and avoids five rolling upgrades of data that
can be regenerated. Choose Option B only if existing vectors must be preserved.

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
against live data, so a rebuilt or empty index can only return less, never more.

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
   settings. The capped operator-started bulk reindex (not part of the AIH-30 PR, see its
   follow-ups) is the intended way to repopulate a whole company; until it ships, expect
   coverage to grow with normal use.
6. Watch the empty-reply wording: a company with zero points answers "This company's records
   haven't been indexed yet". That is the expected state until step 5 progresses.
7. Keep the 1.12.6 instance and its snapshot for at least one release, then retire it.

Document embeddings (evidence passages) are rebuilt by their existing embedding queue
workers; confirm queue depth drains to zero before retiring the old instance.

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

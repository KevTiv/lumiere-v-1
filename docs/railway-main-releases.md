# Railway releases from main

`Release main to Railway` starts after a successful push CI run on `main`.
It selects that CI run's exact commit, skips superseded commits, and builds the
shared Rust runtime, production SpacetimeDB publisher, Chromium worker, web,
and API gateway from that revision. Existing immutable commit images are reused
on retries. Pull requests validate images without publishing or deploying them.

Before any production writes, the release resolves commit tags to digests,
checks anonymous pulls, and verifies every OCI revision against the selected
commit. The existing ordered stack release then:

1. Gates PostgreSQL, SpacetimeDB, Kong PostgreSQL, and the AI vector store.
2. Publishes the module with data deletion disabled and verifies completion.
3. Runs PostgreSQL migrations and verifies completion.
4. Deploys Chromium, API, AI gateway, projection, and workflow workers.
5. Deploys enabled owner-report and integration workers.
6. Deploys web, then the public API gateway, with readiness checks.

Every application service uses a digest from the same main revision. Switching
web and Chromium to image sources also removes their independent repository
push triggers, so subsequent main pushes reach them through the ordered release.
The SpacetimeDB server wrapper retains its existing main source; application
module changes reach it through the publisher. PostgreSQL, Kong PostgreSQL, and Qdrant
retain their managed upstream images and persistent volumes.

Production releases share one concurrency lock, including the manual web
release. An in-progress release is never automatically cancelled. A queued
automatic release rechecks main before writes to prevent an older build from
replacing a newer release. Source promotions within a phase are serialized.

## Configuration and activation

The GitHub `production` environment must contain `RAILWAY_TOKEN`, a Railway
project token scoped to the production environment. Keep any environment review
requirements. Existing `RAILWAY_*_READINESS_URL` secrets supply additional probes;
Railway's service healthchecks and one-shot completion markers remain gates.
The public edge readiness URL is specified in the main release workflow.

AI is included because it is already active in production. Owner-report and
integration workers remain off until their credentials, organization bindings,
and readiness endpoints are provisioned. Enable them using repository variables
`RAILWAY_ENABLE_OWNER_REPORTS=true` and `RAILWAY_ENABLE_INTEGRATIONS=true`.

Make the new `lumiere-v-1-chromium-worker` GHCR package public before its first
production pull. All release packages must be anonymously readable. The
production topology also requires the dedicated `kong-postgres` service and
the `KONG_PG_*` variables described in `docs/PRODUCTION_DEPLOY.md`. Preflight
blocks a release before writes if this infrastructure is missing.

Without verified ingress CIDRs, the production manifest selects shared
per-service rate limits. All clients share each route's existing quota; sign-in
is capped at 10 requests per minute and 100 per hour across the deployment.
Kong trusts only loopback in this mode. Per-client quotas remain available
after the ingress trust configuration is verified.

The first successful automatic release performs the image-source cutover for
web and Chromium. Confirm its terminal success and deployed image digests in
Railway before treating the stack as synchronized. If Railway requires
two-factor verification for pending configuration changes, apply those changes
in its dashboard; an API or MCP token cannot perform that verification.

`Release Railway stack` remains available for explicit releases or recovery.
It accepts a main commit (or ancestor), resolves the complete image set for that
commit, and follows the same order. It fails before writes if any image is
missing, private, or from another revision. A rollback needs the complete
compatible image set and must preserve schema compatibility with live data.

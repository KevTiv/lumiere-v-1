# Production deployment

This checklist matches [`docker-compose.yml`](../docker-compose.yml) and runtime validation in **api-server** (`Config::from_env`) and **Next.js** (`lib/api-server-forward.ts`, `lib/ai-gateway-server.ts`).

Validate your host environment before deploy:

```bash
make check-env-prod
# or: scripts/check-prod-env.sh
```

Print the checklist without validating:

```bash
scripts/check-prod-env.sh --list
```

## WorkOS alpha admission

Configure `WORKOS_CLIENT_ID` consistently on web and API to select hosted
authentication. Web also needs `WORKOS_API_KEY`, a strong `WORKOS_COOKIE_PASSWORD`
(at least 32 characters), `WORKOS_REDIRECT_URI` pointing to its
`/auth/callback`, and `LUMIERE_API_SERVER_URL` pointing directly to the private
Rust API, never back to Kong. Register the exact callback and logout URLs in
WorkOS. Disable public registration in the WorkOS dashboard for this alpha.
Keep web and API private behind Kong, including on provider-generated domains,
and keep SpacetimeDB reachable only by the trusted service network. Moving API
authentication to WorkOS does not revoke previously issued SpacetimeDB tokens
at the database itself; review legacy credentials and memberships before release.

The API requires `WORKOS_API_KEY`, the exact trusted token `WORKOS_ISSUER`, and
`LUMIERE_WORKOS_ALPHA_ADMISSIONS`. The issuer must match the provider token and
be one of the supported `https://api.workos.com` issuer forms; do not derive it
from an unverified token. Admissions are an explicit JSON array, for example:

```json
[{"user_id":"user_approved","email":"approved@example.com","organization_id":123,"workos_organization_id":"org_approved","allow_provision":false}]
```

Use real immutable provider IDs and exact lowercase emails. Provider and local
organization IDs have different meanings; the former must exactly match the
provider token, while the latter must have an active local membership. Omit
both organization fields only for a deliberately approved founder without an
organization. Missing, malformed, or duplicate admissions fail startup. Email
domain matching and invitations alone never approve membership. Existing
credentials need an operator-verified immutable WorkOS subject link; this patch
does not automatically link existing accounts by email.

`allow_provision:true` permits creation of a new explicitly admitted identity
and canonical profile on the authenticated bridge. It does not grant organization
membership. For a founder, first provision the identity, then approve its returned
SpacetimeDB identity in `LUMIERE_ALPHA_FOUNDER_IDENTITIES`, rebuild and publish the
production module, and allow the founder to complete onboarding. This list is
compiled into the module: comma-separated lowercase 64-character hex identities,
at most 100, without spaces, prefixes, or wildcards. An absent or malformed list
blocks all new founders. Any prior membership, including inactive membership,
blocks further founder creation. Existing tenant access does not require founder
approval. Remove `allow_provision` after provisioning and pin the numeric local
organization ID once onboarding completes.

Set repository variable `LUMIERE_ALPHA_FOUNDER_IDENTITIES` before the production
module build. The reusable build receives this input and includes its fingerprint
in the artifact cache key. Changing runtime variables on an already compiled
publisher cannot change this policy. Policy changes need a fresh immutable build
and the existing ordered release process. Use a fresh release commit when an
image for the previous commit was already published; commit tags are immutable.
Production uses `--no-default-features`;
developer reducer flags cannot bypass admission in that artifact.

Kong sends browser API requests through Next.js, where AuthKit refreshes its
sealed session and forwards only the provider access token to Rust. Rust verifies
the signature, issuer, expiry, exact admission, canonical verified email, and
live provider session before using the internal per-user database credential.
That credential is never returned by the WorkOS bridge. Provider failure or
revocation denies new requests; this intentionally adds provider latency on each
authenticated request. At most 32 validations run concurrently, and a session
absent from the first 100 provider results is denied. Cached signing keys refresh
every five minutes, so a newly rotated key may temporarily deny valid tokens.
Browser WebSockets use a 60-second HTTP-only provider-token cookie scoped to
`/v1/realtime`, with an exact Origin check. Sockets end within 60 seconds or token
expiry and revalidate on reconnect, bounding revocation for open subscriptions.
Hosted realtime uses the current browser origin and requires a same-origin
gateway, including in local development. If using the public redirect variable
instead of `WORKOS_REDIRECT_URI`, supply it during the web image build.

Native public signup and password recovery return HTTP 410 during alpha. Legacy
native database credentials do not support immediate revocation; a password
change alone cannot make recovery secure. WorkOS mode disables native password and self-registration endpoints. Hosted
organization invites use the existing scoped administrator route, send links
to `/auth/invite/prepare`, and exchange plaintext tokens for encrypted,
HTTP-only, ten-minute browser handoffs. A WorkOS-authenticated invitee must
already have an explicit admission mapping for their immutable provider subject,
verified email and exact local/provider organization; `allow_provision:true`
must be set for a new account before its first bridge. Invite acceptance is
single-use and grants only the administrator-selected active role. A provider
sign-in or email-domain match alone never grants membership. Newly admitted
identities must not be linked automatically to existing email accounts.

Hosted acceptance uses the internal `accept_user_invite` operation. Invitation
consumption, membership, bindings and the trusted retry receipt commit in one
module transaction. The same identity can recover a lost response without
regranting access after revocation. Deploy the matching generated contract and
module together. See [hosted lifecycle completion](plans/workos-lifecycle-completion.md)
for explicit legacy-account linking, verified email updates, profile projection
retries and role administration.

Verify approved and denied sign-in, founder bootstrap, cross-tenant denial,
invitation acceptance/replay/expiry, refresh, logout, and provider outage on an
isolated stack before release. No external WorkOS configuration or deployment
is performed by this patch.

## Shared immutable Rust runtime image

Reviewed invoice email and collection reminders require a dedicated dispatcher
identity and explicit per-message sending. Configure the provider, renderer, and
service binding described in [Accounting email dispatch](./ACCOUNTING_EMAIL_DISPATCH.md)
before enabling that workflow.

`lumiere-contracts` is a versioned library dependency, not a Railway service.
Do not deploy the contracts repository as an HTTP service or add a contracts
service URL to application configuration. The generated types and metadata are
compiled into the application artifacts; running services do not fetch them
from a contracts server.

Rust builds verify and unpack the vendored release archive against its checksum
and `release-compatibility-manifest.json`. TypeScript builds install the vendored
`@lumiere/contracts` package with the version and integrity pinned in
`frontend/pnpm-lock.yaml`. Both consume the published release without regenerating
or rewriting contract definitions during deployment.

The Rust Dockerfiles prepare contracts before copying application sources, so
source-only edits reuse that Docker layer when the build cache is available.
A clean build still verifies the pinned contracts, and a contracts release change
invalidates the layer. After the shared image is built, promoting or restarting
its digest performs no contracts build or download. This is once per image build,
not a one-time bootstrap dependency that can be dropped from future builds.

The **Build Rust runtime image** workflow compiles the Rust service graph once
and publishes one OCI image to GHCR. It deliberately includes only these nine
executables:

| Railway service | `LUMIERE_BIN` | Purpose |
|---|---|---|
| `api-server` | `api-server` | HTTP API and readiness surface |
| `ai-gateway` | `gateway` | AI gateway HTTP service |
| `expense-integration-worker` | `expense-integration-worker` | Expense intent integration |
| `hr-integration-worker` | `hr-integration-worker` | HR and payroll partner integration |
| `projection-worker` | `projection-worker` | SpacetimeDB to PostgreSQL projection |
| `project-integration-worker` | `project-integration-worker` | Project payroll, calendar, and e-invoice integration |
| `workflow-worker` | `workflow-worker` | Workflow execution |
| `owner-report-worker` | `owner-report-worker` | Owner report generation |
| `storage-migrate` | `storage-migrate` | One-shot PostgreSQL migration gate |

Each Railway service remains an independently configured and scaled service.
Set its `LUMIERE_BIN` to the value above, while pointing all nine services at the
same image digest. The entrypoint rejects missing and unknown selectors; it
cannot be used to execute an arbitrary path from an environment variable.

Push builds publish a full-commit tag such as
`ghcr.io/kevtiv/lumiere-v-1-rust-runtime:<40-character-sha>`, generate BuildKit
provenance and an SBOM, and report the resulting digest in the workflow summary.
The workflow refuses to overwrite an existing commit tag. Pull requests build
and validate the image without publishing it. Never configure Railway with a
mutable tag such as `latest`; use the reported
`ghcr.io/kevtiv/lumiere-v-1-rust-runtime@sha256:<digest>` coordinate.

Before dispatching **Release Railway stack**, pass the reported digest as
`rust_runtime_image`. The workflow first verifies that the digest is available
through an anonymous registry pull, because the automated Railway image-source
promotion does not install registry credentials. Keep this GHCR package public;
the image contains executables and public build metadata, never runtime secrets.
The release also reads `org.opencontainers.image.revision` from the pulled image
and requires it to equal `release_sha`; a digest built from another commit is
rejected before any Railway change.

For each shared-runtime service, the release submits one environment-scoped
Railway configuration patch that sets `source.image` to the exact digest while
clearing `source.repo`, `source.branch`, `source.commitSha`, and
`source.upstreamUrl`. The atomic source switch triggers the deployment. A retry
at an already-configured digest explicitly redeploys the same source. Every
phase then checks Railway's deployment metadata against the requested digest
and stops the release on a mismatch.

Building the image never deploys it. Promotion remains explicit and ordered by
the release workflow, so a newly published image cannot replace production
while the stack is still being validated.

### Shared owner-report artifact bucket

`api-server` writes and downloads owner-report PDFs while
`owner-report-worker` validates scheduled-run artifacts. Because those are
separate Railway containers, production fails closed unless both services use
the same S3-compatible bucket:

| Variable | Railway bucket reference |
|---|---|
| `LUMIERE_REPORT_ARTIFACT_BACKEND` | literal `s3` |
| `LUMIERE_REPORT_S3_ENDPOINT` | `${{report-artifacts.ENDPOINT}}` |
| `LUMIERE_REPORT_S3_BUCKET` | `${{report-artifacts.BUCKET}}` |
| `LUMIERE_REPORT_S3_REGION` | `${{report-artifacts.REGION}}` |
| `LUMIERE_REPORT_S3_ACCESS_KEY_ID` | `${{report-artifacts.ACCESS_KEY_ID}}` |
| `LUMIERE_REPORT_S3_SECRET_ACCESS_KEY` | `${{report-artifacts.SECRET_ACCESS_KEY}}` |
| `LUMIERE_REPORT_S3_PREFIX` | optional; defaults to `owner-reports` |

The client uses standard virtual-host S3 URLs, matching Railway buckets. Local
filesystem storage remains the development default and is rejected when the
runtime environment is production. Hash-named artifacts are not deleted when
metadata recording fails because another report may already reference the same
content-addressed object; orphan cleanup must be an explicit retention/repair
operation.

### Managed uploaded document storage

Managed vendor-bill evidence and DMS uploads use the API server's local blob
backend, separately from the owner-report bucket above. The production manifest
pins `LUMIERE_DOCUMENT_BLOB_DIR=/data/document-blobs`. Before release, verify the
API service has its persistent `api-documents-eu` volume mounted at `/data` in
`europe-west4-drams3a`; a variable alone does not create or attach a volume.
Preserve and back up the uploaded bytes and their sidecar metadata together,
and verify download after container replacement and backup restoration. The
runtime's unset default is temporary storage and is unsuitable for production.

The disk backend supports one API replica. Production preflight checks the
configured replica total from Railway service metadata and rejects more than
one; operators must independently verify the actual volume mount and backup
policy. Do not scale out until a shared document backend is implemented and
verified. Docker Compose uses its persistent API-only `document-blobs` volume at
`/var/lib/lumiere/document-blobs`. Current document upload/download and evidence
parsing execute in the API, so worker containers do not mount this volume.

### Optional reviewed-email readiness

Keep reviewed email unconfigured when it is outside the release scope. Preflight
requires the dedicated dispatcher token, owner token, provider key and sender
address if either the dispatcher token or provider key is configured on the API,
or if the preflight process sets `RAILWAY_ENABLE_REVIEWED_MAIL=true`. This is an
operator selection for the check, not a runtime feature flag. A false selection
does not suppress checks for partially configured credentials. Unsealed owner
and dispatcher tokens must differ; sealed values cannot establish distinctness
through Railway's variables response.

The existing private-network service bootstrap accepts an already provisioned
`LUMIERE_REVIEWED_MAIL_STDB_TOKEN` and registers `reviewed_mail_dispatcher` for
each actual organization when selected or configured. It never mints this token,
rejects an identity shared with another active service, and refuses to replace a
different active reviewed-mail binding. Normal bootstrap
still provisions its existing integration-worker identities; it is not a routine
readiness command. For read-only identity and per-organization binding verification,
run this from the trusted private network with the existing server and dispatcher
credentials supplied through the normal secret environment:

```bash
node scripts/railway-bootstrap-service-identities.mjs --verify-reviewed-mail
```

This mode neither mints credentials nor registers bindings, needs no bootstrap
encryption key, and rejects an empty tenant database as insufficient evidence.
Repeat it after onboarding a new organization. Runtime dispatch independently
verifies the token's database-authenticated identity and the active organization
binding before a claim or provider request. PDF attachment selection additionally
requires a working `LUMIERE_REPORT_RENDERER_URL`; text-only dispatch can operate
without the renderer. Configuration checks do not replace a scoped real-provider
smoke test or confirm recipient delivery. See [Accounting email dispatch](./ACCOUNTING_EMAIL_DISPATCH.md)
for exact outcomes and manual recovery.

## Ordered Railway release

For the initial empty production database, leave `enable_integrations=false`.
Expense, HR, and project integration services can be configured in advance,
but activation requires real organization IDs and the matching registered
service identities. After onboarding, register those bindings with an authorized
platform superuser, set each worker's organization allowlist, then release with
`enable_integrations=true`. Never invent tenant IDs to satisfy a readiness gate.
`enable_ai` also defaults to false while no AI provider is configured.

Use the **Release Railway stack** workflow for monorepo releases. It accepts an
immutable full commit SHA and serializes releases per Railway environment. The
workflow fails closed between these phases:

Before phase 1, production is checked against
[`infra/railway/production-eu-services.json`](../infra/railway/production-eu-services.json).
The preflight reports missing or ambiguous services, non-EU replicas, absent
dedicated worker tokens, placeholder credentials, and invalid organization-ID
lists without printing variable values. This pass intentionally defines only
production; development infrastructure and data remain deferred.

The production control plane reports `europe-west4`; the exact runtime zone is
`europe-west4-drams3a`. The manifest records these identifiers separately.
Preflight checks configured replicas, including explicit configuration for a
service that has never deployed. The ordered rollout still verifies the exact
`RAILWAY_REPLICA_REGION` after deployment. It does not move existing volumes.

1. Existing `Postgres` and `spacetimedb` deployments must be successful and
   report the configured EU `RAILWAY_REPLICA_REGION`. `qdrant` is required only
   when `enable_ai=true`. Kong uses instance-local protective rate limits, so
   Redis is not part of the baseline production topology.
2. The one-shot `spacetimedb-publisher` builds the lean production module from the release commit, publishes
   it without clearing data, and must describe a schema containing reducers,
   tables, types, and a typespace, including the canonical `organization`
   table. Its Railway restart policy must be `NEVER`.
3. The one-shot `storage-migrate` service applies the checksum-verified
   PostgreSQL catalog, must reach terminal success, and must emit the explicit
   `PostgreSQL storage migrations applied and verified successfully` marker.
   A fresh database cannot advance to API deployment without both gates; a
   Railway success state without the marker is rejected.
4. `chromium-worker` deploys and reaches readiness before API report rendering
   can depend on it. Railway probes `/health`; the deeper `/health/ready` probe
   starts Chromium only for release validation. An idle browser closes after
   `CHROMIUM_IDLE_TIMEOUT_MS` (60 seconds by default).
5. `api-server` deploys and reaches readiness against the published schema and
   migrated PostgreSQL catalog.
6. `ai-gateway` deploys only when the explicit `enable_ai` input is true, and
   is disabled by default for the initial ERP release. AI never gates the ERP
   phases when that input is false.
7. `projection-worker` deploys and reaches readiness before downstream workers.
8. `workflow-worker` and `owner-report-worker` may then deploy concurrently;
   both must pass their configured readiness gates.
9. The expense, HR, and project integration workers deploy together from the
   same immutable image and must reach readiness with dedicated service tokens
   registered for every configured organization.
10. `web` deploys only after the backend and worker graph is settled.
11. `api-gateway` deploys last. Production dispatches require a public edge
   readiness URL and do not complete until it returns HTTP 2xx.

Configure the matching `RAILWAY_*_READINESS_URL` GitHub Environment secrets to
add explicit HTTP readiness probes after each service deployment. Railway
terminal deployment success remains mandatory even when no external probe URL
is configured.

Every upload, deployment wait, schema check, and HTTP probe has a timeout.
Terminal failures print recent deployment metadata and logs. A failed phase
prevents every downstream phase; successfully started deployments are not
automatically rolled back.

The workflow uses service names rather than dashboard UUIDs. Keep those names
stable or update [the workflow](../.github/workflows/release-railway-stack.yml)
and the Railway canvas together.

## Production integration workers

The three integration workers are production services, not API-server threads.
Each uses its own SpacetimeDB identity and explicit organization allowlist:

| Service | Dedicated token | Organization IDs | Health port |
|---|---|---|---:|
| `expense-integration-worker` | `STDB_EXPENSE_WORKER_TOKEN` | `LUMIERE_EXPENSE_WORKER_ORG_IDS` | 8092 |
| `hr-integration-worker` | `STDB_HR_WORKER_TOKEN` | `LUMIERE_HR_WORKER_ORG_IDS` | 8094 |
| `project-integration-worker` | `STDB_PROJECT_WORKER_TOKEN` | `LUMIERE_PROJECT_WORKER_ORG_IDS` | 8093 |

Tokens must be real, distinct dedicated credentials and must not reuse
`STDB_SERVER_TOKEN` or another worker token. Register each token identity under
`expense_integration_worker`, `hr_integration_worker`, or
`project_integration_worker` for every organization listed by that service.
Organization lists are comma-separated positive numeric IDs; an empty list
leaves the worker permanently unready and is rejected by the production
preflight. Do not commit token or organization values to this manifest.

Configure all three GitHub Environment secrets
`RAILWAY_EXPENSE_INTEGRATION_READINESS_URL`,
`RAILWAY_HR_INTEGRATION_READINESS_URL`, and
`RAILWAY_PROJECT_INTEGRATION_READINESS_URL`. Production release validation
requires them and phase 9 probes every `/health/ready` endpoint.

Each service also needs `LUMIERE_ENV=production`, its exact `LUMIERE_BIN` and
worker port, `STDB_HOST`, `STDB_MODULE`, `AI_GATEWAY_URL`, and the production
placement variables `LUMIERE_PLACEMENT_GENERATION`, `LUMIERE_CELL_ID`, and
`LUMIERE_DURABLE_STORE_ID`. `AI_GATEWAY_URL` remains shared configuration even
while AI promotion is disabled; the integration workers do not invoke AI.

The ordered workflow runs the checksum-verified catalog through the one-shot
`storage-migrate` service. For local operation or manual recovery, the
equivalent command is:

```bash
cargo run --locked -p api-server --bin storage-migrate
```

The command uses the same `PG_*` variables as api-server and exits non-zero if
the existing migration history is incompatible with the release.

Inspect the intended database before the apply phase using the new release's
binary and a database role with catalog/table read access:

```bash
storage-migrate --audit
storage-migrate --verify
```

Both commands run a read-only, repeatable-read transaction. They inspect only
the current or legacy migration-history relation, never create or adopt a
relation, and never apply migrations or acquire the migration advisory lock.
The JSON report includes the compiled catalog checksum, observed identities,
pending versions and conflicts. `--audit` allows an uninitialized database or a
valid prefix; `--verify` requires the complete matching history in
`lumiere_platform.schema_migration`. Unknown future versions, holes, conflicting
names/phases/checksums, or both current and legacy relations fail closed.
Matching recorded history does not prove that all projected tables or business
data exist; readiness and recovery checks remain separate.

The financial alpha candidate preserves the released main catalog unchanged:
platform identity remains at 17 and invitation receipts remain at 18. Purchasing
keyed operations and bank settlement lifecycle tables are added together in the
new generated migration 19, `financial_alpha_operations`. The generator must
emit and promote that additive artifact before release; existing released SQL
must remain byte-for-byte unchanged.

The earlier accounting branch used a different lineage: purchasing at 17,
invitation receipts at 18, bank lifecycle at 19 and platform identity at 20.
A target with that history requires a separately reviewed transition before
using this main-based candidate. These audit commands reject that lineage and
never rewrite its history. The default invocation and `--apply` retain the
existing migration behavior.

## Host `.env` (docker compose)

These variables use `${VAR:?set VAR}` in `docker-compose.yml` — Compose fails at parse time if they are missing:

| Variable | Used by | Notes |
|----------|---------|--------|
| `STDB_MODULE` | web, api-server, ai-gateway | Published SpacetimeDB database name |
| `STDB_SERVER_TOKEN` | web, api-server | Admin/service JWT for HTTP SQL and auth reducers |
| `STDB_FINALIZATION_TOKEN` | projection-worker | Dedicated registered `projection_worker` identity; must differ from `STDB_SERVER_TOKEN` |
| `STDB_TOKEN` | ai-gateway | Service token for SpacetimeDB HTTP API (not the same as `STDB_SERVER_TOKEN`) |
| `AI_CERTIFICATION_STDB_TOKEN` | ai-gateway | Dedicated certification executor token; never reuse browser, API, or general gateway credentials |
| `AI_CERTIFICATION_RUNTIME_HASH` | ai-gateway | Registered immutable executor digest (`sha256:` plus 64 lowercase hex characters) |
| `AI_SPEND_READ_STDB_TOKEN` | ai-gateway | Dedicated identity for the released sender-scoped H5b read views; never reuse `STDB_TOKEN` or the certification token, and never grant it database-owner access |
| `LUMIERE_AI_GATEWAY_INTERNAL_SECRET` | web, api-server, ai-gateway | Shared secret (`X-Lumiere-Gateway-Secret`) |

Common optional host overrides (have defaults in compose):

| Variable | Default in compose | Purpose |
|----------|-------------------|---------|
| `STDB_HOST` | `https://maincloud.spacetimedb.com` | SpacetimeDB HTTP base |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:8000` | Public app URL (set to your Kong/proxy URL in prod) |
| `CORS_ORIGINS` | `http://localhost:8000,...` | Allowed browser origins for api-server CORS |
| `EMBEDDING_PROVIDER` | `ollama` | ai-gateway embed backend |
| `OLLAMA_URL` | `http://host.docker.internal:11434` | Local Ollama when using Ollama embed/LLM |

## Service: api-server

Set `NODE_ENV=production` or `LUMIERE_ENV=production`. **api-server refuses to start** if any of these are missing or invalid:

| Variable | Required | Notes |
|----------|----------|--------|
| `STDB_MODULE` or `NEXT_PUBLIC_STDB_MODULE` | yes | Database name |
| `STDB_SERVER_TOKEN` | yes | Non-empty |
| `AI_GATEWAY_URL` | yes | Internal ai-gateway base URL; must not contain `localhost` or `127.0.0.1` |
| `LUMIERE_PROJECTION_LAG_BUDGET_SECS` | optional (default 300) | Maximum duration PostgreSQL may remain unavailable after a proven healthy probe while active ERP readiness remains degraded but available. |
| `PG_TLS_MODE` | yes when PostgreSQL is used | Use `require` for normal/public endpoints. Railway services may explicitly use `private-network` only with an internal `PG_HOST` ending in `.railway.internal`. |
| `PG_HOST` | yes when PostgreSQL is used | The database hostname. `private-network` fails closed unless this is Railway private DNS. |
| `STDB_HOST` or `NEXT_PUBLIC_STDB_HOST` | recommended | Defaults to maincloud if unset |
| `CORS_ORIGINS` | recommended | Comma-separated origins for credentialed browser calls |
| `LUMIERE_AI_GATEWAY_INTERNAL_SECRET` | yes (compose) | BFF → gateway auth |
| `STDB_CREDENTIAL_ENCRYPTION_KEY` | for password auth | 64 hex chars (32-byte AES key) |
| `WORKOS_CLIENT_ID` | optional | When set, password routes return 410 |
| `RESEND_API_KEY` | optional | Transactional email |

In compose, `AI_GATEWAY_URL` is wired to `http://ai-gateway:8080`.

`PG_TLS_MODE=private-network` is a narrow Railway deployment exception for the
provider's project/environment-scoped private service network. It disables TLS
between the application and PostgreSQL to avoid treating Railway's internal CA
certificate as a public end-entity certificate. The runtime accepts it only in
production and only for a host whose name ends exactly in `.railway.internal`;
public Railway TCP proxy hosts and all non-Railway hosts are rejected. The DNS
suffix check is a configuration guard, not a replacement for network isolation:
keep both services in the same trusted Railway environment and use `require`
whenever traffic can leave that private network.

The api-server endpoints have separate purposes: `/live` is liveness-only (`/health` is its
compatibility alias), while `/ready` returns structured SpacetimeDB, PostgreSQL, projection,
contract, migration, release, and informational AI diagnostics (`/health/ready` is its alias). A PostgreSQL outage is reported through
`X-Lumiere-Degraded: postgres` only within the configured, last-known-healthy lag budget;
AI availability never gates ordinary ERP readiness. The slim Rust images do not contain `curl`, so
compose does not add an in-container healthcheck dependency gate. Run the host/sibling
probe instead:

```bash
node scripts/check-compose-readiness.mjs \
  --api http://api-server:8082/health/ready \
  --ai http://ai-gateway:8080/health/ready \
  --probe owner-report=http://owner-report-worker:8091/health/ready \
  --probe workflow=http://workflow-worker:8093/health/ready \
  --probe projection=http://projection-worker:8096/health/ready \
  --probe chromium=http://chromium-worker:8090/health/ready
```

The projection worker is the sole SpacetimeDB-to-PostgreSQL durability and C5
finalization service. After applying the ordered commit stream, it reads the
pinned generated archive manifest and runs each supported candidate through
its reviewed domain finalizer. Unknown candidate/reducer/mode combinations
fail startup instead of being skipped. Set `LUMIERE_FINALIZATION_WORKER_BATCH`
to a value from 1 through 200 (default 100).

The current policy has one active archive root: `pos_order`; its reviewed
`pos_order_line` and `pos_payment` children inherit the aggregate archive.
`audit_log` is `always_hot`; its retired cold schema, read merge, drainer, and
finalizer are not part of the deployable application.

The worker uses `STDB_SERVER_TOKEN` only for private source/commit-table reads
and uses `STDB_FINALIZATION_TOKEN` only for finalizer reducer calls. Both must
be present and distinct; startup fails closed otherwise. Register the exact
finalization-token identity for each organization under `projection_worker`.

Before enabling cooling for an organization, register the projection worker's
dedicated SpacetimeDB identity under the service name `projection_worker` with
`register_cold_tier_service_identity`. The registration is a direct owner-token
operations action and must not be exposed through the application API. The
retired `audit_cold_drainer` and `pos_order_cold_drainer` service names are no
longer accepted by finalization reducers.

When running the probe from a sibling container, use Compose service DNS names such as
`chromium-worker`; host-side probes should use published or externally routed hostnames.

## Service: web (Next.js)

| Variable | Required | Notes |
|----------|----------|--------|
| `LUMIERE_API_SERVER_URL` | yes | Internal api-server base (compose: `http://api-server:8082`) |
| `STDB_SERVER_TOKEN` | yes | Server-side SQL and auth |
| `LUMIERE_AI_GATEWAY_INTERNAL_SECRET` | yes | AI BFF routes |
| `STDB_MODULE` / `NEXT_PUBLIC_STDB_MODULE` | yes | Must match published database |
| `STDB_HOST` / `NEXT_PUBLIC_STDB_HOST` | yes | SpacetimeDB host |
| `NEXT_PUBLIC_APP_URL` | recommended | Public URL for links and cookie scope |
| `LUMIERE_AI_GATEWAY_URL` | in compose | Internal ai-gateway (`http://ai-gateway:8080`) |

### Build-time `NEXT_PUBLIC_*`

The web Docker image runs `pnpm --filter web build` without build-args today. For production, ensure **`NEXT_PUBLIC_STDB_MODULE`** and **`NEXT_PUBLIC_STDB_HOST`** are available at **build** time (Docker build args or CI env) so the client bundle matches `STDB_MODULE` / `STDB_HOST`.

Realtime WebSocket: Kong/same-origin deployments use `wss://<host>/v1/realtime/ws` by default. Override with `NEXT_PUBLIC_REALTIME_WS_URL` or `NEXT_PUBLIC_API_GATEWAY_URL` if the browser should connect elsewhere (see `docs/ENVIRONMENT.md`).

## Service: ai-gateway

| Variable | Required | Notes |
|----------|----------|--------|
| `STDB_MODULE` | yes | |
| `STDB_TOKEN` | yes | Service account token |
| `AI_CERTIFICATION_STDB_TOKEN` | yes | Dedicated token matching the active organization certification runtime profile |
| `AI_CERTIFICATION_RUNTIME_HASH` | yes | Exact digest registered in that runtime profile |
| `AI_SPEND_READ_STDB_TOKEN` | yes for governed generation | Dedicated `ai_spend_reader` identity for sender-scoped H5b views; the gateway principal separately needs `ai_spend/reserve` and `ai_spend/settle` grants |
| `LUMIERE_AI_GATEWAY_INTERNAL_SECRET` | yes | |
| `QDRANT_URL` | in compose | `http://qdrant:6334` (gRPC) |
| `STDB_HOST` | recommended | Defaults in gateway dev config only |

Provider keys (`MISTRAL_API_KEY`, `GOOGLE_API_KEY`, etc.) depend on tenant `AiAgent` rows and `EMBEDDING_PROVIDER`.

The gateway exposes `/health` for process liveness and `/health/ready` for a
bounded, read-only SpacetimeDB and primary-Qdrant check. Readiness also validates
configured provider credentials/endpoints and calls only safe Ollama `/api/tags`
and the operator-supplied `KONG_LLM_READINESS_URL`. It never generates text,
vision output, searches, or embeddings. Monitor Mistral, Gemini, Unstructured,
and Tavily runtime errors separately because their readiness is configuration-only.

Before enabling certification for an organization, an active platform
superuser must call `register_ai_skill_certification_runtime_profile` directly
in SpacetimeDB with the dedicated token's exact executor identity and the same
`AI_CERTIFICATION_RUNTIME_HASH`. The public reducer endpoint intentionally
blocks runtime registration, claims, completion, and failure. Rotate a runtime
by registering a new profile, deploy the matching token/hash together, and
allow already-pinned jobs to finish; promotion accepts evidence from only the
currently active profile.

## Quick start (Docker)

```bash
cp frontend/web/.env.example .env   # edit with production values
make check-env-prod
docker compose up --build
```

Kong listens on `:8000`; api-server, web, and ai-gateway are internal-only (`expose`, not published).

## Related docs

- [`docs/ENVIRONMENT.md`](ENVIRONMENT.md) — full variable reference and local/maincloud modes
- [`Makefile`](../Makefile) — `make check-env-prod`, SpacetimeDB publish targets

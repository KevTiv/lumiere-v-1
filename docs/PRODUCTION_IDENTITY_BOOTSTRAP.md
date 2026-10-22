# Production identity bootstrap and rotation

Lumiere uses SpacetimeDB-issued identities for service-to-database authentication. Production
bootstrap mints a different identity for every worker trust boundary, validates each token against
the published module, registers organization-scoped service bindings, and writes the credentials
directly to service-scoped Doppler configs. Token values are never printed or written to disk.

The existing SpacetimeDB database owner token remains the root credential. Keep it only in the
bootstrap job and in services that require owner-only reads. Do not mint a random replacement:
an identity created by `/v1/identity` does not automatically own the published database.

## One-time secret boundary

Create these manually as sealed variables on a dedicated, operator-run bootstrap job:

- `STDB_SERVER_TOKEN`: owner of the published `STDB_MODULE`.
- `DOPPLER_API_TOKEN`: narrowly scoped write credential for the Lumiere project/configs.

Each application service should receive one read-only Doppler service token for only its own
config. Seal that token in Railway. All rotating SpacetimeDB credentials then live in Doppler,
not as individually managed Railway variables.

The Rust and web production images include the checksum-pinned Doppler CLI. When `DOPPLER_TOKEN`
is present, their entrypoints run the application through `doppler run`; set
`DOPPLER_REQUIRED=1` in production so a missing service token fails closed. Development and
existing deployments continue to use ordinary environment variables when Doppler is not enabled.

Railway's public variable API cannot create or update sealed values. This one-time manual boundary
is intentional; do not replace it with readable bootstrap variables.

## Configuration map

`DOPPLER_CONFIG_MAP_JSON` maps logical service names to Doppler config slugs. Only mapped services
are provisioned, so the currently deployed core can be bootstrapped without creating unused
credentials:

```json
{
  "api-server": "prd_api_server",
  "web": "prd_web",
  "ai-gateway": "prd_ai_gateway",
  "owner-report-worker": "prd_owner_report",
  "workflow-worker": "prd_workflow",
  "projection-worker": "prd_projection"
}
```

Supported future services are `expense-integration-worker`, `hr-integration-worker`,
`project-integration-worker`, and `iot-gateway`.

## Bootstrap

Set `AI_CERTIFICATION_RUNTIME_HASH` to the immutable deployed executor digest. Choose a unique,
non-secret `LUMIERE_IDENTITY_RUN_ID`, such as the release SHA or deployment identifier.

First inspect the redacted plan:

```bash
node scripts/bootstrap-production-identities.mjs
```

Apply only after verifying the selected service/config mapping:

```bash
node scripts/bootstrap-production-identities.mjs --apply --mode bootstrap
```

The deployable bootstrap image is `infra/identity-bootstrap/Dockerfile`. It performs a dry run by
default. Set `LUMIERE_IDENTITY_APPLY=1` only for an intentional operator-run execution; keep it at
`0` for normal deploys. `LUMIERE_IDENTITY_MODE` accepts `bootstrap` or `rotate`.

On the first bootstrap only, set `LUMIERE_INITIALIZE_NON_ROTATING_SECRETS=1` to create the initial
credential-encryption key, AI execution-envelope key, and gateway internal secret. Leave the flag
unset on every subsequent execution so an accidental bootstrap rerun cannot replace keys that need
a data migration or coordinated rollout. The command distributes only the credentials each mapped
service consumes.

After the command succeeds, configure services to load their service-scoped Doppler config at
process startup, then deploy them. A successful secret write is not proof of a successful Railway
deployment; verify every deployment reaches `SUCCESS` and every readiness endpoint passes.

## Rotation

The module permits one active identity per organization and service name. Rotation is therefore a
controlled maintenance operation, not a zero-downtime hot swap:

1. Drain the affected worker services and confirm no claimed work remains in flight.
2. Set a fresh `LUMIERE_IDENTITY_RUN_ID`.
3. Set `LUMIERE_ROTATION_DRAINED=1` only after the drain is confirmed.
4. Run `node scripts/bootstrap-production-identities.mjs --apply --mode rotate`.
5. Redeploy the mapped services and verify terminal Railway success and readiness.
6. Remove the drain only after all services authenticate with their new identities.

Rotation changes only SpacetimeDB identities and the certification runtime profile. It deliberately
does not rotate `STDB_CREDENTIAL_ENCRYPTION_KEY`, `LUMIERE_AI_GATEWAY_INTERNAL_SECRET`, or
`AI_EXECUTION_ENVELOPE_KEY`: those require separate data re-encryption or dual-key rollout plans.

The general AI gateway `STDB_TOKEN` still needs its organization membership and explicit
`ai_spend/reserve` and `ai_spend/settle` grants. The bootstrap does not grant broader application
permissions automatically.

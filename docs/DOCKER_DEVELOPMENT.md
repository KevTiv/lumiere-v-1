# Docker development with OrbStack

For the native fast E2E loop and CI build reuse, see the
[build and CI guide](guides/build-and-ci-dx.md). These host-side improvements do
not change the Docker development targets described below.

The production [`docker-compose.yml`](../docker-compose.yml) remains unchanged.
Use [`docker-compose.dev.yml`](../docker-compose.dev.yml) for local development:
it runs the web app, Rust API, AI gateway, local SpacetimeDB, Qdrant, Redis,
the PDF renderer, and optionally the IoT gateway plus MQTT broker. OrbStack
shows each service's health state from the Compose health checks.

## First run

1. Initialize local SpacetimeDB and the private environment file:

   ```sh
   make init-stack
   ```

   This creates `.env.docker` with mode `0600`, generates the internal gateway
   secret, obtains the local database-owner token, and publishes the module.
   It never overwrites an existing `.env.docker`.

2. Start the main development stack:

   ```sh
   make docker-dev
   ```

   The frontend image forwards `~/.ssh/id_ed25519` to BuildKit while it fetches
   the private, tag-pinned `lumiere-contracts` dependency. The Rust development
   services mount the same key and `~/.ssh/known_hosts` as read-only Compose
   secrets for Cargo. The key is not copied into an image or the repository. It
   must have read access to the contracts repository.

   Run `make docker-dev-iot` to include the IoT gateway and MQTT broker.

   If a local server key changes after manual recovery, run
   `make refresh-stack-tokens` to replace only the SpacetimeDB credentials in
   `.env.docker`. This target does not rebuild or republish the module. It also
   replaces and verifies each existing organization's dedicated worker
   bindings. After the first fixture seed, run `make register-stack-identities`
   once because no organization exists during the initial stack bootstrap.

The app is at `http://localhost:3001`; SpacetimeDB is at `http://localhost:3000`.
The API, AI gateway, IoT gateway, Qdrant, Redis, and MQTT ports are also
published for direct debugging: `8082`, `8080`, `8081`, `6333`, `6379`, and
`1883` respectively.

## Governed action-draft prerequisites

The H5b spend and draft-request tables stay private. Five public views expose
only the fields required for admission and replay, and only to the active
`ai_spend_reader` identity for each organization. `make init-stack` mints the
dedicated `AI_SPEND_READ_STDB_TOKEN`; `make register-stack-identities` binds it
after the first organization is seeded.

Complete these configuration steps:

1. Run `make register-stack-identities`. The spend-reader token must differ
   from `STDB_TOKEN` and `AI_CERTIFICATION_STDB_TOKEN`.
2. Open **AI Skills** as an authorized organization administrator and select
   **Sync bundled skills → STDB**. The route fails closed when the bundled
   `action_draft_generation` skill is not provisioned.
3. Start Ollama and make the configured model available. The development seed
   selects the local `gemma4:e2b-mlx` model and `embeddinggemma:latest` for
   embeddings. It allows `action_draft`. Set `OLLAMA_LLM_MODEL` to another installed model only when the tenant-owned
   default `AiAgent` row uses the same model. Keep
   `OLLAMA_SUPPORTS_TOOL_CALLING=true` only for a model that supports the
   required structured tool calls.

Cloud providers remain optional. An organization administrator can
intentionally select a Mistral, Gemini, or Kong-backed agent and then configure
the matching credential.

Recreate `ai-gateway` after an environment change:

```sh
docker compose --env-file .env.docker -f docker-compose.dev.yml up -d --force-recreate ai-gateway
```

Do not make the H5b tables public and do not substitute the database owner token
for the dedicated spend-read token. The planned views must filter by the
registered caller identity and expose only the bounded fields needed by the
gateway.
Do not provision skills at request time; deployments and administrators own
that action.

## Development behavior

- The web service runs `next dev` with polling enabled for reliable macOS bind
  mount file watching.
- Rust services use `cargo watch`; editing their crate or shared `crates/`
  restarts only that service.
- Rust artifacts are stored in the OrbStack `cargo-target` volume, not the host
  repository. This gives incremental builds a persistent Linux cache and stops
  local `target/` from growing during container work.
- The workflow worker uses split credentials. `STDB_SERVER_TOKEN` reads private
  workflow source rows. `STDB_WORKFLOW_WORKER_TOKEN` is the registered service
  identity for reducer calls. The two tokens must be different.
- Rust services default to one Cargo build job, no incremental state, and no
  development debug symbols. This keeps the large generated contracts crate
  within the default OrbStack memory limit. Override `CARGO_BUILD_JOBS`,
  `CARGO_INCREMENTAL`, or `CARGO_PROFILE_DEV_DEBUG` when the VM has more memory.
- The SpacetimeDB and Qdrant volumes persist data across `up` / `down`.
  SpacetimeDB keeps its local JWT signing key under the same data volume so
  credentials in `.env.docker` survive container recreation.
  To reset all development data and caches, run:

  ```sh
  docker compose --env-file .env.docker -f docker-compose.dev.yml down --volumes
  ```

## Updating the module

Keep the large WASM build on the host for now, where your installed Rust target
cache already exists. Use the repository target to build and republish the raw
release module to the containerized local server:

```sh
make publish DB=lumiere-v1
```

The local server is the official `clockworklabs/spacetime:v2.8.2` image, pinned
to match this repository's module SDK and CLI version.

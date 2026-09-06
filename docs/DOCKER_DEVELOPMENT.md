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
   docker compose --env-file .env.docker -f docker-compose.dev.yml up --build
   ```

   Add `--profile iot` to include the IoT gateway and MQTT broker.

The app is at `http://localhost:3001`; SpacetimeDB is at `http://localhost:3000`.
The API, AI gateway, IoT gateway, Qdrant, Redis, and MQTT ports are also
published for direct debugging: `8082`, `8080`, `8081`, `6333`, `6379`, and
`1883` respectively.

## Development behavior

- The web service runs `next dev` with polling enabled for reliable macOS bind
  mount file watching.
- Rust services use `cargo watch`; editing their crate or shared `crates/`
  restarts only that service.
- Rust artifacts are stored in the OrbStack `cargo-target` volume, not the host
  repository. This gives incremental builds a persistent Linux cache and stops
  local `target/` from growing during container work.
- The SpacetimeDB and Qdrant volumes persist data across `up` / `down`.
  To reset all development data and caches, run:

  ```sh
  docker compose --env-file .env.docker -f docker-compose.dev.yml down --volumes
  ```

## Updating the module

`spacetime generate` and `spacetime publish` compile the large WASM module.
Keep that build on the host for now, where your installed CLI and Rust target
cache already exist, then republish to the containerized local server:

```sh
spacetime publish lumiere-v1 --module-path spacetimedb --server local -y
```

The local server is the official `clockworklabs/spacetime:v2.0.1` image, pinned
to match this repository's module SDK and CLI version.

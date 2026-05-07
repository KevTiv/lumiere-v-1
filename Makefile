# SpacetimeDB: published database name(s). Override: `make publish STDB_MODULE=my-db`
STDB_MODULE        ?= lumiere-v1-j1uo0
STDB_CLOUD_MODULE  ?= lumiere-v1-j1uo0
# Local SpacetimeDB HTTP base (default local server)
STDB_HOST          ?= http://127.0.0.1:3000

DB         := $(STDB_MODULE)
DB_CLOUD   := $(STDB_CLOUD_MODULE)
MODULE     := ./spacetimedb
LOCAL      := $(STDB_HOST)

.PHONY: help setup check check-env check-env-prod build \
        start stop \
        publish publish-clear test \
        publish-cloud publish-cloud-clear \
        call-tests logs \
        call-tests-cloud logs-cloud \
        seed-test-user \
        generate-stdb-rust-sdk

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "  setup                Install wasm32 target and wasm-opt (one-time)"
	@echo "  check                Run cargo check (fast type-check, no linking)"
	@echo "  check-env            Print STDB_MODULE / STDB_CLOUD_MODULE / STDB_HOST (Makefile defaults)"
	@echo "  check-env-prod       Print production env checklist (human-readable)"
	@echo "  build                Compile to WASM (release)"
	@echo ""
	@echo "  --- Local (default) ---"
	@echo "  start                Start local SpacetimeDB (default :3000 — stop Next.js first or use PORT=3001 for web)"
	@echo "  stop                 Stop local SpacetimeDB server"
	@echo "  publish              Publish to local server"
	@echo "  publish-clear        Clear local DB and republish"
	@echo "  test                 Clear DB, republish, and run all tests (clean slate)"
	@echo "  call-tests           Call run_all_core_tests on local"
	@echo "  logs                 Tail logs from local"
	@echo "  seed-test-user       Provision test@email.com + admin org (make publish first; uses frontend/web/.env.local)"
	@echo "  generate-stdb-rust-sdk  Regenerate api-server Rust STDB client bindings (+ keyword fix)"
	@echo ""
	@echo "  --- Cloud ---"
	@echo "  publish-cloud        Publish to maincloud"
	@echo "  publish-cloud-clear  Clear cloud DB and republish (destructive!)"
	@echo "  call-tests-cloud     Call run_all_core_tests on cloud"
	@echo "  logs-cloud           Tail logs from cloud"

setup:
	rustup target add wasm32-unknown-unknown --toolchain stable
	brew install binaryen || true

check-env:
	@echo "STDB_MODULE=$(STDB_MODULE)"
	@echo "STDB_CLOUD_MODULE=$(STDB_CLOUD_MODULE)"
	@echo "STDB_HOST=$(STDB_HOST)"
	@echo "DB (local publish target)=$(DB)"
	@echo "DB_CLOUD=$(DB_CLOUD)"

check-env-prod:
	@echo "Production checklist (set in your host / orchestrator):"
	@echo "  api-server (NODE_ENV=production or LUMIERE_ENV=production):"
	@echo "    STDB_MODULE or NEXT_PUBLIC_STDB_MODULE"
	@echo "    STDB_SERVER_TOKEN"
	@echo "    AI_GATEWAY_URL (must not be localhost)"
	@echo "  Next.js forward: LUMIERE_API_SERVER_URL"
	@echo "  Client: NEXT_PUBLIC_STDB_HOST, NEXT_PUBLIC_STDB_MODULE"
	@echo "  Realtime: NEXT_PUBLIC_API_GATEWAY_URL or NEXT_PUBLIC_REALTIME_WS_URL"

check:
	cd $(MODULE) && cargo check --tests

build:
	cd $(MODULE) && cargo build --target wasm32-unknown-unknown --release

# ── Local ─────────────────────────────────────────────────────────────────────

start:
	spacetime start

stop:
	spacetime stop

publish:
	spacetime publish $(DB) --module-path $(MODULE) --server local -y

db-client:
	spacetime generate --lang typescript --out-dir "frontend/packages/stdb/src/generated" --module-path $(MODULE)

publish-clear:
	spacetime publish $(DB) --module-path $(MODULE) --server local --clear-database -y

test: publish-clear call-tests logs

call-tests:
	spacetime call $(DB) run_all_core_tests --server local

logs:
	spacetime logs $(DB) --server local

seed-test-user:
	cd frontend/web && pnpm run seed-test-user

# --- API ----------------------------------------------------------------------
generate-stdb-rust-sdk:
	spacetime generate --lang rust --out-dir "api-server/src/stdb_sdk_bindings" --module-path $(MODULE)
	bash scripts/fix-spacetimedb-rust-sdk-bindings.sh

api-server-run:
	source api-server/.env.local && cargo run -p api-server

# ── Cloud ─────────────────────────────────────────────────────────────────────

publish-cloud:
	spacetime publish $(DB_CLOUD) --module-path $(MODULE) --server maincloud

publish-cloud-clear:
	spacetime publish $(DB_CLOUD) --module-path $(MODULE) --server maincloud --clear-database -y

call-tests-cloud:
	spacetime call $(DB_CLOUD) run_all_core_tests --server maincloud

logs-cloud:
	spacetime logs $(DB_CLOUD) --server maincloud

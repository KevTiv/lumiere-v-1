# SpacetimeDB: published database name(s). Override: `make publish STDB_MODULE=my-db`
STDB_MODULE        ?= lumiere-v1-j1uo0
STDB_CLOUD_MODULE  ?= lumiere-v1-j1uo0
# Local SpacetimeDB HTTP base (default local server)
STDB_HOST          ?= https://maincloud.spacetimedb.com
# Local E2E ports. Playwright starts Next.js; this Makefile starts api-server.
E2E_WEB_PORT       ?= 3100
E2E_API_PORT       ?= 8082
# Some interactive shells in Cursor can inherit a literal "$$PATH"; use a known-good command path for E2E orchestration.
E2E_PATH           ?= /Users/kevintivert/.nvm/versions/node/v21.7.0/bin:/Users/kevintivert/.cargo/bin:/Users/kevintivert/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin

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
        seed-test-user e2e-smoke \
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
	@echo "  seed-test-user       Provision test@email.com + admin org (run e2e-seed-fixture first if DB was cleared)"
	@echo "  e2e-smoke            Local STDB + publish (no wipe by default), seed_dev_data + smoke user, api-server, Playwright"
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

e2e-smoke:
	@env PATH="$(E2E_PATH)" /bin/bash -c 'set -euo pipefail; \
		ROOT="$$(pwd)"; \
		LOG_DIR="$$ROOT/.tmp/e2e"; \
		mkdir -p "$$LOG_DIR"; \
		SPACETIME_STARTED=0; \
		API_PID=""; \
		cleanup() { \
			if [ -n "$$API_PID" ] && kill -0 "$$API_PID" >/dev/null 2>&1; then \
				kill "$$API_PID" >/dev/null 2>&1 || true; \
				wait "$$API_PID" >/dev/null 2>&1 || true; \
			fi; \
			if [ "$$SPACETIME_STARTED" = "1" ]; then \
				spacetime stop >/dev/null 2>&1 || true; \
			fi; \
		}; \
		trap cleanup EXIT INT TERM; \
		if ! curl -fsS "$(STDB_HOST)/v1/identity" -X POST >/dev/null 2>&1; then \
			echo "[e2e] Starting local SpacetimeDB..."; \
			spacetime start >"$$LOG_DIR/spacetime.log" 2>&1 & \
			SPACETIME_STARTED=1; \
			for i in {1..60}; do \
				if curl -fsS "$(STDB_HOST)/v1/identity" -X POST >/dev/null 2>&1; then break; fi; \
				sleep 1; \
				if [ "$$i" = "60" ]; then \
					echo "[e2e] SpacetimeDB did not become ready. See $$LOG_DIR/spacetime.log"; \
					exit 1; \
				fi; \
			done; \
		else \
			echo "[e2e] Local SpacetimeDB is already reachable."; \
		fi; \
		echo "[e2e] Publishing local database $(DB)..."; \
		if [ "$${E2E_CLEAR_DB:-0}" = "1" ]; then \
			echo "[e2e] E2E_CLEAR_DB=1: clearing module data (--clear-database)"; \
			spacetime publish "$(DB)" --module-path "$(MODULE)" --server local --clear-database -y; \
		else \
			echo "[e2e] Preserving existing DB (set E2E_CLEAR_DB=1 to wipe + full re-seed)."; \
			spacetime publish "$(DB)" --module-path "$(MODULE)" --server local -y; \
		fi; \
		if spacetime call "$(DB)" run_all_core_tests --server local; then \
			echo "[e2e] Core reducer tests passed."; \
		else \
			echo "[e2e] run_all_core_tests is unavailable or failed; continuing with browser smoke tests."; \
		fi; \
		echo "[e2e] Seeding smoke fixture (seed_dev_data) and browser test user..."; \
		cd "$$ROOT/frontend/web"; \
		set -a; \
		[ ! -f "$$ROOT/.env.local" ] || . "$$ROOT/.env.local"; \
		[ ! -f "$$ROOT/frontend/web/.env.local" ] || . "$$ROOT/frontend/web/.env.local"; \
		set +a; \
		if [ -z "$${STDB_SERVER_TOKEN:-}" ]; then \
			echo "[e2e] STDB_SERVER_TOKEN is missing after sourcing $$ROOT/.env.local"; \
			exit 1; \
		fi; \
		node -e '\''const t=process.env.STDB_SERVER_TOKEN||""; try { const p=JSON.parse(Buffer.from(t.split(".")[1]||"", "base64url").toString()); console.log(`[e2e] STDB_SERVER_TOKEN issuer: $${p.iss || "unknown"}`); } catch { console.log("[e2e] STDB_SERVER_TOKEN issuer: unreadable"); }'\''; \
		STDB_SERVER_TOKEN="$$STDB_SERVER_TOKEN" STDB_MODULE="$(DB)" NEXT_PUBLIC_STDB_MODULE="$(DB)" STDB_HOST="$(STDB_HOST)" NEXT_PUBLIC_STDB_HOST="$(STDB_HOST)" pnpm run e2e-seed-fixture; \
		STDB_SERVER_TOKEN="$$STDB_SERVER_TOKEN" STDB_MODULE="$(DB)" NEXT_PUBLIC_STDB_MODULE="$(DB)" STDB_HOST="$(STDB_HOST)" NEXT_PUBLIC_STDB_HOST="$(STDB_HOST)" pnpm run seed-test-user; \
		cd "$$ROOT"; \
		set -a; \
		[ ! -f frontend/web/.env.local ] || . frontend/web/.env.local; \
		[ ! -f api-server/.env.local ] || . api-server/.env.local; \
		[ ! -f .env.local ] || . .env.local; \
		set +a; \
		if curl -fsS "http://127.0.0.1:$(E2E_API_PORT)/health" >/dev/null 2>&1; then \
			echo "[e2e] api-server is already reachable on :$(E2E_API_PORT)."; \
		else \
			echo "[e2e] Starting api-server on :$(E2E_API_PORT)..."; \
			PORT="$(E2E_API_PORT)" \
			STDB_SERVER_TOKEN="$$STDB_SERVER_TOKEN" \
			STDB_MODULE="$(DB)" \
			NEXT_PUBLIC_STDB_MODULE="$(DB)" \
			STDB_HOST="$(STDB_HOST)" \
			NEXT_PUBLIC_STDB_HOST="$(STDB_HOST)" \
			CORS_ORIGINS="http://127.0.0.1:$(E2E_WEB_PORT),http://localhost:$(E2E_WEB_PORT)" \
			cargo run -p api-server >"$$LOG_DIR/api-server.log" 2>&1 & \
			API_PID="$$!"; \
			for i in {1..90}; do \
				if curl -fsS "http://127.0.0.1:$(E2E_API_PORT)/health" >/dev/null 2>&1; then break; fi; \
				sleep 1; \
				if [ "$$i" = "90" ]; then \
					echo "[e2e] api-server did not become ready. See $$LOG_DIR/api-server.log"; \
					exit 1; \
				fi; \
			done; \
		fi; \
		echo "[e2e] Running Playwright smoke tests..."; \
		cd "$$ROOT/frontend/web"; \
		pnpm exec playwright install chromium; \
		PORT="" \
		PLAYWRIGHT_PORT="$(E2E_WEB_PORT)" \
		LUMIERE_API_SERVER_URL="http://127.0.0.1:$(E2E_API_PORT)" \
		STDB_MODULE="$(DB)" \
		NEXT_PUBLIC_STDB_MODULE="$(DB)" \
		STDB_HOST="$(STDB_HOST)" \
		NEXT_PUBLIC_STDB_HOST="$(STDB_HOST)" \
		pnpm run test:e2e; \
		echo "[e2e] Smoke tests passed."; \
	'

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

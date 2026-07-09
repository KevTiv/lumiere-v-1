# SpacetimeDB: published database name(s). Override: `make publish STDB_MODULE=my-db`
STDB_MODULE        ?= lumiere-v1-j1uo0
STDB_CLOUD_MODULE  ?= lumiere-v1-j1uo0
# Local SpacetimeDB HTTP base (default maincloud; e2e-smoke overrides to local)
STDB_HOST          ?= https://maincloud.spacetimedb.com
# Local E2E: always use the local SpacetimeDB server (see e2e-smoke target)
E2E_STDB_HOST      ?= http://127.0.0.1:3000
# Local Playwright stack uses its own module name (--no-config) so it is not tied to
# spacetime.local.json / cloud module ownership on 127.0.0.1:3000.
E2E_STDB_MODULE    ?= lumiere-v1-local-e2e
# Local E2E ports. e2e-smoke-test pre-builds Next.js and starts next start; Makefile starts api-server.
E2E_WEB_PORT       ?= 3100
E2E_API_PORT       ?= 8082
# Playwright suite: full (default) or p0 (test:e2e:p0)
E2E_SUITE          ?= full
# Single-spec iteration (e2e-single-test / e2e-single)
E2E_SPEC           ?= mvp-lead-to-cash.spec.ts
E2E_GREP           ?=
E2E_WORKERS        ?= 1
# Some interactive shells in Cursor can inherit a literal "$$PATH"; use a known-good command path for E2E orchestration.
E2E_PATH           ?= /Users/kevintivert/.nvm/versions/node/v21.7.0/bin:/Users/kevintivert/.cargo/bin:/Users/kevintivert/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin

DB         := $(STDB_MODULE)
E2E_DB     := $(E2E_STDB_MODULE)
DB_CLOUD   := $(STDB_CLOUD_MODULE)
E2E_STDB_DATA_DIR ?= $(HOME)/.local/share/spacetime/data
MODULE     := ./spacetimedb
LOCAL      := $(STDB_HOST)
# One reducer per domain test case — avoids WASM limits and yields clearer CI errors.
E2E_DOMAIN_TEST_REDUCERS := \
	run_accounting_post_invoice_test \
	run_accounting_payment_reconcile_test \
	run_accounting_payment_cancel_test \
	run_accounting_payment_term_update_test \
	run_inventory_product_category_test \
	run_inventory_product_update_test \
	run_inventory_stock_inventory_test \
	run_inventory_adjustment_test \
	run_inventory_stock_quant_test \
	run_inventory_receipt_quant_test \
	run_inventory_delivery_quant_test \
	run_sales_order_invoice_test \
	run_sales_order_delivery_test \
	run_sales_order_update_test \
	run_crm_opportunity_convert_test \
	run_crm_contact_update_delete_test \
	run_crm_contact_identity_test \
	run_accounting_payment_management_test \
	run_purchasing_bill_balanced_test \
	run_helpdesk_ticket_test \
	run_hr_leave_type_test \
	run_manufacturing_workcenter_test \
	run_documents_folder_test \
	run_workflow_definition_test \
	run_subscription_plan_test

.PHONY: help setup check check-env check-env-prod build \
        start stop \
        publish publish-clear test \
        publish-cloud publish-cloud-clear \
        call-tests logs \
        call-tests-cloud logs-cloud \
        seed-test-user e2e-smoke e2e-smoke-setup e2e-smoke-test e2e-playwright-only \
        e2e-wipe-local-stdb e2e-single e2e-single-test e2e-p2p e2e-mvp-golden \
        generate-stdb-rust-sdk codegen check-codegen

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "  setup                Install wasm32 target and wasm-opt (one-time)"
	@echo "  check                Run cargo check (fast type-check, no linking)"
	@echo "  check-env            Print STDB_MODULE / STDB_CLOUD_MODULE / STDB_HOST (Makefile defaults)"
	@echo "  check-env-prod       Validate production env vars (exit 1 if required vars missing)"
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
	@echo "  e2e-smoke            Full stack: setup + Playwright (E2E_SUITE=full|p0, default full)"
	@echo "  e2e-smoke-setup      STDB + publish + seed + api-server only (writes .tmp/e2e/env.sh; module=$(E2E_STDB_MODULE))"
	@echo "  e2e-wipe-local-stdb  Stop local SpacetimeDB and delete ~/.local/share/spacetime/data (destructive)"
	@echo "  e2e-smoke-test       Pre-build Next.js, start web, Playwright (requires setup; E2E_SUITE=full|p0)"
	@echo "  e2e-playwright-only  Playwright only when STDB, api-server, and Next.js are already running"
	@echo "  e2e-single           setup + one Playwright spec (E2E_SPEC, E2E_GREP, E2E_WORKERS=1)"
	@echo "  e2e-single-test      one spec only — requires e2e-smoke-setup (rebuilds Next, --workers=1)"
	@echo "  e2e-p2p              Wave 3 gate: procure-to-pay golden path (mvp-procure-to-pay.spec.ts)"
	@echo "  e2e-mvp-golden       Both MVP golden paths (lead-to-cash + procure-to-pay, fresh DB)"
	@echo "  generate-stdb-rust-sdk  Regenerate api-server Rust STDB client bindings (+ keyword fix)"
	@echo "  codegen                 Emit query-registry, sql-columns, erp-org-sql, invalidation"
	@echo "  check-codegen           Fail if generated artifacts drift from sources (CI)"
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
	@bash scripts/check-prod-env.sh

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


generate-stdb-ts-sdk:
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

# Destructive: removes ALL local SpacetimeDB databases (fixes 403 "not authorized to reset database").
e2e-wipe-local-stdb:
	@echo "[e2e] Stopping local SpacetimeDB and removing $(E2E_STDB_DATA_DIR)..."
	spacetime stop >/dev/null 2>&1 || true
	rm -rf "$(E2E_STDB_DATA_DIR)"
	@echo "[e2e] Local SpacetimeDB data wiped. Run make e2e-smoke (or e2e-smoke-setup) to start fresh."

e2e-smoke-setup:
	@env PATH="$(E2E_PATH):$$PATH" /bin/bash -c 'set -euo pipefail; \
		ROOT="$$(pwd)"; \
		LOG_DIR="$$ROOT/.tmp/e2e"; \
		mkdir -p "$$LOG_DIR"; \
		E2E_STDB_HOST="$${E2E_STDB_HOST:-http://127.0.0.1:3000}"; \
		if [ -z "$${STDB_CREDENTIAL_ENCRYPTION_KEY:-}" ]; then \
			STDB_CREDENTIAL_ENCRYPTION_KEY="$$(openssl rand -hex 32)"; \
			export STDB_CREDENTIAL_ENCRYPTION_KEY; \
			echo "[e2e] Generated ephemeral STDB_CREDENTIAL_ENCRYPTION_KEY for this run."; \
		fi; \
		SPACETIME_STARTED=0; \
		API_PID=""; \
		if ! curl -fsS "$$E2E_STDB_HOST/v1/identity" -X POST >/dev/null 2>&1; then \
			echo "[e2e] Starting local SpacetimeDB..."; \
			spacetime start >"$$LOG_DIR/spacetime.log" 2>&1 & \
			SPACETIME_STARTED=1; \
			for i in {1..60}; do \
				if curl -fsS "$$E2E_STDB_HOST/v1/identity" -X POST >/dev/null 2>&1; then break; fi; \
				sleep 1; \
				if [ "$$i" = "60" ]; then \
					echo "[e2e] SpacetimeDB did not become ready. See $$LOG_DIR/spacetime.log"; \
					exit 1; \
				fi; \
			done; \
		else \
			echo "[e2e] Local SpacetimeDB is already reachable at $$E2E_STDB_HOST."; \
		fi; \
		echo "[e2e] Logging in to local SpacetimeDB (database owner for private-table SQL)..."; \
		E2E_STDB_HOST="$$E2E_STDB_HOST" node "$$ROOT/scripts/e2e-local-stdb-token.mjs" --login-only; \
		echo "[e2e] Publishing local database $(E2E_DB) (--no-config)..."; \
		if [ "$${E2E_CLEAR_DB:-0}" = "1" ]; then \
			echo "[e2e] E2E_CLEAR_DB=1: clearing module data (--clear-database)"; \
			LUMIERE_ENABLE_DEV_REDUCERS=1 spacetime publish "$(E2E_DB)" --module-path "$(MODULE)" --server local --clear-database -y --no-config; \
		else \
			echo "[e2e] Preserving existing DB (set E2E_CLEAR_DB=1 to wipe + full re-seed)."; \
			LUMIERE_ENABLE_DEV_REDUCERS=1 spacetime publish "$(E2E_DB)" --module-path "$(MODULE)" --server local -y --no-config; \
		fi; \
		if spacetime call "$(E2E_DB)" run_all_core_tests --server local --no-config; then \
			echo "[e2e] Core reducer tests passed."; \
		else \
			echo "[e2e] run_all_core_tests is unavailable or failed; continuing with browser smoke tests."; \
		fi; \
		echo "[e2e] Running domain test reducers (one case per call)..."; \
		for _domain_reducer in $(E2E_DOMAIN_TEST_REDUCERS); do \
			echo "[e2e] Calling $$_domain_reducer..."; \
			if ! spacetime call "$(E2E_DB)" "$$_domain_reducer" --server local --no-config; then \
				echo "[e2e] $$_domain_reducer failed — tail of SpacetimeDB logs:"; \
				spacetime logs "$(E2E_DB)" --server local --no-config 2>/dev/null | tail -40 || true; \
				exit 1; \
			fi; \
		done; \
		echo "[e2e] Domain reducer tests passed."; \
		echo "[e2e] Obtaining local SpacetimeDB owner token (with private-table SQL preflight)..."; \
		STDB_SERVER_TOKEN="$$(E2E_STDB_HOST="$$E2E_STDB_HOST" STDB_MODULE="$(E2E_DB)" node "$$ROOT/scripts/e2e-local-stdb-token.mjs")"; \
		if [ -z "$$STDB_SERVER_TOKEN" ]; then \
			echo "[e2e] Failed to obtain local SpacetimeDB owner token (see messages above)"; \
			exit 1; \
		fi; \
		E2E_STDB_TOKEN="$$STDB_SERVER_TOKEN"; \
		echo "[e2e] Seeding smoke fixture (seed_dev_data) and browser test user..."; \
		cd "$$ROOT/frontend/web"; \
		STDB_SERVER_TOKEN="$$E2E_STDB_TOKEN" STDB_MODULE="$(E2E_DB)" NEXT_PUBLIC_STDB_MODULE="$(E2E_DB)" STDB_HOST="$$E2E_STDB_HOST" NEXT_PUBLIC_STDB_HOST="$$E2E_STDB_HOST" pnpm run e2e-seed-fixture; \
		set -a; [ ! -f "$$ROOT/frontend/web/.env.local" ] || . "$$ROOT/frontend/web/.env.local"; set +a; \
		STDB_SERVER_TOKEN="$$E2E_STDB_TOKEN" STDB_MODULE="$(E2E_DB)" NEXT_PUBLIC_STDB_MODULE="$(E2E_DB)" STDB_HOST="$$E2E_STDB_HOST" NEXT_PUBLIC_STDB_HOST="$$E2E_STDB_HOST" pnpm run seed-test-user; \
		cd "$$ROOT"; \
		if curl -fsS "http://127.0.0.1:$(E2E_API_PORT)/health" >/dev/null 2>&1; then \
			echo "[e2e] Stopping existing api-server on :$(E2E_API_PORT) for e2e env..."; \
			lsof -ti:"$(E2E_API_PORT)" | xargs kill >/dev/null 2>&1 || true; \
			sleep 1; \
		fi; \
		echo "[e2e] Building api-server (first run may take a few minutes)..."; \
		cargo build -p api-server -q; \
		set -a; [ ! -f "$$ROOT/frontend/web/.env.local" ] || . "$$ROOT/frontend/web/.env.local"; set +a; \
		echo "[e2e] Starting api-server on :$(E2E_API_PORT)..."; \
		LUMIERE_E2E=1 \
		PORT="$(E2E_API_PORT)" \
		STDB_SERVER_TOKEN="$$E2E_STDB_TOKEN" \
		STDB_CREDENTIAL_ENCRYPTION_KEY="$$STDB_CREDENTIAL_ENCRYPTION_KEY" \
		STDB_MODULE="$(E2E_DB)" \
		NEXT_PUBLIC_STDB_MODULE="$(E2E_DB)" \
		STDB_HOST="$$E2E_STDB_HOST" \
		NEXT_PUBLIC_STDB_HOST="$$E2E_STDB_HOST" \
		CORS_ORIGINS="http://127.0.0.1:$(E2E_WEB_PORT),http://localhost:$(E2E_WEB_PORT)" \
		nohup cargo run -p api-server -q >>"$$LOG_DIR/api-server.log" 2>&1 & \
		API_PID="$$!"; \
		disown "$$API_PID" 2>/dev/null || true; \
		for i in {1..180}; do \
			if curl -fsS "http://127.0.0.1:$(E2E_API_PORT)/health" >/dev/null 2>&1; then break; fi; \
			sleep 1; \
			if [ "$$i" = "180" ]; then \
				echo "[e2e] api-server did not become ready. See $$LOG_DIR/api-server.log"; \
				exit 1; \
			fi; \
		done; \
		{ \
			printf "export E2E_STDB_TOKEN=%q\n" "$$E2E_STDB_TOKEN"; \
			printf "export STDB_CREDENTIAL_ENCRYPTION_KEY=%q\n" "$$STDB_CREDENTIAL_ENCRYPTION_KEY"; \
			printf "export E2E_STDB_HOST=%q\n" "$$E2E_STDB_HOST"; \
		} >"$$LOG_DIR/env.sh"; \
		echo "$$API_PID" >"$$LOG_DIR/api-server.pid"; \
		echo "$$SPACETIME_STARTED" >"$$LOG_DIR/spacetime-started"; \
		echo "[e2e] Setup complete (env: $$LOG_DIR/env.sh). Run make e2e-smoke-test or make e2e-playwright-only."; \
	'

e2e-smoke-test:
	@env PATH="$(E2E_PATH):$$PATH" E2E_SUITE="$(E2E_SUITE)" E2E_WORKERS="$(E2E_WORKERS)" /bin/bash -c 'set -euo pipefail; \
		ROOT="$$(pwd)"; \
		LOG_DIR="$$ROOT/.tmp/e2e"; \
		mkdir -p "$$LOG_DIR"; \
		if [ ! -f "$$LOG_DIR/env.sh" ]; then \
			echo "[e2e] Missing $$LOG_DIR/env.sh — run make e2e-smoke-setup first."; \
			exit 1; \
		fi; \
		set -a; . "$$LOG_DIR/env.sh"; set +a; \
		WEB_PID=""; \
		cleanup_web() { \
			if [ -n "$$WEB_PID" ] && kill -0 "$$WEB_PID" >/dev/null 2>&1; then \
				kill "$$WEB_PID" >/dev/null 2>&1 || true; \
				wait "$$WEB_PID" >/dev/null 2>&1 || true; \
			fi; \
		}; \
		trap cleanup_web EXIT INT TERM; \
		if ! curl -fsS "$$E2E_STDB_HOST/v1/identity" -X POST >/dev/null 2>&1; then \
			echo "[e2e] SpacetimeDB is down — run make e2e-smoke-setup first."; \
			exit 1; \
		fi; \
		echo "[e2e] Building api-server..."; \
		cd "$$ROOT"; \
		cargo build -p api-server -q; \
		if curl -fsS "http://127.0.0.1:$(E2E_API_PORT)/health" >/dev/null 2>&1; then \
			echo "[e2e] Restarting api-server on :$(E2E_API_PORT)..."; \
			lsof -ti:"$(E2E_API_PORT)" | xargs kill >/dev/null 2>&1 || true; \
			sleep 1; \
		fi; \
		echo "[e2e] Starting api-server on :$(E2E_API_PORT)..."; \
		set -a; [ ! -f "$$ROOT/frontend/web/.env.local" ] || . "$$ROOT/frontend/web/.env.local"; set +a; \
		LUMIERE_E2E=1 \
		PORT="$(E2E_API_PORT)" \
		STDB_SERVER_TOKEN="$$E2E_STDB_TOKEN" \
		STDB_CREDENTIAL_ENCRYPTION_KEY="$$STDB_CREDENTIAL_ENCRYPTION_KEY" \
		STDB_MODULE="$(E2E_DB)" \
		NEXT_PUBLIC_STDB_MODULE="$(E2E_DB)" \
		STDB_HOST="$$E2E_STDB_HOST" \
		NEXT_PUBLIC_STDB_HOST="$$E2E_STDB_HOST" \
		CORS_ORIGINS="http://127.0.0.1:$(E2E_WEB_PORT),http://localhost:$(E2E_WEB_PORT)" \
		nohup cargo run -p api-server -q >>"$$LOG_DIR/api-server.log" 2>&1 & \
		for i in {1..60}; do \
			if curl -fsS "http://127.0.0.1:$(E2E_API_PORT)/health" >/dev/null 2>&1; then break; fi; \
			sleep 1; \
			if [ "$$i" = "60" ]; then \
				echo "[e2e] api-server did not become ready. See $$LOG_DIR/api-server.log"; \
				exit 1; \
			fi; \
		done; \
		cd "$$ROOT/frontend/web"; \
		if curl -fsS "http://127.0.0.1:$(E2E_WEB_PORT)" >/dev/null 2>&1; then \
			echo "[e2e] Stopping existing Next.js on :$(E2E_WEB_PORT)..."; \
			lsof -ti:"$(E2E_WEB_PORT)" | xargs kill >/dev/null 2>&1 || true; \
			sleep 1; \
		fi; \
		cd "$$ROOT/frontend/web"; \
		set -a; [ ! -f "$$ROOT/frontend/web/.env.local" ] || . "$$ROOT/frontend/web/.env.local"; set +a; \
		echo "[e2e] Building Next.js (once, before Playwright)..."; \
		PORT="" \
		PLAYWRIGHT_PORT="$(E2E_WEB_PORT)" \
		LUMIERE_API_SERVER_URL="http://127.0.0.1:$(E2E_API_PORT)" \
		STDB_SERVER_TOKEN="$$E2E_STDB_TOKEN" \
		STDB_CREDENTIAL_ENCRYPTION_KEY="$$STDB_CREDENTIAL_ENCRYPTION_KEY" \
		STDB_MODULE="$(E2E_DB)" \
		NEXT_PUBLIC_STDB_MODULE="$(E2E_DB)" \
		STDB_HOST="$$E2E_STDB_HOST" \
		NEXT_PUBLIC_STDB_HOST="$$E2E_STDB_HOST" \
		NEXT_PUBLIC_API_GATEWAY_URL="" \
		pnpm exec next build; \
		echo "[e2e] Starting Next.js on :$(E2E_WEB_PORT)..."; \
		PORT="" \
		PLAYWRIGHT_PORT="$(E2E_WEB_PORT)" \
		LUMIERE_API_SERVER_URL="http://127.0.0.1:$(E2E_API_PORT)" \
		STDB_SERVER_TOKEN="$$E2E_STDB_TOKEN" \
		STDB_CREDENTIAL_ENCRYPTION_KEY="$$STDB_CREDENTIAL_ENCRYPTION_KEY" \
		STDB_MODULE="$(E2E_DB)" \
		NEXT_PUBLIC_STDB_MODULE="$(E2E_DB)" \
		STDB_HOST="$$E2E_STDB_HOST" \
		NEXT_PUBLIC_STDB_HOST="$$E2E_STDB_HOST" \
		NEXT_PUBLIC_API_GATEWAY_URL="" \
		pnpm exec next start --hostname 127.0.0.1 --port $(E2E_WEB_PORT) >"$$LOG_DIR/next.log" 2>&1 & \
		WEB_PID="$$!"; \
		for i in {1..120}; do \
			if curl -fsS "http://127.0.0.1:$(E2E_WEB_PORT)" >/dev/null 2>&1; then break; fi; \
			sleep 1; \
			if [ "$$i" = "120" ]; then \
				echo "[e2e] Next.js did not become ready. See $$LOG_DIR/next.log"; \
				exit 1; \
			fi; \
		done; \
		echo "[e2e] Running Playwright ($${E2E_SUITE:-full} suite, workers=$$E2E_WORKERS)..."; \
		pnpm exec playwright install chromium; \
		PW_ARGS=(--workers "$$E2E_WORKERS"); \
		if [ "$${E2E_SUITE:-full}" = "p0" ]; then PW_ARGS+=(--grep @p0 --grep-invert @dev-fixture); fi; \
		PORT="" \
		PLAYWRIGHT_PORT="$(E2E_WEB_PORT)" \
		PLAYWRIGHT_BASE_URL="http://127.0.0.1:$(E2E_WEB_PORT)" \
		LUMIERE_API_SERVER_URL="http://127.0.0.1:$(E2E_API_PORT)" \
		STDB_SERVER_TOKEN="$$E2E_STDB_TOKEN" \
		STDB_CREDENTIAL_ENCRYPTION_KEY="$$STDB_CREDENTIAL_ENCRYPTION_KEY" \
		STDB_MODULE="$(E2E_DB)" \
		NEXT_PUBLIC_STDB_MODULE="$(E2E_DB)" \
		STDB_HOST="$$E2E_STDB_HOST" \
		NEXT_PUBLIC_STDB_HOST="$$E2E_STDB_HOST" \
		NEXT_PUBLIC_API_GATEWAY_URL="" \
		E2E_WORKERS="$$E2E_WORKERS" \
		pnpm exec playwright test "$${PW_ARGS[@]}"; \
		echo "[e2e] Smoke tests passed."; \
	'

e2e-single: e2e-smoke-setup e2e-single-test

# Wave 3 — procure-to-pay UI golden path (see docs/MVP_WORKFLOW_CONTRACT.md secondary path).
e2e-p2p:
	@$(MAKE) e2e-single E2E_SPEC=mvp-procure-to-pay.spec.ts E2E_GREP=

# Full MVP golden-path gate (lead-to-cash then procure-to-pay; reuses one e2e-smoke-setup).
e2e-mvp-golden: e2e-smoke-setup
	@$(MAKE) e2e-single-test E2E_SPEC=mvp-lead-to-cash.spec.ts E2E_GREP="creates CRM"
	@$(MAKE) e2e-single-test E2E_SPEC=mvp-procure-to-pay.spec.ts E2E_GREP=

e2e-single-test:
	@env PATH="$(E2E_PATH):$$PATH" E2E_SPEC="$(E2E_SPEC)" E2E_GREP="$(E2E_GREP)" E2E_WORKERS="$(E2E_WORKERS)" /bin/bash -c 'set -euo pipefail; \
		ROOT="$$(pwd)"; \
		LOG_DIR="$$ROOT/.tmp/e2e"; \
		mkdir -p "$$LOG_DIR"; \
		if [ ! -f "$$LOG_DIR/env.sh" ]; then \
			echo "[e2e] Missing $$LOG_DIR/env.sh — run make e2e-smoke-setup or make e2e-single first."; \
			exit 1; \
		fi; \
		set -a; . "$$LOG_DIR/env.sh"; set +a; \
		WEB_PID=""; \
		cleanup_web() { \
			if [ -n "$$WEB_PID" ] && kill -0 "$$WEB_PID" >/dev/null 2>&1; then \
				kill "$$WEB_PID" >/dev/null 2>&1 || true; \
				wait "$$WEB_PID" >/dev/null 2>&1 || true; \
			fi; \
		}; \
		trap cleanup_web EXIT INT TERM; \
		if ! curl -fsS "$$E2E_STDB_HOST/v1/identity" -X POST >/dev/null 2>&1; then \
			echo "[e2e] SpacetimeDB is down — run make e2e-smoke-setup or make e2e-single first."; \
			exit 1; \
		fi; \
		echo "[e2e] Building api-server..."; \
		cd "$$ROOT"; \
		cargo build -p api-server -q; \
		if curl -fsS "http://127.0.0.1:$(E2E_API_PORT)/health" >/dev/null 2>&1; then \
			echo "[e2e] Restarting api-server on :$(E2E_API_PORT)..."; \
			lsof -ti:"$(E2E_API_PORT)" | xargs kill >/dev/null 2>&1 || true; \
			sleep 1; \
		fi; \
		echo "[e2e] Starting api-server on :$(E2E_API_PORT)..."; \
		set -a; [ ! -f "$$ROOT/frontend/web/.env.local" ] || . "$$ROOT/frontend/web/.env.local"; set +a; \
		LUMIERE_E2E=1 \
		PORT="$(E2E_API_PORT)" \
		STDB_SERVER_TOKEN="$$E2E_STDB_TOKEN" \
		STDB_CREDENTIAL_ENCRYPTION_KEY="$$STDB_CREDENTIAL_ENCRYPTION_KEY" \
		STDB_MODULE="$(E2E_DB)" \
		NEXT_PUBLIC_STDB_MODULE="$(E2E_DB)" \
		STDB_HOST="$$E2E_STDB_HOST" \
		NEXT_PUBLIC_STDB_HOST="$$E2E_STDB_HOST" \
		CORS_ORIGINS="http://127.0.0.1:$(E2E_WEB_PORT),http://localhost:$(E2E_WEB_PORT)" \
		cargo run -p api-server -q >"$$LOG_DIR/api-server.log" 2>&1 & \
		for i in {1..60}; do \
			if curl -fsS "http://127.0.0.1:$(E2E_API_PORT)/health" >/dev/null 2>&1; then break; fi; \
			sleep 1; \
			if [ "$$i" = "60" ]; then \
				echo "[e2e] api-server did not become ready. See $$LOG_DIR/api-server.log"; \
				exit 1; \
			fi; \
		done; \
		cd "$$ROOT/frontend/web"; \
		if curl -fsS "http://127.0.0.1:$(E2E_WEB_PORT)" >/dev/null 2>&1; then \
			echo "[e2e] Stopping existing Next.js on :$(E2E_WEB_PORT)..."; \
			lsof -ti:"$(E2E_WEB_PORT)" | xargs kill >/dev/null 2>&1 || true; \
			sleep 1; \
		fi; \
		cd "$$ROOT/frontend/web"; \
		set -a; [ ! -f "$$ROOT/frontend/web/.env.local" ] || . "$$ROOT/frontend/web/.env.local"; set +a; \
		echo "[e2e] Building Next.js for single-spec run..."; \
		PORT="" \
		PLAYWRIGHT_PORT="$(E2E_WEB_PORT)" \
		LUMIERE_API_SERVER_URL="http://127.0.0.1:$(E2E_API_PORT)" \
		STDB_SERVER_TOKEN="$$E2E_STDB_TOKEN" \
		STDB_CREDENTIAL_ENCRYPTION_KEY="$$STDB_CREDENTIAL_ENCRYPTION_KEY" \
		STDB_MODULE="$(E2E_DB)" \
		NEXT_PUBLIC_STDB_MODULE="$(E2E_DB)" \
		STDB_HOST="$$E2E_STDB_HOST" \
		NEXT_PUBLIC_STDB_HOST="$$E2E_STDB_HOST" \
		NEXT_PUBLIC_API_GATEWAY_URL="" \
		pnpm exec next build; \
		echo "[e2e] Starting Next.js on :$(E2E_WEB_PORT)..."; \
		PORT="" \
		PLAYWRIGHT_PORT="$(E2E_WEB_PORT)" \
		LUMIERE_API_SERVER_URL="http://127.0.0.1:$(E2E_API_PORT)" \
		STDB_SERVER_TOKEN="$$E2E_STDB_TOKEN" \
		STDB_CREDENTIAL_ENCRYPTION_KEY="$$STDB_CREDENTIAL_ENCRYPTION_KEY" \
		STDB_MODULE="$(E2E_DB)" \
		NEXT_PUBLIC_STDB_MODULE="$(E2E_DB)" \
		STDB_HOST="$$E2E_STDB_HOST" \
		NEXT_PUBLIC_STDB_HOST="$$E2E_STDB_HOST" \
		NEXT_PUBLIC_API_GATEWAY_URL="" \
		pnpm exec next start --hostname 127.0.0.1 --port $(E2E_WEB_PORT) >"$$LOG_DIR/next.log" 2>&1 & \
		WEB_PID="$$!"; \
		for i in {1..120}; do \
			if curl -fsS "http://127.0.0.1:$(E2E_WEB_PORT)" >/dev/null 2>&1; then break; fi; \
			sleep 1; \
			if [ "$$i" = "120" ]; then \
				echo "[e2e] Next.js did not become ready. See $$LOG_DIR/next.log"; \
				exit 1; \
			fi; \
		done; \
		PW_ARGS=(tests/e2e/"$$E2E_SPEC" --workers "$$E2E_WORKERS"); \
		if [ -n "$$E2E_GREP" ]; then PW_ARGS+=(--grep "$$E2E_GREP"); fi; \
		echo "[e2e] Running Playwright single spec: $$E2E_SPEC (workers=$$E2E_WORKERS, grep=$${E2E_GREP:-<none>})..."; \
		pnpm exec playwright install chromium; \
		PORT="" \
		PLAYWRIGHT_PORT="$(E2E_WEB_PORT)" \
		PLAYWRIGHT_BASE_URL="http://127.0.0.1:$(E2E_WEB_PORT)" \
		LUMIERE_API_SERVER_URL="http://127.0.0.1:$(E2E_API_PORT)" \
		STDB_SERVER_TOKEN="$$E2E_STDB_TOKEN" \
		STDB_CREDENTIAL_ENCRYPTION_KEY="$$STDB_CREDENTIAL_ENCRYPTION_KEY" \
		STDB_MODULE="$(E2E_DB)" \
		NEXT_PUBLIC_STDB_MODULE="$(E2E_DB)" \
		STDB_HOST="$$E2E_STDB_HOST" \
		NEXT_PUBLIC_STDB_HOST="$$E2E_STDB_HOST" \
		NEXT_PUBLIC_API_GATEWAY_URL="" \
		pnpm exec playwright test "$${PW_ARGS[@]}"; \
		echo "[e2e] Single-spec test passed."; \
	'

e2e-playwright-only:
	@env PATH="$(E2E_PATH):$$PATH" E2E_SUITE="$(E2E_SUITE)" /bin/bash -c 'set -euo pipefail; \
		ROOT="$$(pwd)"; \
		LOG_DIR="$$ROOT/.tmp/e2e"; \
		if [ -f "$$LOG_DIR/env.sh" ]; then set -a; . "$$LOG_DIR/env.sh"; set +a; fi; \
		if ! curl -fsS "http://127.0.0.1:$(E2E_WEB_PORT)" >/dev/null 2>&1; then \
			echo "[e2e] Next.js is not reachable on :$(E2E_WEB_PORT) — start the web stack first."; \
			exit 1; \
		fi; \
		if ! curl -fsS "http://127.0.0.1:$(E2E_API_PORT)/health" >/dev/null 2>&1; then \
			echo "[e2e] api-server is not reachable on :$(E2E_API_PORT)."; \
			exit 1; \
		fi; \
		cd "$$ROOT/frontend/web"; \
		set -a; [ ! -f "$$ROOT/frontend/web/.env.local" ] || . "$$ROOT/frontend/web/.env.local"; set +a; \
		E2E_PNPM_SCRIPT="test:e2e"; \
		if [ "$${E2E_SUITE:-full}" = "p0" ]; then E2E_PNPM_SCRIPT="test:e2e:p0"; fi; \
		echo "[e2e] Running Playwright only ($${E2E_SUITE:-full} suite)..."; \
		PORT="" \
		PLAYWRIGHT_PORT="$(E2E_WEB_PORT)" \
		PLAYWRIGHT_BASE_URL="http://127.0.0.1:$(E2E_WEB_PORT)" \
		LUMIERE_API_SERVER_URL="http://127.0.0.1:$(E2E_API_PORT)" \
		STDB_SERVER_TOKEN="$${E2E_STDB_TOKEN:-}" \
		STDB_CREDENTIAL_ENCRYPTION_KEY="$${STDB_CREDENTIAL_ENCRYPTION_KEY:-}" \
		STDB_MODULE="$(E2E_DB)" \
		NEXT_PUBLIC_STDB_MODULE="$(E2E_DB)" \
		STDB_HOST="$${E2E_STDB_HOST:-http://127.0.0.1:3000}" \
		NEXT_PUBLIC_STDB_HOST="$${E2E_STDB_HOST:-http://127.0.0.1:3000}" \
		NEXT_PUBLIC_API_GATEWAY_URL="" \
		pnpm run "$$E2E_PNPM_SCRIPT"; \
		echo "[e2e] Smoke tests passed."; \
	'

e2e-smoke:
	@env PATH="$(E2E_PATH):$$PATH" E2E_SUITE="$(E2E_SUITE)" E2E_WORKERS="$(E2E_WORKERS)" /bin/bash -c 'set -euo pipefail; \
		ROOT="$$(pwd)"; \
		LOG_DIR="$$ROOT/.tmp/e2e"; \
		mkdir -p "$$LOG_DIR"; \
		E2E_STDB_HOST="$${E2E_STDB_HOST:-http://127.0.0.1:3000}"; \
		if [ -z "$${STDB_CREDENTIAL_ENCRYPTION_KEY:-}" ]; then \
			STDB_CREDENTIAL_ENCRYPTION_KEY="$$(openssl rand -hex 32)"; \
			export STDB_CREDENTIAL_ENCRYPTION_KEY; \
			echo "[e2e] Generated ephemeral STDB_CREDENTIAL_ENCRYPTION_KEY for this run."; \
		fi; \
		SPACETIME_STARTED=0; \
		API_PID=""; \
		WEB_PID=""; \
		cleanup() { \
			if [ -n "$$WEB_PID" ] && kill -0 "$$WEB_PID" >/dev/null 2>&1; then \
				kill "$$WEB_PID" >/dev/null 2>&1 || true; \
				wait "$$WEB_PID" >/dev/null 2>&1 || true; \
			fi; \
			if [ -n "$$API_PID" ] && kill -0 "$$API_PID" >/dev/null 2>&1; then \
				kill "$$API_PID" >/dev/null 2>&1 || true; \
				wait "$$API_PID" >/dev/null 2>&1 || true; \
			fi; \
			if [ "$$SPACETIME_STARTED" = "1" ]; then \
				spacetime stop >/dev/null 2>&1 || true; \
			fi; \
		}; \
		trap cleanup EXIT INT TERM; \
		if ! curl -fsS "$$E2E_STDB_HOST/v1/identity" -X POST >/dev/null 2>&1; then \
			echo "[e2e] Starting local SpacetimeDB..."; \
			spacetime start >"$$LOG_DIR/spacetime.log" 2>&1 & \
			SPACETIME_STARTED=1; \
			for i in {1..60}; do \
				if curl -fsS "$$E2E_STDB_HOST/v1/identity" -X POST >/dev/null 2>&1; then break; fi; \
				sleep 1; \
				if [ "$$i" = "60" ]; then \
					echo "[e2e] SpacetimeDB did not become ready. See $$LOG_DIR/spacetime.log"; \
					exit 1; \
				fi; \
			done; \
		else \
			echo "[e2e] Local SpacetimeDB is already reachable at $$E2E_STDB_HOST."; \
		fi; \
		echo "[e2e] Logging in to local SpacetimeDB (database owner for private-table SQL)..."; \
		E2E_STDB_HOST="$$E2E_STDB_HOST" node "$$ROOT/scripts/e2e-local-stdb-token.mjs" --login-only; \
		echo "[e2e] Publishing local database $(E2E_DB) (--no-config)..."; \
		if [ "$${E2E_CLEAR_DB:-0}" = "1" ]; then \
			echo "[e2e] E2E_CLEAR_DB=1: clearing module data (--clear-database)"; \
			LUMIERE_ENABLE_DEV_REDUCERS=1 spacetime publish "$(E2E_DB)" --module-path "$(MODULE)" --server local --clear-database -y --no-config; \
		else \
			echo "[e2e] Preserving existing DB (set E2E_CLEAR_DB=1 to wipe + full re-seed)."; \
			LUMIERE_ENABLE_DEV_REDUCERS=1 spacetime publish "$(E2E_DB)" --module-path "$(MODULE)" --server local -y --no-config; \
		fi; \
		if spacetime call "$(E2E_DB)" run_all_core_tests --server local --no-config; then \
			echo "[e2e] Core reducer tests passed."; \
		else \
			echo "[e2e] run_all_core_tests is unavailable or failed; continuing with browser smoke tests."; \
		fi; \
		echo "[e2e] Running domain test reducers (one case per call)..."; \
		for _domain_reducer in $(E2E_DOMAIN_TEST_REDUCERS); do \
			echo "[e2e] Calling $$_domain_reducer..."; \
			if ! spacetime call "$(E2E_DB)" "$$_domain_reducer" --server local --no-config; then \
				echo "[e2e] $$_domain_reducer failed — tail of SpacetimeDB logs:"; \
				spacetime logs "$(E2E_DB)" --server local --no-config 2>/dev/null | tail -40 || true; \
				exit 1; \
			fi; \
		done; \
		echo "[e2e] Domain reducer tests passed."; \
		echo "[e2e] Obtaining local SpacetimeDB owner token (with private-table SQL preflight)..."; \
		STDB_SERVER_TOKEN="$$(E2E_STDB_HOST="$$E2E_STDB_HOST" STDB_MODULE="$(E2E_DB)" node "$$ROOT/scripts/e2e-local-stdb-token.mjs")"; \
		if [ -z "$$STDB_SERVER_TOKEN" ]; then \
			echo "[e2e] Failed to obtain local SpacetimeDB owner token (see messages above)"; \
			exit 1; \
		fi; \
		echo "[e2e] Seeding smoke fixture (seed_dev_data) and browser test user..."; \
		cd "$$ROOT/frontend/web"; \
		E2E_STDB_TOKEN="$$STDB_SERVER_TOKEN"; \
		STDB_SERVER_TOKEN="$$E2E_STDB_TOKEN" STDB_MODULE="$(E2E_DB)" NEXT_PUBLIC_STDB_MODULE="$(E2E_DB)" STDB_HOST="$$E2E_STDB_HOST" NEXT_PUBLIC_STDB_HOST="$$E2E_STDB_HOST" pnpm run e2e-seed-fixture; \
		set -a; [ ! -f "$$ROOT/frontend/web/.env.local" ] || . "$$ROOT/frontend/web/.env.local"; set +a; \
		STDB_SERVER_TOKEN="$$E2E_STDB_TOKEN" STDB_MODULE="$(E2E_DB)" NEXT_PUBLIC_STDB_MODULE="$(E2E_DB)" STDB_HOST="$$E2E_STDB_HOST" NEXT_PUBLIC_STDB_HOST="$$E2E_STDB_HOST" pnpm run seed-test-user; \
		cd "$$ROOT"; \
		if curl -fsS "http://127.0.0.1:$(E2E_API_PORT)/health" >/dev/null 2>&1; then \
			echo "[e2e] Stopping existing api-server on :$(E2E_API_PORT) for e2e env..."; \
			lsof -ti:"$(E2E_API_PORT)" | xargs kill >/dev/null 2>&1 || true; \
			sleep 1; \
		fi; \
		echo "[e2e] Building api-server (first run may take a few minutes)..."; \
		cargo build -p api-server -q; \
		set -a; [ ! -f "$$ROOT/frontend/web/.env.local" ] || . "$$ROOT/frontend/web/.env.local"; set +a; \
		echo "[e2e] Starting api-server on :$(E2E_API_PORT)..."; \
		LUMIERE_E2E=1 \
		PORT="$(E2E_API_PORT)" \
		STDB_SERVER_TOKEN="$$E2E_STDB_TOKEN" \
		STDB_CREDENTIAL_ENCRYPTION_KEY="$$STDB_CREDENTIAL_ENCRYPTION_KEY" \
		STDB_MODULE="$(E2E_DB)" \
		NEXT_PUBLIC_STDB_MODULE="$(E2E_DB)" \
		STDB_HOST="$$E2E_STDB_HOST" \
		NEXT_PUBLIC_STDB_HOST="$$E2E_STDB_HOST" \
		CORS_ORIGINS="http://127.0.0.1:$(E2E_WEB_PORT),http://localhost:$(E2E_WEB_PORT)" \
		cargo run -p api-server -q >"$$LOG_DIR/api-server.log" 2>&1 & \
		API_PID="$$!"; \
		for i in {1..180}; do \
			if curl -fsS "http://127.0.0.1:$(E2E_API_PORT)/health" >/dev/null 2>&1; then break; fi; \
			sleep 1; \
			if [ "$$i" = "180" ]; then \
				echo "[e2e] api-server did not become ready. See $$LOG_DIR/api-server.log"; \
				exit 1; \
			fi; \
		done; \
		if curl -fsS "http://127.0.0.1:$(E2E_WEB_PORT)" >/dev/null 2>&1; then \
			echo "[e2e] Stopping existing Next.js on :$(E2E_WEB_PORT)..."; \
			lsof -ti:"$(E2E_WEB_PORT)" | xargs kill >/dev/null 2>&1 || true; \
			sleep 1; \
		fi; \
		cd "$$ROOT/frontend/web"; \
		echo "[e2e] Building Next.js (once, before Playwright)..."; \
		PORT="" \
		PLAYWRIGHT_PORT="$(E2E_WEB_PORT)" \
		LUMIERE_API_SERVER_URL="http://127.0.0.1:$(E2E_API_PORT)" \
		STDB_SERVER_TOKEN="$$E2E_STDB_TOKEN" \
		STDB_CREDENTIAL_ENCRYPTION_KEY="$$STDB_CREDENTIAL_ENCRYPTION_KEY" \
		STDB_MODULE="$(E2E_DB)" \
		NEXT_PUBLIC_STDB_MODULE="$(E2E_DB)" \
		STDB_HOST="$$E2E_STDB_HOST" \
		NEXT_PUBLIC_STDB_HOST="$$E2E_STDB_HOST" \
		NEXT_PUBLIC_API_GATEWAY_URL="" \
		pnpm exec next build; \
		echo "[e2e] Starting Next.js on :$(E2E_WEB_PORT)..."; \
		PORT="" \
		PLAYWRIGHT_PORT="$(E2E_WEB_PORT)" \
		LUMIERE_API_SERVER_URL="http://127.0.0.1:$(E2E_API_PORT)" \
		STDB_SERVER_TOKEN="$$E2E_STDB_TOKEN" \
		STDB_CREDENTIAL_ENCRYPTION_KEY="$$STDB_CREDENTIAL_ENCRYPTION_KEY" \
		STDB_MODULE="$(E2E_DB)" \
		NEXT_PUBLIC_STDB_MODULE="$(E2E_DB)" \
		STDB_HOST="$$E2E_STDB_HOST" \
		NEXT_PUBLIC_STDB_HOST="$$E2E_STDB_HOST" \
		NEXT_PUBLIC_API_GATEWAY_URL="" \
		pnpm exec next start --hostname 127.0.0.1 --port $(E2E_WEB_PORT) >"$$LOG_DIR/next.log" 2>&1 & \
		WEB_PID="$$!"; \
		for i in {1..120}; do \
			if curl -fsS "http://127.0.0.1:$(E2E_WEB_PORT)" >/dev/null 2>&1; then break; fi; \
			sleep 1; \
			if [ "$$i" = "120" ]; then \
				echo "[e2e] Next.js did not become ready. See $$LOG_DIR/next.log"; \
				exit 1; \
			fi; \
		done; \
		echo "[e2e] Running Playwright ($${E2E_SUITE:-full} suite, workers=$$E2E_WORKERS)..."; \
		pnpm exec playwright install chromium; \
		PW_ARGS=(--workers "$$E2E_WORKERS"); \
		if [ "$${E2E_SUITE:-full}" = "p0" ]; then PW_ARGS+=(--grep @p0 --grep-invert @dev-fixture); fi; \
		PORT="" \
		PLAYWRIGHT_PORT="$(E2E_WEB_PORT)" \
		PLAYWRIGHT_BASE_URL="http://127.0.0.1:$(E2E_WEB_PORT)" \
		LUMIERE_API_SERVER_URL="http://127.0.0.1:$(E2E_API_PORT)" \
		STDB_SERVER_TOKEN="$$E2E_STDB_TOKEN" \
		STDB_CREDENTIAL_ENCRYPTION_KEY="$$STDB_CREDENTIAL_ENCRYPTION_KEY" \
		STDB_MODULE="$(E2E_DB)" \
		NEXT_PUBLIC_STDB_MODULE="$(E2E_DB)" \
		STDB_HOST="$$E2E_STDB_HOST" \
		NEXT_PUBLIC_STDB_HOST="$$E2E_STDB_HOST" \
		NEXT_PUBLIC_API_GATEWAY_URL="" \
		E2E_WORKERS="$$E2E_WORKERS" \
		pnpm exec playwright test "$${PW_ARGS[@]}"; \
		echo "[e2e] Smoke tests passed."; \
	'

# --- API ----------------------------------------------------------------------
generate-stdb-rust-sdk:
	spacetime generate --lang rust --out-dir "api-server/src/stdb_sdk_bindings" --module-path $(MODULE)
	bash scripts/fix-spacetimedb-rust-sdk-bindings.sh

codegen:
	cargo run -p lumiere-codegen

check-codegen: codegen
	@git add -N \
		frontend/packages/stdb/src/generated/query-registry.ts \
		frontend/packages/query-hooks/src/generated/stdb-reducer-invalidation.ts \
		frontend/packages/stdb/src/stdb-generated-sql-columns.json \
		frontend/packages/stdb/src/query-resource-row-type.json \
		crates/stdb-auth/assets/stdb-generated-sql-columns.json \
		crates/stdb-auth/assets/erp-org-sql.json \
		crates/stdb-auth/assets/resource_registry.json \
		crates/stdb-auth/assets/query_exec_non_registry.json \
		2>/dev/null || true
	@git diff --exit-code -- \
		frontend/packages/stdb/src/generated/query-registry.ts \
		frontend/packages/query-hooks/src/generated/stdb-reducer-invalidation.ts \
		frontend/packages/stdb/src/stdb-generated-sql-columns.json \
		frontend/packages/stdb/src/query-resource-row-type.json \
		crates/stdb-auth/assets/stdb-generated-sql-columns.json \
		crates/stdb-auth/assets/erp-org-sql.json \
		crates/stdb-auth/assets/resource_registry.json \
		crates/stdb-auth/assets/query_exec_non_registry.json || \
		(echo "Generated artifacts are out of date. Run: make generate-stdb-ts-sdk && make codegen" && exit 1)

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

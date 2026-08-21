# Lumiere developer command surface.
#
# Prefer the scoped targets listed by `make help` (for example `local-publish`
# and `stack-up`). The older short targets remain as compatibility aliases for
# existing docs and CI. Override configuration at invocation time, e.g.:
#   make local-publish STDB_MODULE=my-local-db
#   make e2e-single E2E_SPEC=import-rollback.spec.ts

.DEFAULT_GOAL := help
SHELL := /bin/bash

# ── Configuration ────────────────────────────────────────────────────────────

# SpacetimeDB: published database name(s). Override: `make local-publish STDB_MODULE=my-db`
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
	run_accounting_payment_multi_invoice_residual_test \
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
	run_sales_ghost_product_fail_closed_test \
	run_crm_opportunity_convert_test \
	run_proposals_convert_integrity_test \
	run_crm_contact_update_delete_test \
	run_crm_contact_identity_test \
	run_accounting_payment_management_test \
	run_core_operational_messaging_test \
	run_core_sod_test \
	run_queue_foundation_tests \
	run_tenant_isolation_tests \
	run_country_pack_test \
	run_accounting_ic_consolidation_test \
	run_accounting_fx_revaluation_test \
	run_purchasing_bill_balanced_test \
	run_purchasing_lot_receive_test \
	run_helpdesk_ticket_test \
	run_hr_leave_type_test \
	run_hr_wave_a_test \
	run_all_hr_tests \
	run_manufacturing_workcenter_test \
	run_documents_folder_test \
	run_documents_wave_a_tests \
	run_documents_wave_b_tests \
	run_documents_wave_c_tests \
	run_documents_wave_d_tests \
	run_workflow_definition_test \
	run_all_workflow_foundation_tests \
	run_all_workflow_deterministic_core_tests \
	run_workflow_evaluator_simulation_tests \
	run_workflow_runtime_tests \
	run_workflow_authorization_tests \
	run_workflow_human_task_tests \
	run_workflow_action_registry_tests \
	run_workflow_delivery_tests \
	run_all_workflow_human_effect_tests \
	run_subscription_plan_test

.PHONY: \
	help help-e2e \
	setup check check-env check-env-prod build validate-subscriptions \
	start stop publish publish-clear test call-tests logs seed-test-user \
	generate-stdb-ts-sdk generate-stdb-rust-sdk schema-snapshot \
	e2e-smoke e2e-smoke-setup e2e-smoke-test e2e-playwright-only \
	e2e-wipe-local-stdb e2e-single e2e-single-test e2e-p2p e2e-mvp-golden \
	e2e-crm-isolation \
	init-stack docker-dev docker-dev-iot \
	codegen check-codegen check-contract-ir check-reducer-contracts-drift lint-reducer-call-literals api-server-run \
	lint-no-magic-fk-zero lint-accounting-as-unknown-as lint-accounting-currency-refs \
	publish-cloud publish-cloud-clear call-tests-cloud logs-cloud \
	module-check module-build module-generate-ts module-generate-rust \
	local-start local-stop local-publish local-reset local-test local-logs \
	stack-init stack-up stack-up-iot stack-down \
	codegen-all codegen-check api-run \
	cloud-publish cloud-reset cloud-test cloud-logs

help-legacy:
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
	@echo "  init-stack              Create .env.docker, publish the local module, and configure service tokens"
	@echo "  docker-dev              Start the OrbStack local development stack (.env.docker required)"
	@echo "  docker-dev-iot          Start the OrbStack stack with the optional IoT gateway"
	@echo "  contracts-staging-from-pinned  Populate .contracts-staging/ from the pinned lumiere-contracts tag (no spacetime CLI needed; use before codegen/check-codegen/cargo build if you haven't run generate-stdb-rust-sdk)"
	@echo "  schema-snapshot        Fetch the published module schema into .contracts-staging/module-schema.json over CI-safe HTTP"
	@echo "  codegen                 Extract canonical contract IR plus local runtime/audit artifacts"
	@echo "  check-codegen           Fail if generated artifacts drift from sources (CI). Requires .contracts-staging/ (see contracts-staging-from-pinned)"
	@echo "  check-contract-ir       Validate the versioned IR envelope and both SHA-256 hashes"
	@echo "  check-reducer-contracts-drift  CI-safe live-schema drift check for reducer-manifest.json"
	@echo "  check-contracts-drift   Full bindings/manifests drift check (requires spacetime CLI)"
	@echo "  publish-contracts VERSION=x.y.z  Transitional release: publish canonical IR plus current generated packages"
	@echo ""
	@echo "  --- Cloud ---"
	@echo "  publish-cloud        Publish to maincloud"
	@echo "  publish-cloud-clear  Clear cloud DB and republish (destructive!)"
	@echo "  call-tests-cloud     Call run_all_core_tests on cloud"
	@echo "  logs-cloud           Tail logs from cloud"

define print-command
	@printf "  %-24s %s\n" "$(1)" "$(2)"
endef

help:
	@printf "Usage: make <target> [VARIABLE=value]\n\n"
	@printf "Setup and diagnostics\n"
	$(call print-command,setup,Install the stable WASM target and wasm-opt.)
	$(call print-command,check-env,Print the resolved SpacetimeDB module and host variables.)
	$(call print-command,api-run,Run only the Rust API using api-server/.env.local.)
	@printf "\n"
	@printf "Module and local SpacetimeDB\n"
	$(call print-command,module-check,Fast Rust type-check for the SpacetimeDB module.)
	$(call print-command,module-build,Build the release WASM module.)
	$(call print-command,local-start,Start the local SpacetimeDB server on port 3000.)
	$(call print-command,local-stop,Stop the local SpacetimeDB server.)
	$(call print-command,local-publish,Publish the module to the local server; preserves data.)
	$(call print-command,local-reset,DESTRUCTIVE: clear the local database and republish.)
	$(call print-command,local-test,Clear then republish and run core reducer tests.)
	$(call print-command,local-logs,Tail logs for the local module.)
	$(call print-command,seed-test-user,Seed the browser test user after fixture seeding.)
	@printf "\nCode generation\n"
	$(call print-command,module-generate-ts,Regenerate TypeScript client bindings from the module.)
	$(call print-command,module-generate-rust,Regenerate Rust API-server bindings and apply keyword fixes.)
	$(call print-command,codegen-all,Regenerate query registry and SQL metadata.)
	$(call print-command,codegen-check,Fail when generated artifacts have drifted.)
	@printf "\nDocker / OrbStack\n"
	$(call print-command,stack-init,Create .env.docker then publish local SpacetimeDB and configure tokens.)
	$(call print-command,stack-up,Start the development stack.)
	$(call print-command,stack-up-iot,Start the development stack with the optional IoT gateway.)
	$(call print-command,stack-down,Stop the development stack; preserves volumes.)
	@printf "\nEnd-to-end testing\n"
	$(call print-command,help-e2e,Show E2E commands and their important inputs.)
	@printf "\nCloud / production\n"
	$(call print-command,check-env-prod,Validate required production environment variables.)
	$(call print-command,cloud-publish,Publish to SpacetimeDB Maincloud.)
	$(call print-command,cloud-reset,DESTRUCTIVE: clear the Maincloud database and republish.)
	$(call print-command,cloud-test,Run core reducer tests against Maincloud.)
	$(call print-command,cloud-logs,Tail Maincloud module logs.)
	@printf "\nCompatibility aliases: check, build, start, stop, publish, publish-clear, test, logs,\n"
	@printf "generate-stdb-ts-sdk, generate-stdb-rust-sdk, init-stack, docker-dev, and publish-cloud.\n"

help-e2e:
	@printf "E2E commands (all use local SpacetimeDB and write logs under .tmp/e2e):\n"
	$(call print-command,e2e-smoke,Full setup and Playwright run; E2E_SUITE=full|p0.)
	$(call print-command,e2e-smoke-setup,Database publish plus reducer checks fixture seed and API only.)
	$(call print-command,e2e-smoke-test,Build web and run Playwright; requires e2e-smoke-setup.)
	$(call print-command,e2e-playwright-only,Run Playwright against already-running services.)
	$(call print-command,e2e-single,Setup plus one spec; E2E_SPEC=<file> and E2E_GREP=<pattern>.)
	$(call print-command,e2e-single-test,One spec against an existing E2E setup.)
	$(call print-command,e2e-p2p,Procure-to-pay golden-path spec.)
	$(call print-command,e2e-mvp-golden,Lead-to-cash and procure-to-pay gates.)
	$(call print-command,e2e-crm-isolation,Fresh live CRM organization/company read-isolation gate.)
	$(call print-command,e2e-wipe-local-stdb,DESTRUCTIVE: delete all local SpacetimeDB data.)
	@printf "\nUseful inputs: E2E_CLEAR_DB=1, E2E_SUITE=p0, E2E_SPEC=<file>, E2E_GREP=<pattern>.\n"

# ── Module build and environment checks ──────────────────────────────────────

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

validate-subscriptions:
	node scripts/validate-subscription-org-filters.mjs

build:
	cd $(MODULE) && cargo build --target wasm32-unknown-unknown --release

# ── Local ─────────────────────────────────────────────────────────────────────

start:
	spacetime start

stop:
	spacetime stop

publish:
	sudo LUMIERE_ENABLE_DEV_REDUCERS=1 spacetime publish $(DB) --module-path $(MODULE) --server local -y


generate-stdb-ts-sdk:
	spacetime generate --include-private --lang typescript --out-dir ".contracts-staging/ts/generated" --module-path $(MODULE)

publish-clear:
	LUMIERE_ENABLE_DEV_REDUCERS=1 spacetime publish $(DB) --module-path $(MODULE) --server local --clear-database -y

# A test target must terminate. Use `local-logs` separately when diagnosis is
# needed; `logs` intentionally tails forever.
test: publish-clear call-tests

call-tests:
	spacetime call $(DB) run_all_core_tests --server local

logs:
	spacetime logs $(DB) --server local

seed-test-user:
	cd frontend/web && pnpm run seed-test-user

# ── End-to-end integration workflows ─────────────────────────────────────────
#
# These recipes intentionally keep their orchestration in one Bash process so
# setup state, temporary credentials, and cleanup traps remain scoped to the
# command that created them. See `make help-e2e` for entry points and inputs.

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
			nohup spacetime start --listen-addr 127.0.0.1:3000 >"$$LOG_DIR/spacetime.log" 2>&1 & \
			disown $$! 2>/dev/null || true; \
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

# Phase 2 CRM authorization gate: ephemeral tenants, persisted rows, HTTP reads, and WS subscriptions.
e2e-crm-isolation:
	@$(MAKE) e2e-single E2E_CLEAR_DB=1 E2E_SPEC=crm-read-isolation.spec.ts E2E_GREP= E2E_WORKERS=1

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
			nohup spacetime start --listen-addr 127.0.0.1:3000 >"$$LOG_DIR/spacetime.log" 2>&1 & \
			disown $$! 2>/dev/null || true; \
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

# ── Bindings, code generation, and service entry points ───────────────────────
generate-stdb-rust-sdk:
	bash scripts/generate-spacetimedb-rust-sdk.sh ".contracts-staging/bindings" "$(MODULE)"

schema-snapshot:
	STDB_MODULE="$(STDB_MODULE)" bash scripts/schema-snapshot.sh

init-stack:
	STDB_MODULE="$(STDB_MODULE)" bash scripts/init-stack.sh

docker-dev:
	docker compose --env-file .env.docker -f docker-compose.dev.yml up --build

docker-dev-iot:
	docker compose --env-file .env.docker -f docker-compose.dev.yml --profile iot up --build

codegen: schema-snapshot
	cargo run -p lumiere-codegen

check-contract-ir: codegen
	python3 scripts/verify-contract-ir.py .contracts-staging/ir/lumiere-contract-ir-v1.json

check-codegen: codegen check-contract-ir lint-reducer-call-literals
	@git add -N \
		frontend/packages/stdb/src/query-resource-row-type.json \
		frontend/packages/stdb/src/commands/generated-stdb-bff-reducers.ts \
		crates/stdb-client/src/generated_reducer_contract.rs \
		crates/stdb-auth/assets/resource_registry.json \
		crates/stdb-auth/assets/query_exec_non_registry.json \
		api-server/src/generated/pg_ddl/ \
		2>/dev/null || true
	@git diff --exit-code -- \
		frontend/packages/stdb/src/query-resource-row-type.json \
		frontend/packages/stdb/src/commands/generated-stdb-bff-reducers.ts \
		crates/stdb-client/src/generated_reducer_contract.rs \
		crates/stdb-auth/assets/resource_registry.json \
		crates/stdb-auth/assets/query_exec_non_registry.json \
		api-server/src/generated/pg_ddl/ || \
		(echo "Generated artifacts are out of date. Run: make generate-stdb-ts-sdk && make codegen" && exit 1)

# Populates .contracts-staging/{bindings,manifests} from the currently
# pinned lumiere-contracts git dependency instead of a live `spacetime
# generate` run. Use this when the schema hasn't changed and you just need
# .contracts-staging present to build/check/test (e.g. in CI, which has no
# `spacetime` CLI). Requires `cargo fetch` (or any prior cargo invocation)
# to have already resolved the dependency.
contracts-staging-from-pinned:
	@cargo fetch --quiet
	@CHECKOUT="$$(bash scripts/resolve-pinned-contracts.sh)"; \
	if [ -z "$$CHECKOUT" ] || [ ! -d "$$CHECKOUT/crates/lumiere-contracts/src/bindings" ]; then \
		echo "contracts-staging-from-pinned: could not resolve the pinned lumiere-contracts checkout" >&2; \
		exit 1; \
	fi; \
	if [ ! -d "$$CHECKOUT/packages/contracts/src/generated" ]; then \
		echo "contracts-staging-from-pinned: $$CHECKOUT/packages/contracts/src/generated missing — pinned tag predates the TS package" >&2; \
		exit 1; \
	fi; \
	rm -rf .contracts-staging; \
	mkdir -p .contracts-staging/bindings .contracts-staging/manifests .contracts-staging/ts/generated .contracts-staging/ir; \
	cp -R "$$CHECKOUT/crates/lumiere-contracts/src/bindings/." .contracts-staging/bindings/; \
	cp "$$CHECKOUT/manifests/"*.json .contracts-staging/manifests/; \
	if [ -d "$$CHECKOUT/ir" ]; then cp -R "$$CHECKOUT/ir/." .contracts-staging/ir/; fi; \
	cp -R "$$CHECKOUT/packages/contracts/src/generated/." .contracts-staging/ts/generated/; \
	cp "$$CHECKOUT/packages/contracts/src/stdb-generated-sql-columns.json" .contracts-staging/ts/; \
	cp "$$CHECKOUT/packages/contracts/src/stdb-reducer-invalidation.ts" .contracts-staging/ts/; \
	STDB_MODULE="$(STDB_MODULE)" bash scripts/schema-snapshot.sh; \
	echo "contracts-staging-from-pinned: populated .contracts-staging/ from $$CHECKOUT"

# CI-safe reducer drift check. Unlike full bindings drift, schema retrieval is
# plain HTTP and does not require the SpacetimeDB CLI.
check-reducer-contracts-drift: schema-snapshot codegen
	@CHECKOUT="$$(bash scripts/resolve-pinned-contracts.sh)"; \
	if [ ! -f "$$CHECKOUT/manifests/reducer-manifest.json" ]; then \
		echo "check-reducer-contracts-drift: pinned contracts predate reducer-manifest.json; publish v0.3.0" >&2; \
		exit 1; \
	fi; \
	diff "$$CHECKOUT/manifests/reducer-manifest.json" .contracts-staging/manifests/reducer-manifest.json

# Bindings + the seven generated manifests now live in lumiere-contracts, not in
# this repo. This target regenerates them into .contracts-staging/ from the
# live SpacetimeDB module and diffs that staging output against the
# currently pinned lumiere-contracts tag, so drift between the deployed STDB
# module and the pinned contracts release is caught locally instead of only
# surfacing at runtime. Requires the `spacetime` CLI (not available in CI —
# see `contracts-staging-from-pinned` for the CI-safe path). See
# docs/plans/contracts-extraction-execution-plan.md §5.2, §5.4.
check-contracts-drift: schema-snapshot generate-stdb-rust-sdk generate-stdb-ts-sdk codegen check-contract-ir
	@CHECKOUT="$$(bash scripts/resolve-pinned-contracts.sh)"; \
	if [ -z "$$CHECKOUT" ] || [ ! -d "$$CHECKOUT/crates/lumiere-contracts/src/bindings" ]; then \
		echo "check-contracts-drift: could not resolve the pinned lumiere-contracts checkout (run cargo fetch first); skipping" >&2; \
		exit 0; \
	fi; \
	diff -rq "$$CHECKOUT/crates/lumiere-contracts/src/bindings" .contracts-staging/bindings && \
	diff -rq "$$CHECKOUT/manifests" .contracts-staging/manifests && \
	diff -rq "$$CHECKOUT/packages/contracts/src/generated" .contracts-staging/ts/generated && \
	diff "$$CHECKOUT/packages/contracts/src/stdb-generated-sql-columns.json" .contracts-staging/ts/stdb-generated-sql-columns.json && \
	diff "$$CHECKOUT/packages/contracts/src/stdb-reducer-invalidation.ts" .contracts-staging/ts/stdb-reducer-invalidation.ts && \
	echo "check-contracts-drift: staging matches pinned lumiere-contracts release" || \
	(echo "Local generation drifted from the pinned lumiere-contracts tag. Run: make publish-contracts VERSION=x.y.z" && exit 1)

# Publish freshly generated bindings + manifests to lumiere-contracts as a new
# tagged release, then print the Cargo.toml dependency line to bump.
publish-contracts: schema-snapshot generate-stdb-rust-sdk generate-stdb-ts-sdk codegen
	@if [ -z "$(VERSION)" ]; then echo "usage: make publish-contracts VERSION=x.y.z" >&2; exit 1; fi
	bash scripts/publish-contracts.sh "$(VERSION)"

# Fail if coverage/create-params mappers use magic FK sentinels (`?? 0n` / `|| 0n`).
lint-no-magic-fk-zero:
	bash scripts/lint-no-magic-fk-zero.sh

lint-reducer-call-literals:
	bash scripts/lint-reducer-call-literals.sh

# ACC-RI-018: retained accounting double assertions require an adjacent rationale.
lint-accounting-as-unknown-as:
	bash scripts/lint-accounting-as-unknown-as.sh

# Canonical currencies must use persisted IDs, never bridge tables or magic ID 1.
lint-accounting-currency-refs:
	bash scripts/lint-canonical-currency.sh

# Starts only the Rust API with its service-local environment file.
api-server-run:
	source api-server/.env.local && cargo run -p api-server

# ── Cloud / production SpacetimeDB ───────────────────────────────────────────

publish-cloud:
	spacetime publish $(DB_CLOUD) --module-path $(MODULE) --server maincloud

publish-cloud-clear:
	spacetime publish $(DB_CLOUD) --module-path $(MODULE) --server maincloud --clear-database -y

call-tests-cloud:
	spacetime call $(DB_CLOUD) run_all_core_tests --server maincloud

logs-cloud:
	spacetime logs $(DB_CLOUD) --server maincloud

# ── Scoped command names ─────────────────────────────────────────────────────
#
# Keep the original short names above for compatibility. New work should use
# these names: each makes the target's subsystem and side effect explicit.

module-check: check
module-build: build
module-generate-ts: generate-stdb-ts-sdk
module-generate-rust: generate-stdb-rust-sdk

local-start: start
local-stop: stop
local-publish: publish
local-reset: publish-clear
local-test: test
local-logs: logs

stack-init: init-stack
stack-up: docker-dev
stack-up-iot: docker-dev-iot
stack-down:
	docker compose --env-file .env.docker -f docker-compose.dev.yml down

codegen-all: codegen
codegen-check: check-codegen
api-run: api-server-run

cloud-publish: publish-cloud
cloud-reset: publish-cloud-clear
cloud-test: call-tests-cloud
cloud-logs: logs-cloud

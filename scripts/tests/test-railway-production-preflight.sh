#!/usr/bin/env bash
set -Eeuo pipefail

readonly ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
readonly MANIFEST="$ROOT/infra/railway/production-eu-services.json"
readonly TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

jq '[
  .services[]
  | select(.name != "ai-gateway")
  | {
      id: ("service-" + .name),
      name,
      regions: [{name: "europe-west4-drams3a", configured: 1}]
    }
]' "$MANIFEST" >"$TMP/services.json"

for domain in expense hr project; do
  upper="${domain^^}"
  case "$domain" in
    expense) port=8092 ;;
    hr) port=8094 ;;
    project) port=8093 ;;
  esac
  jq -n \
    --arg binary "$domain-integration-worker" \
    --arg token "STDB_${upper}_WORKER_TOKEN" \
    --arg orgs "LUMIERE_${upper}_WORKER_ORG_IDS" \
    --arg port_name "LUMIERE_${upper}_WORKER_PORT" \
    --arg port "$port" \
    '{
      LUMIERE_BIN: $binary,
      LUMIERE_ENV: "production",
      STDB_HOST: "http://spacetimedb.railway.internal:3000",
      STDB_MODULE: "lumiere-v1",
      ($token): null,
      ($orgs): "101,202",
      ($port_name): $port,
      LUMIERE_PLACEMENT_GENERATION: "1",
      LUMIERE_CELL_ID: "production-eu-primary",
      LUMIERE_DURABLE_STORE_ID: "production-postgres-primary",
      AI_GATEWAY_URL: "http://ai-gateway.railway.internal:8080"
    }' >"$TMP/$domain-integration-worker.variables.json"
done

cat >"$TMP/railway" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
case "${1:-} ${2:-}" in
  "service list")
    cat "$TEST_SERVICES_FILE"
    ;;
  "variable list")
    service=""
    while (( $# > 0 )); do
      if [[ "$1" == --service ]]; then
        service="$2"
        break
      fi
      shift
    done
    cat "$TEST_VARIABLES_DIR/$service.variables.json"
    ;;
  *)
    echo "unexpected railway invocation: $*" >&2
    exit 90
    ;;
esac
SH
chmod +x "$TMP/railway"

common_env=(
  "PATH=$TMP:$PATH"
  "RAILWAY_PROJECT_ID=cc695d4b-030c-43e3-bbd6-a41095b09257"
  "RAILWAY_ENVIRONMENT=production"
  "RAILWAY_EXPECTED_REGION=europe-west4-drams3a"
  "RAILWAY_ENABLE_INTEGRATIONS=true"
  "TEST_SERVICES_FILE=$TMP/services.json"
  "TEST_VARIABLES_DIR=$TMP"
)

env "${common_env[@]}" bash "$ROOT/scripts/railway-production-preflight.sh" "$MANIFEST"

# An empty production database has no tenant IDs to configure. The initial ERP
# release may omit integration workers until onboarding and identity binding.
jq 'map(select(.name | endswith("-integration-worker") | not))' \
  "$TMP/services.json" >"$TMP/initial-services.json"
env "${common_env[@]}" RAILWAY_ENABLE_INTEGRATIONS=false \
  TEST_SERVICES_FILE="$TMP/initial-services.json" \
  bash "$ROOT/scripts/railway-production-preflight.sh" "$MANIFEST"

# A disabled optional service must not gate ERP even if its existing deployment
# has no active EU replica. Enabling the feature makes the same service strict.
jq '. + [{
  id: "service-ai-gateway",
  name: "ai-gateway",
  regions: [{name: "us-west2", configured: 0}]
}]' "$TMP/services.json" >"$TMP/services-disabled-ai.json"
env "${common_env[@]}" TEST_SERVICES_FILE="$TMP/services-disabled-ai.json" \
  bash "$ROOT/scripts/railway-production-preflight.sh" "$MANIFEST"
if env "${common_env[@]}" TEST_SERVICES_FILE="$TMP/services-disabled-ai.json" \
  RAILWAY_ENABLE_AI=true \
  bash "$ROOT/scripts/railway-production-preflight.sh" "$MANIFEST" >"$TMP/ai-region.out" 2>&1; then
  echo "production preflight accepted enabled AI without an active EU replica" >&2
  exit 1
fi
grep -Fq 'ai-gateway has no active EU replica' "$TMP/ai-region.out"

if env "${common_env[@]}" RAILWAY_ENABLE_AI=true \
  bash "$ROOT/scripts/railway-production-preflight.sh" "$MANIFEST" >"$TMP/ai.out" 2>&1; then
  echo "production preflight accepted a missing enabled AI service" >&2
  exit 1
fi
grep -Fq 'missing or ambiguous production service: ai-gateway' "$TMP/ai.out"

jq 'map(select(.name != "hr-integration-worker"))' \
  "$TMP/services.json" >"$TMP/services-missing.json"
if env "${common_env[@]}" TEST_SERVICES_FILE="$TMP/services-missing.json" \
  bash "$ROOT/scripts/railway-production-preflight.sh" "$MANIFEST" >"$TMP/missing.out" 2>&1; then
  echo "production preflight accepted a missing required service" >&2
  exit 1
fi
grep -Fq 'missing or ambiguous production service: hr-integration-worker' "$TMP/missing.out"

jq '.LUMIERE_PROJECT_WORKER_ORG_IDS = "0"' \
  "$TMP/project-integration-worker.variables.json" >"$TMP/project-invalid.json"
mv "$TMP/project-invalid.json" "$TMP/project-integration-worker.variables.json"
if env "${common_env[@]}" \
  bash "$ROOT/scripts/railway-production-preflight.sh" "$MANIFEST" >"$TMP/invalid.out" 2>&1; then
  echo "production preflight accepted an invalid organization allowlist" >&2
  exit 1
fi
grep -Fq 'project-integration-worker is missing or has invalid LUMIERE_PROJECT_WORKER_ORG_IDS' \
  "$TMP/invalid.out"

echo "railway production preflight tests passed"

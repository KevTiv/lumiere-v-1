#!/usr/bin/env bash
set -Eeuo pipefail

readonly ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
readonly MANIFEST="$ROOT/infra/railway/production-eu-services.json"
readonly TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

node "$ROOT/scripts/tests/test-railway-bootstrap-service-identities.mjs"

jq '[
  .services[]
  | select(.name != "ai-gateway")
  | {
      id: ("service-" + .name),
      name,
      regions: [{name: "europe-west4", configured: 1}]
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

jq -n '{LUMIERE_DOCUMENT_BLOB_DIR: "/data/document-blobs"}' >"$TMP/api-server.variables.json"
jq -n '{LUMIERE_ENV:"production",KONG_DATABASE:"postgres",KONG_PG_HOST:"kong-postgres.railway.internal",KONG_PG_DATABASE:"lumiere_kong",KONG_PG_USER:"lumiere_kong",KONG_PG_PASSWORD:null,KONG_TRUSTED_IPS:"192.0.2.0/24"}' >"$TMP/api-gateway.variables.json"

cat >"$TMP/railway" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
case "${1:-} ${2:-}" in
  "status --json")
    printf '{"id":"%s"}\n' "${TEST_LINKED_PROJECT:-cc695d4b-030c-43e3-bbd6-a41095b09257}"
    ;;
  "environment config")
    cat "$TEST_CONFIG_FILE"
    ;;
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
# has no configured EU replica. Enabling the feature makes the same service strict.
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
grep -Fq 'ai-gateway has no configured EU replica' "$TMP/ai-region.out"

# A selected pilot must have one replica and distinct service credentials.
jq '. + [{id:"service-ai-gateway",name:"ai-gateway",regions:[{name:"europe-west4",configured:1}]}]' "$TMP/services.json" >"$TMP/ai-services.json"
jq -n '{LUMIERE_BIN:"gateway",LUMIERE_ENV:"production",STDB_HOST:"http://spacetimedb.railway.internal:3000",STDB_MODULE:"lumiere-v1",STDB_TOKEN:null,AI_SPEND_READ_STDB_TOKEN:null,AI_CERTIFICATION_STDB_TOKEN:null,AI_EXECUTION_ENVELOPE_KEY:null,LUMIERE_AI_GATEWAY_INTERNAL_SECRET:null,MISTRAL_API_KEY:null,AI_CERTIFICATION_RUNTIME_HASH:"sha256:0123456789abcdef"}' >"$TMP/ai-gateway.variables.json"
env "${common_env[@]}" RAILWAY_ENABLE_AI=true TEST_SERVICES_FILE="$TMP/ai-services.json" bash "$ROOT/scripts/railway-production-preflight.sh" "$MANIFEST"
# Never-deployed services use their explicit EU configuration, not empty
# deployment metadata. Runtime gates still require the exact Metal location.
jq 'map(if .name == "ai-gateway" then .regions=[] else . end)' "$TMP/ai-services.json" >"$TMP/ai-new.json"
jq -n '{services:{"service-ai-gateway":{deploy:{multiRegionConfig:{"europe-west4":{numReplicas:1}}}}}}' >"$TMP/config.json"
env "${common_env[@]}" RAILWAY_ENABLE_AI=true TEST_SERVICES_FILE="$TMP/ai-new.json" TEST_CONFIG_FILE="$TMP/config.json" bash "$ROOT/scripts/railway-production-preflight.sh" "$MANIFEST"
for bad in wrong-project wrong-region missing-region multiple-replicas; do
  jq -n '{services:{"service-ai-gateway":{deploy:{multiRegionConfig:{"europe-west4":{numReplicas:1}}}}}}' >"$TMP/config.json"
  linked=cc695d4b-030c-43e3-bbd6-a41095b09257
  case "$bad" in
    wrong-project) linked=another-project ;;
    wrong-region) jq '.services["service-ai-gateway"].deploy.multiRegionConfig={"us-west2":{numReplicas:1}}' "$TMP/config.json" >"$TMP/bad-config.json"; mv "$TMP/bad-config.json" "$TMP/config.json" ;;
    missing-region) printf '{"services":{}}' >"$TMP/config.json" ;;
    multiple-replicas) jq '.services["service-ai-gateway"].deploy.multiRegionConfig["europe-west4"].numReplicas=2' "$TMP/config.json" >"$TMP/bad-config.json"; mv "$TMP/bad-config.json" "$TMP/config.json" ;;
  esac
  if env "${common_env[@]}" RAILWAY_ENABLE_AI=true TEST_SERVICES_FILE="$TMP/ai-new.json" TEST_CONFIG_FILE="$TMP/config.json" TEST_LINKED_PROJECT="$linked" bash "$ROOT/scripts/railway-production-preflight.sh" "$MANIFEST" >"$TMP/new-$bad.out" 2>&1; then
    echo "preflight accepted $bad for a new service" >&2; exit 1
  fi
done

jq 'map(if .name == "ai-gateway" then .regions[0].configured=2 else . end)' "$TMP/ai-services.json" >"$TMP/ai-replicas.json"
if env "${common_env[@]}" RAILWAY_ENABLE_AI=true TEST_SERVICES_FILE="$TMP/ai-replicas.json" bash "$ROOT/scripts/railway-production-preflight.sh" "$MANIFEST" >"$TMP/ai-replicas.out" 2>&1; then
  echo 'AI profile limits accepted multiple replicas' >&2; exit 1
fi
grep -Fq 'ai-gateway profile admission requires at most 1' "$TMP/ai-replicas.out"
jq '. + {KONG_LLM_URL:"https://proxy.invalid"}' "$TMP/ai-gateway.variables.json" >"$TMP/ai-proxy.json"
cp "$TMP/ai-gateway.variables.json" "$TMP/ai-direct.json"
cp "$TMP/ai-proxy.json" "$TMP/ai-gateway.variables.json"
if env "${common_env[@]}" RAILWAY_ENABLE_AI=true TEST_SERVICES_FILE="$TMP/ai-services.json" bash "$ROOT/scripts/railway-production-preflight.sh" "$MANIFEST" >"$TMP/ai-proxy.out" 2>&1; then
  echo 'direct pilot accepted proxy routing' >&2; exit 1
fi
grep -Fq 'invalid KONG_LLM_URL' "$TMP/ai-proxy.out"
cp "$TMP/ai-direct.json" "$TMP/ai-gateway.variables.json"

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

# Documents must survive a container replacement and stay on one API replica
# while the runtime uses a local volume rather than shared object storage.
jq 'map(if .name == "api-server" then .regions[0].configured = 2 else . end)' \
  "$TMP/services.json" >"$TMP/replicas.json"
if env "${common_env[@]}" TEST_SERVICES_FILE="$TMP/replicas.json" \
  bash "$ROOT/scripts/railway-production-preflight.sh" "$MANIFEST" >"$TMP/replicas.out" 2>&1; then
  echo "production preflight accepted replicated local document storage" >&2
  exit 1
fi
grep -Fq 'api-server local document storage requires at most 1 configured replica' "$TMP/replicas.out"
jq '{LUMIERE_DOCUMENT_BLOB_DIR: "/tmp/lumiere-document-blobs"}' >"$TMP/api-server.variables.json"
if env "${common_env[@]}" \
  bash "$ROOT/scripts/railway-production-preflight.sh" "$MANIFEST" >"$TMP/blob-path.out" 2>&1; then
  echo "production preflight accepted temporary document storage" >&2
  exit 1
fi
grep -Fq 'api-server is missing or has invalid LUMIERE_DOCUMENT_BLOB_DIR' "$TMP/blob-path.out"
jq -n '{LUMIERE_DOCUMENT_BLOB_DIR: "/data/document-blobs"}' >"$TMP/api-server.variables.json"

# Explicit selection must gate even when no provider variables are configured.
if env "${common_env[@]}" RAILWAY_ENABLE_REVIEWED_MAIL=true \
  bash "$ROOT/scripts/railway-production-preflight.sh" "$MANIFEST" >"$TMP/mail-missing.out" 2>&1; then
  echo "production preflight accepted reviewed email without prerequisites" >&2
  exit 1
fi
grep -Fq 'invalid LUMIERE_REVIEWED_MAIL_STDB_TOKEN' "$TMP/mail-missing.out"
grep -Fq 'invalid RESEND_API_KEY' "$TMP/mail-missing.out"

# A partially configured feature is also selected; no flag can hide it.
jq '. + {RESEND_API_KEY: null}' "$TMP/api-server.variables.json" >"$TMP/api-mail.json"
mv "$TMP/api-mail.json" "$TMP/api-server.variables.json"
if env "${common_env[@]}" RAILWAY_ENABLE_REVIEWED_MAIL=false \
  bash "$ROOT/scripts/railway-production-preflight.sh" "$MANIFEST" >"$TMP/mail-partial.out" 2>&1; then
  echo "production preflight accepted a partially configured reviewed-mail provider" >&2
  exit 1
fi
grep -Fq 'invalid LUMIERE_REVIEWED_MAIL_STDB_TOKEN' "$TMP/mail-partial.out"

# Sealed values count as present; bootstrap/runtime independently verify their
# database-authenticated identity and per-organization active service binding.
jq '. + {LUMIERE_REVIEWED_MAIL_STDB_TOKEN: null, STDB_SERVER_TOKEN: null,
  RESEND_FROM_EMAIL: "Accounts <accounts@lumiere-erp.com>"}' \
  "$TMP/api-server.variables.json" >"$TMP/api-mail.json"
mv "$TMP/api-mail.json" "$TMP/api-server.variables.json"
env "${common_env[@]}" bash "$ROOT/scripts/railway-production-preflight.sh" "$MANIFEST"

jq '. + {LUMIERE_REVIEWED_MAIL_STDB_TOKEN: "synthetic-fixture-same-token-1234567890",
  STDB_SERVER_TOKEN: "synthetic-fixture-same-token-1234567890"}' \
  "$TMP/api-server.variables.json" >"$TMP/api-mail.json"
mv "$TMP/api-mail.json" "$TMP/api-server.variables.json"
if env "${common_env[@]}" \
  bash "$ROOT/scripts/railway-production-preflight.sh" "$MANIFEST" >"$TMP/mail-same.out" 2>&1; then
  echo "production preflight accepted a reused reviewed-mail owner credential" >&2
  exit 1
fi
grep -Fq 'requires distinct LUMIERE_REVIEWED_MAIL_STDB_TOKEN and STDB_SERVER_TOKEN' "$TMP/mail-same.out"
if grep -Fq 'synthetic-fixture-same-token' "$TMP/mail-same.out"; then
  echo "production preflight printed a credential value" >&2
  exit 1
fi
jq -n '{LUMIERE_DOCUMENT_BLOB_DIR: "/data/document-blobs"}' >"$TMP/api-server.variables.json"

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

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat >"$TMP/railway" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  deployment)
    [[ "${2:-}" == list ]]
    printf '[{"id":"dep-1","status":"SUCCESS"}]\n'
    ;;
  ssh)
    printf '%s\n' "${TEST_RAILWAY_REGION:-europe-west4-drams3a}"
    ;;
  logs)
    printf '%s\n' "${TEST_RAILWAY_LOGS:-}"
    ;;
  environment)
    [[ "${2:-}" == edit ]]
    cat >"${TEST_SOURCE_PATCH_FILE:?}"
    printf '%s\n' "$*" >"${TEST_SOURCE_ARGS_FILE:?}"
    if [[ "${TEST_ENV_EDIT_COMMITTED:-true}" == true ]]; then
      printf '{"staged":true,"committed":true,"environmentId":"environment-test"}\n'
    else
      printf '{"staged":false,"committed":false,"message":"No changes to apply"}\n'
    fi
    ;;
  service)
    [[ "${2:-}" == list ]]
    if [[ -n "${TEST_SERVICE_LIST_ARGS_FILE:-}" ]]; then
      printf '%s\n' "$*" >"$TEST_SERVICE_LIST_ARGS_FILE"
    fi
    if [[ -n "${TEST_RAILWAY_SERVICES_JSON:-}" ]]; then
      printf '%s\n' "$TEST_RAILWAY_SERVICES_JSON"
    else
      printf '[{"id":"service-api-id","name":"api-server"}]\n'
    fi
    ;;
  redeploy)
    printf '%s\n' "$*" >"${TEST_REDEPLOY_ARGS_FILE:?}"
    printf '{"status":"queued"}\n'
    ;;
  *)
    echo "unexpected railway invocation: $*" >&2
    exit 90
    ;;
esac
EOF
chmod +x "$TMP/railway"

cat >"$TMP/curl" <<'EOF'
#!/usr/bin/env bash
exit "${TEST_CURL_EXIT:-0}"
EOF
chmod +x "$TMP/curl"

common_env=(
  "PATH=$TMP:$PATH"
  "RAILWAY_PROJECT_ID=project-test"
  "RAILWAY_ENVIRONMENT=production"
  "RAILWAY_POLL_SECONDS=0"
  "RAILWAY_GATE_TIMEOUT_SECONDS=2"
  "RAILWAY_PROBE_TIMEOUT_SECONDS=2"
  "RAILWAY_EXPECTED_REGION=europe-west4-drams3a"
)

env "${common_env[@]}" bash "$ROOT/scripts/railway-stack-release.sh" gate Postgres Redis
env "${common_env[@]}" bash "$ROOT/scripts/railway-stack-release.sh" probe api=https://api.example.test/ready ai=https://ai.example.test/ready

if env "${common_env[@]}" TEST_RAILWAY_REGION=us-west2 \
  bash "$ROOT/scripts/railway-stack-release.sh" gate Postgres >/dev/null 2>&1; then
  echo "region mismatch unexpectedly passed" >&2
  exit 1
fi

if env "${common_env[@]}" \
  bash "$ROOT/scripts/railway-stack-release.sh" probe invalid=ftp://example.test >/dev/null 2>&1; then
  echo "invalid probe unexpectedly passed" >&2
  exit 1
fi

marker='PostgreSQL storage migrations applied and verified successfully'
env "${common_env[@]}" \
  RAILWAY_DEPLOY_TIMEOUT_SECONDS=1 \
  TEST_RAILWAY_LOGS="$marker" \
  bash -c '
    source "$1"
    deploy_one() { :; }
    migrate_storage storage-migrate
  ' _ "$ROOT/scripts/railway-stack-release.sh"

if env "${common_env[@]}" \
  RAILWAY_DEPLOY_TIMEOUT_SECONDS=1 \
  TEST_RAILWAY_LOGS='migration exited without a positive marker' \
  bash -c '
    source "$1"
    deploy_one() { :; }
    migrate_storage storage-migrate
  ' _ "$ROOT/scripts/railway-stack-release.sh" >/dev/null 2>&1; then
  echo "storage migration accepted a deployment without its success marker" >&2
  exit 1
fi

runtime_digest="ghcr.io/kevtiv/lumiere-v-1-rust-runtime@sha256:$(printf 'a%.0s' {1..64})"
source_patch_file="$TMP/source-patch.json"
source_args_file="$TMP/source-args.txt"
redeploy_args_file="$TMP/redeploy-args.txt"
service_list_args_file="$TMP/service-list-args.txt"
env "${common_env[@]}" \
  RUST_RUNTIME_IMAGE="$runtime_digest" \
  TEST_SOURCE_PATCH_FILE="$source_patch_file" \
  TEST_SOURCE_ARGS_FILE="$source_args_file" \
  TEST_SERVICE_LIST_ARGS_FILE="$service_list_args_file" \
  TEST_REDEPLOY_ARGS_FILE="$redeploy_args_file" \
  bash -c '
    source "$1"
    wait_for_new_deployment() { printf "dep-2\n"; }
    wait_for_terminal_success() { :; }
    deployment_image() { printf "%s\n" "$RUST_RUNTIME_IMAGE"; }
    redeploy_source_one api-server
  ' _ "$ROOT/scripts/railway-stack-release.sh"

jq -e --arg image "$runtime_digest" '
  . == {services: {"service-api-id": {source: {
    image: $image,
    repo: null,
    branch: null,
    commitSha: null,
    upstreamUrl: null
  }}}}
' "$source_patch_file" >/dev/null
grep -Fq -- '--project project-test' "$source_args_file"
grep -Fq -- '--environment production' "$source_args_file"
grep -Fq -- '--json' "$source_args_file"
grep -Fq -- '--project project-test' "$service_list_args_file"
grep -Fq -- '--environment production' "$service_list_args_file"
grep -Fq -- '--json' "$service_list_args_file"
test ! -e "$redeploy_args_file"

if env "${common_env[@]}" \
  RUST_RUNTIME_IMAGE="$runtime_digest" \
  TEST_RAILWAY_SERVICES_JSON='[{"id":"service-one","name":"api-server"},{"id":"service-two","name":"api-server"}]' \
  TEST_SOURCE_PATCH_FILE="$source_patch_file" \
  TEST_SOURCE_ARGS_FILE="$source_args_file" \
  TEST_REDEPLOY_ARGS_FILE="$redeploy_args_file" \
  bash -c '
    source "$1"
    redeploy_source_one api-server
  ' _ "$ROOT/scripts/railway-stack-release.sh" >/dev/null 2>&1; then
  echo "source promotion accepted an ambiguous environment-scoped service name" >&2
  exit 1
fi

env "${common_env[@]}" \
  RUST_RUNTIME_IMAGE="$runtime_digest" \
  TEST_ENV_EDIT_COMMITTED=false \
  TEST_SOURCE_PATCH_FILE="$source_patch_file" \
  TEST_SOURCE_ARGS_FILE="$source_args_file" \
  TEST_REDEPLOY_ARGS_FILE="$redeploy_args_file" \
  bash -c '
    source "$1"
    wait_for_new_deployment() { printf "dep-3\n"; }
    wait_for_terminal_success() { :; }
    deployment_image() { printf "%s\n" "$RUST_RUNTIME_IMAGE"; }
    redeploy_source_one api-server
  ' _ "$ROOT/scripts/railway-stack-release.sh"
grep -Fq -- '--project project-test' "$redeploy_args_file"
grep -Fq -- '--environment production' "$redeploy_args_file"
grep -Fq -- '--service api-server' "$redeploy_args_file"
grep -Fq -- '--from-source' "$redeploy_args_file"

publisher_bin="$TMP/publisher-bin"
mkdir -p "$publisher_bin"
cat >"$publisher_bin/spacetime" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  publish)
    exit 0
    ;;
  describe)
    case "${TEST_SCHEMA_FORM:-array}" in
      array)
        printf '{"reducers":[],"tables":[{"name":"organization"}],"types":[],"typespace":{}}\n'
        ;;
      map)
        printf '{"reducers":[],"tables":{"organization":{"columns":[]}},"types":[],"typespace":{}}\n'
        ;;
      missing)
        printf '{"reducers":[],"tables":[],"types":[],"typespace":{}}\n'
        ;;
    esac
    ;;
  *)
    exit 91
    ;;
esac
EOF
cat >"$publisher_bin/sleep" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$publisher_bin/spacetime" "$publisher_bin/sleep"

publisher_output="$(env \
  "PATH=$publisher_bin:$PATH" \
  "HOME=$TMP/publisher-home" \
  STDB_HOST=http://spacetimedb.test \
  STDB_MODULE=lumiere-test \
  STDB_SERVER_TOKEN=not-a-real-secret \
  bash "$ROOT/scripts/railway-publish-spacetimedb.sh")"
grep -Fq 'SpacetimeDB publish and schema verification passed for lumiere-test' <<<"$publisher_output"
test ! -e "$TMP/publisher-home/.config/spacetime/cli.toml"

env \
  "PATH=$publisher_bin:$PATH" \
  "HOME=$TMP/publisher-map-home" \
  TEST_SCHEMA_FORM=map \
  STDB_HOST=http://spacetimedb.test \
  STDB_MODULE=lumiere-test \
  STDB_SERVER_TOKEN=not-a-real-secret \
  bash "$ROOT/scripts/railway-publish-spacetimedb.sh" >/dev/null

if env \
  "PATH=$publisher_bin:$PATH" \
  "HOME=$TMP/publisher-missing-home" \
  TEST_SCHEMA_FORM=missing \
  STDB_HOST=http://spacetimedb.test \
  STDB_MODULE=lumiere-test \
  STDB_SERVER_TOKEN=not-a-real-secret \
  bash "$ROOT/scripts/railway-publish-spacetimedb.sh" >/dev/null 2>&1; then
  echo "publisher accepted a schema without the organization table" >&2
  exit 1
fi
test ! -e "$TMP/publisher-missing-home/.config/spacetime/cli.toml"

echo "railway stack release tests passed"

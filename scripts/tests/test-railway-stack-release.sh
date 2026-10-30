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
    if [[ -n "${TEST_RAILWAY_DEPLOYMENTS_FILE:-}" ]]; then
      limit=20
      args=("$@")
      for ((i=0; i < ${#args[@]}; i++)); do
        [[ "${args[$i]}" != --limit ]] || limit="${args[$((i + 1))]}"
      done
      jq --argjson limit "$limit" '.[:$limit]' "$TEST_RAILWAY_DEPLOYMENTS_FILE"
    else
      printf '[{"id":"dep-1","status":"SUCCESS"}]\n'
    fi
    ;;
  status)
    [[ " $* " == *" --project project-test "* ]]
    [[ " $* " == *" --environment production "* ]]
    cat "${TEST_RAILWAY_STATUS_FILE:?}"
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

jq -n '{id: "project-test", environments: {edges: [{node: {
  id: "environment-test", name: "production", serviceInstances: {edges:
    ["Postgres", "kong-postgres"] | map({node: {
      serviceId: (. + "-id"), serviceName: ., environmentId: "environment-test",
      latestDeployment: {id: "dep-1", status: "SUCCESS"},
      activeDeployments: [{id: "dep-1", status: "SUCCESS", deploymentStopped: false,
        instances: [{id: "replica-1", status: "RUNNING"}],
        meta: {deprecatedRegions: [{region: "europe-west4", replacementRegion: "europe-west4-drams3a"}],
          serviceManifest: {deploy: {multiRegionConfig: {"europe-west4": {numReplicas: 1}}}}}}]
    }})
  }
}}]}}' >"$TMP/active-services.json"

common_env=(
  "PATH=$TMP:$PATH"
  "RAILWAY_PROJECT_ID=project-test"
  "RAILWAY_ENVIRONMENT=production"
  "RAILWAY_POLL_SECONDS=0"
  "RAILWAY_GATE_TIMEOUT_SECONDS=2"
  "RAILWAY_PROBE_TIMEOUT_SECONDS=2"
  "RAILWAY_EXPECTED_REGION=europe-west4-drams3a"
  "TEST_RAILWAY_STATUS_FILE=$TMP/active-services.json"
)

env "${common_env[@]}" bash "$ROOT/scripts/railway-stack-release.sh" gate Postgres kong-postgres
env "${common_env[@]}" bash "$ROOT/scripts/railway-stack-release.sh" probe api=https://api.example.test/ready ai=https://ai.example.test/ready

# Exercise the real CLI status shape, with a newer skipped watch-path record
# that has not replaced the successful, running active deployment.
jq '.environments.edges[0].node.serviceInstances.edges[].node.latestDeployment =
  {id: "skipped-newer", status: "SKIPPED"}' "$TMP/active-services.json" >"$TMP/skipped-latest.json"
env "${common_env[@]}" TEST_RAILWAY_STATUS_FILE="$TMP/skipped-latest.json" \
  bash "$ROOT/scripts/railway-stack-release.sh" gate Postgres kong-postgres

jq -n '[range(0; 101) | {id: ("skipped-" + tostring), status: "SKIPPED"}]
  + [{id: "dep-1", status: "SUCCESS"}]' >"$TMP/long-skipped-history.json"
env "${common_env[@]}" TEST_RAILWAY_STATUS_FILE="$TMP/skipped-latest.json" \
  TEST_RAILWAY_DEPLOYMENTS_FILE="$TMP/long-skipped-history.json" \
  bash "$ROOT/scripts/railway-stack-release.sh" gate Postgres

printf '[{"id":"skipped-newer","status":"SKIPPED"},{"id":"failed-newer","status":"FAILED"},{"id":"dep-1","status":"SUCCESS"}]\n' \
  >"$TMP/failed-behind-skipped.json"
if env "${common_env[@]}" TEST_RAILWAY_STATUS_FILE="$TMP/skipped-latest.json" \
  TEST_RAILWAY_DEPLOYMENTS_FILE="$TMP/failed-behind-skipped.json" \
  bash "$ROOT/scripts/railway-stack-release.sh" gate Postgres >/dev/null 2>&1; then
  echo "skipped record hid a failed rollout" >&2
  exit 1
fi

reject_infrastructure() {
  local name="$1" filter="$2"
  jq "$filter" "$TMP/active-services.json" >"$TMP/rejected-status.json"
  if env "${common_env[@]}" RAILWAY_GATE_TIMEOUT_SECONDS=1 \
    TEST_RAILWAY_STATUS_FILE="$TMP/rejected-status.json" \
    bash "$ROOT/scripts/railway-stack-release.sh" gate Postgres >"$TMP/rejected-status.log" 2>&1; then
    echo "$name unexpectedly passed" >&2
    exit 1
  fi
}

service_path='.environments.edges[0].node.serviceInstances.edges[0].node'
active_path="$service_path.activeDeployments[0]"
reject_infrastructure 'region mismatch' \
  "$active_path.meta.serviceManifest.deploy.multiRegionConfig = {\"us-west2\": {numReplicas: 1}}"
reject_infrastructure 'mixed deployed regions' \
  "$active_path.meta.serviceManifest.deploy.multiRegionConfig.\"us-west2\" = {numReplicas: 1}"
reject_infrastructure 'missing placement evidence' "del($active_path.meta.serviceManifest)"
reject_infrastructure 'ambiguous region mapping' \
  "$active_path.meta.deprecatedRegions += [{region: \"europe-west4\", replacementRegion: \"us-west2\"}]"
reject_infrastructure 'zero replicas' \
  "$active_path.meta.serviceManifest.deploy.multiRegionConfig.\"europe-west4\".numReplicas = 0"
reject_infrastructure 'crashed active replica' "$active_path.instances[0].status = \"CRASHED\""
reject_infrastructure 'removed-only replicas' "$active_path.instances[0].status = \"REMOVED\""
reject_infrastructure 'stopped active deployment' "$active_path.deploymentStopped = true"
reject_infrastructure 'no active deployment' "$service_path.activeDeployments = []"
reject_infrastructure 'unrelated successful deployment' "$active_path.id = \"older-unrelated\""
reject_infrastructure 'new failed deployment behind old success' \
  "$service_path.latestDeployment = {id: \"failed-newer\", status: \"FAILED\"}"
reject_infrastructure 'new pending deployment behind old success' \
  "$service_path.latestDeployment = {id: \"pending-newer\", status: \"DEPLOYING\"}"
reject_infrastructure 'wrong project' '.id = "other-project"'
reject_infrastructure 'wrong environment' '.environments.edges[0].node.name = "staging"'
reject_infrastructure 'ambiguous service' \
  '.environments.edges[0].node.serviceInstances.edges += [.environments.edges[0].node.serviceInstances.edges[0]]'

# Exact modern region names need no alias. Explicitly deleted placements do not
# represent running replicas and may remain in a deployment's historical map.
jq "$active_path.meta.serviceManifest.deploy.multiRegionConfig =
  {\"europe-west4-drams3a\": {numReplicas: 1}, \"us-west2\": null}" \
  "$TMP/active-services.json" >"$TMP/exact-region.json"
env "${common_env[@]}" TEST_RAILWAY_STATUS_FILE="$TMP/exact-region.json" \
  bash "$ROOT/scripts/railway-stack-release.sh" gate Postgres

jq "$active_path.instances += [{id: \"old-replica\", status: \"REMOVED\"}]" \
  "$TMP/active-services.json" >"$TMP/removed-replica-history.json"
env "${common_env[@]}" TEST_RAILWAY_STATUS_FILE="$TMP/removed-replica-history.json" \
  bash "$ROOT/scripts/railway-stack-release.sh" gate Postgres

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

# Publisher promotion must use its own image and require a positive marker
# from the new deployment, just like storage migrations.
publisher_digest="ghcr.io/kevtiv/lumiere-v-1-spacetimedb-publisher@sha256:$(printf 'b%.0s' {1..64})"
for publisher_logs in 'SpacetimeDB publish and schema verification passed' 'publish failed'; do
  expected_status=0
  [[ "$publisher_logs" == 'publish failed' ]] && expected_status=1
  actual_status=0
  env "${common_env[@]}" \
    STDB_PUBLISHER_IMAGE="$publisher_digest" \
    TEST_RAILWAY_SERVICES_JSON='[{"id":"publisher-id","name":"spacetimedb-publisher"}]' \
    TEST_RAILWAY_LOGS="$publisher_logs" \
    RAILWAY_DEPLOY_TIMEOUT_SECONDS=1 \
    TEST_SOURCE_PATCH_FILE="$source_patch_file" \
    TEST_SOURCE_ARGS_FILE="$source_args_file" \
    bash -c '
      source "$1"
      wait_for_new_deployment() { printf "dep-1\n"; }
      wait_for_terminal_success() { :; }
      deployment_image() { printf "%s\n" "$STDB_PUBLISHER_IMAGE"; }
      promote_publisher spacetimedb-publisher
    ' _ "$ROOT/scripts/railway-stack-release.sh" >"$TMP/publisher-promotion.log" 2>&1 || actual_status=1
  [[ "$actual_status" == "$expected_status" ]] || {
    cat "$TMP/publisher-promotion.log" >&2
    echo "publisher promotion did not enforce its completion marker" >&2
    exit 1
  }
done
jq -e --arg image "$publisher_digest" \
  '.services["publisher-id"].source.image == $image' "$source_patch_file" >/dev/null

publisher_bin="$TMP/publisher-bin"
mkdir -p "$publisher_bin"
cat >"$publisher_bin/spacetime" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == --config-path ]]; then
  test -s "$2"
  printf '%s\n' "$2" >> "$TEST_PUBLISHER_CONFIG_LOG"
  shift 2
fi
case "$1" in
  publish)
    [[ " $* " == *" --delete-data=never "* ]]
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
      sections)
        printf '{"sections":[{"Typespace":{"types":[]}},{"Types":[]},{"Tables":[{"source_name":"organization"}]},{"Reducers":[]}]}\n'
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

export TEST_PUBLISHER_CONFIG_LOG="$TMP/publisher-config-paths"

publisher_output="$(env \
  "PATH=$publisher_bin:$PATH" \
  STDB_HOST=http://spacetimedb.test \
  STDB_MODULE=lumiere-test \
  STDB_SERVER_TOKEN=not-a-real-secret \
  bash "$ROOT/scripts/railway-publish-spacetimedb.sh")"
grep -Fq 'SpacetimeDB publish and schema verification passed for lumiere-test' <<<"$publisher_output"

env \
  "PATH=$publisher_bin:$PATH" \
  TEST_SCHEMA_FORM=map \
  STDB_HOST=http://spacetimedb.test \
  STDB_MODULE=lumiere-test \
  STDB_SERVER_TOKEN=not-a-real-secret \
  bash "$ROOT/scripts/railway-publish-spacetimedb.sh" >/dev/null

env \
  "PATH=$publisher_bin:$PATH" \
  TEST_SCHEMA_FORM=sections \
  STDB_HOST=http://spacetimedb.test \
  STDB_MODULE=lumiere-test \
  STDB_SERVER_TOKEN=not-a-real-secret \
  bash "$ROOT/scripts/railway-publish-spacetimedb.sh" >/dev/null

if env \
  "PATH=$publisher_bin:$PATH" \
  TEST_SCHEMA_FORM=missing \
  STDB_HOST=http://spacetimedb.test \
  STDB_MODULE=lumiere-test \
  STDB_SERVER_TOKEN=not-a-real-secret \
  bash "$ROOT/scripts/railway-publish-spacetimedb.sh" >/dev/null 2>&1; then
  echo "publisher accepted a schema without the organization table" >&2
  exit 1
fi

while IFS= read -r config_path; do
  test ! -e "$config_path"
done < "$TEST_PUBLISHER_CONFIG_LOG"

echo "railway stack release tests passed"

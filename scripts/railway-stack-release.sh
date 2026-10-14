#!/usr/bin/env bash
set -Eeuo pipefail

readonly POLL_SECONDS="${RAILWAY_POLL_SECONDS:-10}"
readonly DEPLOY_TIMEOUT_SECONDS="${RAILWAY_DEPLOY_TIMEOUT_SECONDS:-1800}"
readonly UPLOAD_TIMEOUT_SECONDS="${RAILWAY_UPLOAD_TIMEOUT_SECONDS:-600}"
readonly GATE_TIMEOUT_SECONDS="${RAILWAY_GATE_TIMEOUT_SECONDS:-600}"
readonly PROBE_TIMEOUT_SECONDS="${RAILWAY_PROBE_TIMEOUT_SECONDS:-300}"
readonly HTTP_TIMEOUT_SECONDS="${RAILWAY_HTTP_TIMEOUT_SECONDS:-10}"

usage() {
  cat <<'EOF'
Usage: scripts/railway-stack-release.sh COMMAND [ARGS...]

Commands:
  gate SERVICE...        Wait for existing deployments to settle successfully.
  deploy SERVICE...      Deploy the same immutable release root concurrently.
  probe NAME=URL...      Probe HTTP readiness endpoints concurrently.
  publish-stdb SERVICE  Deploy the one-shot publisher and verify its completion marker.
  migrate-storage SERVICE
                         Deploy the one-shot migrator and verify its completion marker.

Required environment:
  RAILWAY_PROJECT_ID, RAILWAY_ENVIRONMENT

Additional deploy environment:
  RELEASE_SHA (full commit), RELEASE_ROOT (default: current directory)

Optional safety controls:
  RAILWAY_EXPECTED_REGION       Verify RAILWAY_REPLICA_REGION through railway ssh.
EOF
}

die() {
  echo "[railway-release] ERROR: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required"
}

require_base_environment() {
  : "${RAILWAY_PROJECT_ID:?RAILWAY_PROJECT_ID is required}"
  : "${RAILWAY_ENVIRONMENT:?RAILWAY_ENVIRONMENT is required}"
  require_command railway
  require_command jq
  require_command timeout
}

is_terminal_failure() {
  case "$1" in
    FAILED|CRASHED|REMOVED|CANCELED|CANCELLED|SKIPPED|OOM_KILLED)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

deployment_list() {
  local service="$1"
  railway deployment list \
    --project "$RAILWAY_PROJECT_ID" \
    --environment "$RAILWAY_ENVIRONMENT" \
    --service "$service" \
    --limit 100 \
    --json
}

deployment_status() {
  local service="$1"
  local deployment_id="$2"
  deployment_list "$service" | jq -r --arg id "$deployment_id" \
    '.[] | select(.id == $id) | .status // empty' | head -1
}

dump_diagnostics() {
  local service="$1"
  local deployment_id="${2:-}"
  echo "::group::Railway diagnostics: $service" >&2
  deployment_list "$service" | jq '.[0:5]' >&2 || true
  if [[ -n "$deployment_id" ]]; then
    timeout 30 railway logs \
      --project "$RAILWAY_PROJECT_ID" \
      --environment "$RAILWAY_ENVIRONMENT" \
      --service "$service" \
      --deployment "$deployment_id" \
      --lines 200 >&2 || true
  fi
  echo "::endgroup::" >&2
}

verify_runtime_region() {
  local service="$1"
  [[ -n "${RAILWAY_EXPECTED_REGION:-}" ]] || return 0

  local observed
  if ! observed="$(timeout 45 railway ssh \
    --project "$RAILWAY_PROJECT_ID" \
    --environment "$RAILWAY_ENVIRONMENT" \
    --service "$service" \
    printenv RAILWAY_REPLICA_REGION 2>/dev/null)"; then
    echo "[railway-release] $service: could not read RAILWAY_REPLICA_REGION" >&2
    return 1
  fi
  observed="$(printf '%s' "$observed" | tr -d '\r' | tail -1)"
  if [[ "$observed" != "$RAILWAY_EXPECTED_REGION" ]]; then
    echo "[railway-release] $service: expected region $RAILWAY_EXPECTED_REGION, observed ${observed:-<empty>}" >&2
    return 1
  fi
  echo "[railway-release] $service: runtime region $observed"
}

wait_for_existing_success() {
  local service="$1"
  local deadline=$((SECONDS + GATE_TIMEOUT_SECONDS))
  local deployment_id=""
  local status=""

  while (( SECONDS < deadline )); do
    local deployments
    if deployments="$(deployment_list "$service" 2>/dev/null)"; then
      deployment_id="$(jq -r '.[0].id // empty' <<<"$deployments")"
      status="$(jq -r '.[0].status // empty' <<<"$deployments")"
      echo "[railway-release] $service existing deployment ${deployment_id:-<none>}: ${status:-not-listed}"
      if [[ "$status" == SUCCESS ]]; then
        verify_runtime_region "$service"
        return
      fi
      if is_terminal_failure "$status"; then
        dump_diagnostics "$service" "$deployment_id"
        return 1
      fi
    fi
    sleep "$POLL_SECONDS"
  done

  echo "[railway-release] $service did not become healthy within ${GATE_TIMEOUT_SECONDS}s" >&2
  dump_diagnostics "$service" "$deployment_id"
  return 1
}

wait_for_new_deployment() {
  local service="$1"
  local before_ids="$2"
  local deadline=$((SECONDS + 180))
  local deployment_id=""

  while (( SECONDS < deadline )); do
    local deployments
    deployments="$(deployment_list "$service")"
    deployment_id="$(jq -r --argjson before "$before_ids" \
      '[.[] | select(.id as $id | ($before | index($id) | not))][0].id // empty' <<<"$deployments")"
    [[ -n "$deployment_id" ]] && {
      printf '%s\n' "$deployment_id"
      return
    }
    sleep 5
  done
  return 1
}

wait_for_terminal_success() {
  local service="$1"
  local deployment_id="$2"
  local deadline=$((SECONDS + DEPLOY_TIMEOUT_SECONDS))

  while (( SECONDS < deadline )); do
    local status
    status="$(deployment_status "$service" "$deployment_id")"
    echo "[railway-release] $service deployment $deployment_id: ${status:-not-listed}"
    [[ "$status" == SUCCESS ]] && return
    if is_terminal_failure "$status"; then
      dump_diagnostics "$service" "$deployment_id"
      return 1
    fi
    sleep "$POLL_SECONDS"
  done

  echo "[railway-release] $service deployment $deployment_id timed out after ${DEPLOY_TIMEOUT_SECONDS}s" >&2
  dump_diagnostics "$service" "$deployment_id"
  return 1
}

deploy_one() {
  local service="$1"
  local release_root="${RELEASE_ROOT:-.}"
  local before_ids
  before_ids="$(deployment_list "$service" | jq -c 'map(.id)')"

  echo "[railway-release] $service: uploading release $RELEASE_SHA"
  if ! timeout "$UPLOAD_TIMEOUT_SECONDS" railway up "$release_root" \
    --path-as-root \
    --detach \
    --project "$RAILWAY_PROJECT_ID" \
    --environment "$RAILWAY_ENVIRONMENT" \
    --service "$service" \
    --message "stack release $RELEASE_SHA ($service)"; then
    dump_diagnostics "$service"
    return 1
  fi

  local deployment_id
  if ! deployment_id="$(wait_for_new_deployment "$service" "$before_ids")"; then
    echo "[railway-release] $service: upload succeeded but no new deployment appeared" >&2
    dump_diagnostics "$service"
    return 1
  fi
  wait_for_terminal_success "$service" "$deployment_id"
}

wait_for_log_marker() {
  local service="$1"
  local marker="$2"
  local deployment_id="$3"
  local deadline=$((SECONDS + DEPLOY_TIMEOUT_SECONDS))

  while (( SECONDS < deadline )); do
    local logs
    logs="$(timeout 30 railway logs \
      --project "$RAILWAY_PROJECT_ID" \
      --environment "$RAILWAY_ENVIRONMENT" \
      --service "$service" \
      --deployment "$deployment_id" \
      --lines 200 2>/dev/null || true)"
    if grep -Fq "$marker" <<<"$logs"; then
      echo "[railway-release] $service: observed completion marker"
      return
    fi

    local status
    status="$(deployment_status "$service" "$deployment_id")"
    if is_terminal_failure "$status"; then
      dump_diagnostics "$service" "$deployment_id"
      return 1
    fi
    sleep "$POLL_SECONDS"
  done

  echo "[railway-release] $service did not emit its completion marker within ${DEPLOY_TIMEOUT_SECONDS}s" >&2
  dump_diagnostics "$service" "$deployment_id"
  return 1
}

probe_one() {
  local specification="$1"
  local name="${specification%%=*}"
  local url="${specification#*=}"
  [[ "$name" =~ ^[A-Za-z0-9_-]+$ && "$url" != "$specification" ]] || {
    echo "[railway-release] invalid probe $specification; expected NAME=URL" >&2
    return 2
  }
  [[ "$url" =~ ^https?:// ]] || {
    echo "[railway-release] $name probe must use HTTP(S)" >&2
    return 2
  }

  local deadline=$((SECONDS + PROBE_TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    if curl --fail --silent --show-error \
      --connect-timeout "$HTTP_TIMEOUT_SECONDS" \
      --max-time "$HTTP_TIMEOUT_SECONDS" \
      "$url" >/dev/null; then
      echo "[railway-release] $name: ready ($url)"
      return
    fi
    sleep "$POLL_SECONDS"
  done
  echo "[railway-release] $name: readiness timed out after ${PROBE_TIMEOUT_SECONDS}s ($url)" >&2
  return 1
}

run_parallel() {
  local function_name="$1"
  shift
  (( $# > 0 )) || die "$function_name requires at least one target"

  local -a pids=()
  local -A labels=()
  local target pid completed
  for target in "$@"; do
    "$function_name" "$target" &
    pid=$!
    pids+=("$pid")
    labels["$pid"]="$target"
  done

  local remaining=${#pids[@]}
  while (( remaining > 0 )); do
    completed=""
    if ! wait -n -p completed; then
      echo "[railway-release] parallel target ${labels[$completed]:-$completed} failed; stopping local monitors" >&2
      for pid in "${pids[@]}"; do
        kill "$pid" 2>/dev/null || true
      done
      wait 2>/dev/null || true
      return 1
    fi
    remaining=$((remaining - 1))
  done
}

deploy_and_require_marker() {
  local service="$1"
  local marker="$2"
  deploy_one "$service"

  local deployment_id
  deployment_id="$(deployment_list "$service" | jq -r '.[0].id // empty')"
  [[ -n "$deployment_id" ]] || die "$service has no deployment after one-shot release"
  wait_for_log_marker "$service" "$marker" "$deployment_id"
}

publish_stdb() {
  deploy_and_require_marker "$1" \
    'SpacetimeDB publish and schema verification passed'
}

migrate_storage() {
  deploy_and_require_marker "$1" \
    'PostgreSQL storage migrations applied and verified successfully'
}

main() {
  require_base_environment
  local command="${1:-}"
  [[ -n "$command" ]] || { usage; exit 2; }
  shift
  case "$command" in
    gate)
      run_parallel wait_for_existing_success "$@"
      ;;
    deploy)
      : "${RELEASE_SHA:?RELEASE_SHA is required}"
      [[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || die "RELEASE_SHA must be a lowercase full commit SHA"
      run_parallel deploy_one "$@"
      ;;
    probe)
      require_command curl
      run_parallel probe_one "$@"
      ;;
    publish-stdb)
      : "${RELEASE_SHA:?RELEASE_SHA is required}"
      [[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || die "RELEASE_SHA must be a lowercase full commit SHA"
      [[ $# -eq 1 ]] || die "publish-stdb requires exactly one publisher service"
      publish_stdb "$1"
      ;;
    migrate-storage)
      : "${RELEASE_SHA:?RELEASE_SHA is required}"
      [[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || die "RELEASE_SHA must be a lowercase full commit SHA"
      [[ $# -eq 1 ]] || die "migrate-storage requires exactly one migration service"
      migrate_storage "$1"
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      usage >&2
      die "unknown command: $command"
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi

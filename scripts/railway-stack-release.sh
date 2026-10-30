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
  redeploy-source SERVICE...
                         Atomically switch each service to the immutable runtime image.
  promote-image SERVICE IMAGE
                         Switch one service to a verified immutable image.
  promote-publisher SERVICE
                         Switch publisher image and require its completion marker.
  probe NAME=URL...      Probe HTTP readiness endpoints concurrently.
  publish-stdb SERVICE  Deploy the one-shot publisher and verify its completion marker.
  migrate-storage SERVICE
                         Deploy the one-shot migrator and verify its completion marker.

Required environment:
  RAILWAY_PROJECT_ID, RAILWAY_ENVIRONMENT

Additional deploy environment:
  RELEASE_SHA (full commit), RELEASE_ROOT (default: current directory)
  RUST_RUNTIME_IMAGE (exact image digest expected for redeploy-source)

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
  local limit="${2:-100}"
  railway deployment list \
    --project "$RAILWAY_PROJECT_ID" \
    --environment "$RAILWAY_ENVIRONMENT" \
    --service "$service" \
    --limit "$limit" \
    --json
}

resolve_service_id() {
  local service="$1"
  local services matches
  if ! services="$(timeout "$UPLOAD_TIMEOUT_SECONDS" railway service list \
    --project "$RAILWAY_PROJECT_ID" \
    --environment "$RAILWAY_ENVIRONMENT" \
    --json)"; then
    echo "[railway-release] $service: could not list environment-scoped services" >&2
    return 1
  fi
  matches="$(jq -c --arg service "$service" \
    '[.[] | select(.id == $service or .name == $service)]' <<<"$services")"
  if [[ "$(jq 'length' <<<"$matches")" != 1 ]]; then
    echo "[railway-release] $service: expected exactly one environment-scoped service" >&2
    return 1
  fi
  jq -er '.[0].id | select(type == "string" and length > 0)' <<<"$matches"
}

deployment_status() {
  local service="$1"
  local deployment_id="$2"
  deployment_list "$service" | jq -r --arg id "$deployment_id" \
    '.[] | select(.id == $id) | .status // empty' | head -1
}

deployment_image() {
  local service="$1"
  local deployment_id="$2"
  deployment_list "$service" | jq -r --arg id "$deployment_id" \
    '.[] | select(.id == $id) | .meta.image // empty' | head -1
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
  local deployment="$2"
  [[ -n "${RAILWAY_EXPECTED_REGION:-}" ]] || return 0

  # Use the active deployment's immutable manifest, not planned service config.
  # Railway records legacy-to-runtime zone mappings in its deployment metadata.
  # The current CLI requires registered SSH keys unavailable to project-token CI.
  if ! jq -e --arg expected "$RAILWAY_EXPECTED_REGION" '
    def runtime_region($aliases; $configured):
      [$aliases[] | select(.region == $configured) | .replacementRegion] as $matches
      | if ($matches | length) == 0 then $configured
        elif ($matches | length) == 1 then $matches[0]
        else null end;
    .meta.serviceManifest.deploy as $deploy
    | (.meta.deprecatedRegions // []) as $aliases
    # Older immutable manifests record one explicit region and replica count.
    # Never let legacy fields override an invalid or empty modern map.
    | ($deploy
        | if type != "object" then null
          elif .multiRegionConfig != null then .multiRegionConfig
          elif (.region | type) == "string" and (.region | length) > 0
            then {(.region): {numReplicas: .numReplicas}}
          else null end) as $config
    | if ($config | type) != "object" or ($aliases | type) != "array" then false
      else
        [$config | to_entries[] | select(.value != null)] as $placements
        | ($placements | length) > 0
          and all($placements[];
            . as $placement
            | (.value.numReplicas | type) == "number"
              and .value.numReplicas > 0
              and .value.numReplicas == (.value.numReplicas | floor)
              and runtime_region($aliases; $placement.key) == $expected)
      end
  ' >/dev/null <<<"$deployment"; then
    echo "[railway-release] $service: active deployment has missing, ambiguous or non-$RAILWAY_EXPECTED_REGION placement evidence" >&2
    return 1
  fi
  echo "[railway-release] $service: active deployment region $RAILWAY_EXPECTED_REGION (Railway manifest)"
}

existing_service_snapshot() {
  local service="$1"
  timeout 45 railway status \
    --project "$RAILWAY_PROJECT_ID" \
    --environment "$RAILWAY_ENVIRONMENT" \
    --json | jq -ce \
      --arg project "$RAILWAY_PROJECT_ID" \
      --arg environment "$RAILWAY_ENVIRONMENT" \
      --arg service "$service" '
        select(.id == $project)
        | [.environments.edges[].node
            | select(.id == $environment or .name == $environment)]
        | select(length == 1) | .[0] as $environment
        | [$environment.serviceInstances.edges[].node
            | select((.serviceName == $service or .serviceId == $service)
              and .environmentId == $environment.id)]
        | select(length == 1) | .[0]
      '
}

wait_for_existing_success() {
  local service="$1"
  local deadline=$((SECONDS + GATE_TIMEOUT_SECONDS))
  local deployment_id=""
  local status=""

  while (( SECONDS < deadline )); do
    local snapshot deployment deployments
    if snapshot="$(existing_service_snapshot "$service" 2>/dev/null)"; then
      deployment_id="$(jq -r '.latestDeployment.id // empty' <<<"$snapshot")"
      status="$(jq -r '.latestDeployment.status // empty' <<<"$snapshot")"
      echo "[railway-release] $service existing deployment ${deployment_id:-<none>}: ${status:-not-listed}"
      # A watch-path SKIPPED record did not replace the running deployment.
      # Never fall back past failed, crashed or pending real deployments.
      if [[ "$status" == SUCCESS || "$status" == SKIPPED ]]; then
        if ! deployments="$(deployment_list "$service" 1000 2>/dev/null)"; then
          sleep "$POLL_SECONDS"
          continue
        fi
        # Check history as well: a SKIPPED record may follow a failed rollout.
        # Require the newest actual deployment, not any older success.
        local actual_id actual_status
        actual_id="$(jq -r '[.[] | select(.status != "SKIPPED")][0].id // empty' <<<"$deployments")"
        actual_status="$(jq -r '[.[] | select(.status != "SKIPPED")][0].status // empty' <<<"$deployments")"
        if is_terminal_failure "$actual_status"; then
          dump_diagnostics "$service" "$actual_id"
          return 1
        fi
        if deployment="$(jq -ce '
          .activeDeployments | select(type == "array" and length == 1) | .[0]
          | select(.status == "SUCCESS" and .deploymentStopped == false
            and (.id | type == "string" and length > 0)
            and (.instances | type == "array"))
          | .instances |= map(select(.status != "REMOVED" and .status != "REMOVING"))
          | select(.instances | length > 0 and all(.[]; .status == "RUNNING"))
        ' <<<"$snapshot")"; then
          if [[ "$actual_status" == SUCCESS && "$(jq -r '.id' <<<"$deployment")" == "$actual_id" &&
                ( "$status" == SKIPPED || "$actual_id" == "$deployment_id" ) ]]; then
            verify_runtime_region "$service" "$deployment" || return 1
            return
          fi
        fi
      fi
      if [[ "$status" != SKIPPED ]] && is_terminal_failure "$status"; then
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

redeploy_source_one() {
  local service="$1"
  : "${RUST_RUNTIME_IMAGE:?RUST_RUNTIME_IMAGE is required}"
  promote_image_one "$service" "$RUST_RUNTIME_IMAGE"
}

promote_image_one() {
  local service="$1"
  local image="$2"
  [[ "$image" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] \
    || die "promote-image requires an immutable GHCR digest"
  local before_ids service_id
  if ! service_id="$(resolve_service_id "$service")"; then
    dump_diagnostics "$service"
    return 1
  fi
  before_ids="$(deployment_list "$service" | jq -c 'map(.id)')"

  # Request an image-only source in one environment-scoped patch. The CLI may
  # omit null repository selectors, so the applied source must be read back
  # before a retry. A repository-connected service needs a native source switch
  # first. Piped JSON also keeps this safe in a non-TTY CI runner.
  local source_patch edit_result
  source_patch="$(jq -cn \
    --arg service_id "$service_id" \
    --arg image "$image" \
    '{services: {($service_id): {source: {
      image: $image,
      repo: null,
      branch: null,
      commitSha: null,
      upstreamUrl: null
    }}}}')"

  echo "[railway-release] $service: switching source to immutable release image"
  if ! edit_result="$(printf '%s\n' "$source_patch" | timeout "$UPLOAD_TIMEOUT_SECONDS" \
    railway environment edit \
      --project "$RAILWAY_PROJECT_ID" \
      --environment "$RAILWAY_ENVIRONMENT" \
      --message "promote release image ($service)" \
      --json)"; then
    dump_diagnostics "$service"
    return 1
  fi

  if ! jq -e \
    '(.committed == true and .staged == true) or
     (.committed == false and .staged == false)' \
    >/dev/null <<<"$edit_result"; then
    echo "[railway-release] $service: environment source edit returned an invalid result" >&2
    dump_diagnostics "$service"
    return 1
  fi

  # A committed patch can still be an unchanged source and create no deployment.
  # Verify the applied image-only source before any explicit retry; null repo
  # selectors in a patch do not prove that Railway detached a repository.
  local snapshot deployment_id="" retry_result
  if ! snapshot="$(existing_service_snapshot "$service_id")" ||
      ! jq -e --arg image "$image" \
        '.source.image == $image and (.source.repo == null or .source.repo == "")' \
        >/dev/null <<<"$snapshot"; then
    echo "[railway-release] $service: applied source does not match the requested image-only configuration" >&2
    dump_diagnostics "$service"
    return 1
  fi

  if jq -e --arg image "$image" --argjson before "$before_ids" '
      .latestDeployment as $latest
      | $latest.status == "SUCCESS" and $latest.canRedeploy == true
        and $latest.meta.image == $image
        and ($before | index($latest.id)) != null
    ' >/dev/null <<<"$snapshot"; then
    # The CLI redeploys its latest deployment by default. Only use this path
    # when that existing deployment is already the exact requested digest.
    echo "[railway-release] $service: unchanged deployed image; forcing an exact-image retry"
    if ! retry_result="$(timeout "$UPLOAD_TIMEOUT_SECONDS" railway redeploy \
      --project "$RAILWAY_PROJECT_ID" \
      --environment "$RAILWAY_ENVIRONMENT" \
      --service "$service_id" \
      --yes \
      --json)" || ! deployment_id="$(jq -er --argjson before "$before_ids" '
        .id | select(type == "string" and length > 0)
        | select(. as $id | ($before | index($id)) == null)
      ' <<<"$retry_result")"; then
      dump_diagnostics "$service"
      return 1
    fi
  elif [[ "$(jq -r '.committed' <<<"$edit_result")" != true ]] &&
      ! jq -e --argjson before "$before_ids" '
        .latestDeployment.id | select(type == "string" and length > 0)
        | select(. as $id | ($before | index($id)) == null)
      ' >/dev/null <<<"$snapshot"; then
    echo "[railway-release] $service: source already matched; deploying the verified image source"
    if ! timeout "$UPLOAD_TIMEOUT_SECONDS" railway redeploy \
      --project "$RAILWAY_PROJECT_ID" \
      --environment "$RAILWAY_ENVIRONMENT" \
      --service "$service_id" \
      --from-source --yes --json >/dev/null; then
      dump_diagnostics "$service"
      return 1
    fi
  fi

  if [[ -z "$deployment_id" ]] &&
      ! deployment_id="$(wait_for_new_deployment "$service" "$before_ids")"; then
    echo "[railway-release] $service: source promotion returned but no new deployment appeared" >&2
    dump_diagnostics "$service"
    return 1
  fi
  wait_for_terminal_success "$service" "$deployment_id"

  local observed_image
  observed_image="$(deployment_image "$service" "$deployment_id")"
  if [[ "$observed_image" != "$image" ]]; then
    echo "[railway-release] $service: expected image $image, observed ${observed_image:-<empty>}" >&2
    dump_diagnostics "$service" "$deployment_id"
    return 1
  fi
  echo "[railway-release] $service: verified image $observed_image"
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

redeploy_storage() {
  local service="$1"
  redeploy_source_one "$service"

  local deployment_id
  deployment_id="$(deployment_list "$service" | jq -r '.[0].id // empty')"
  [[ -n "$deployment_id" ]] || die "$service has no deployment after image redeploy"
  wait_for_log_marker "$service" \
    'PostgreSQL storage migrations applied and verified successfully' \
    "$deployment_id"
}

promote_publisher() {
  local service="$1"
  : "${STDB_PUBLISHER_IMAGE:?STDB_PUBLISHER_IMAGE is required}"
  promote_image_one "$service" "$STDB_PUBLISHER_IMAGE"
  local deployment_id
  deployment_id="$(deployment_list "$service" | jq -r '.[0].id // empty')"
  [[ -n "$deployment_id" ]] || die "$service has no publisher deployment"
  wait_for_log_marker "$service" \
    'SpacetimeDB publish and schema verification passed' "$deployment_id"
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
    redeploy-source)
      (( $# > 0 )) || die "redeploy-source requires at least one service"
      # Source edits commit environment patches; serialize those writes.
      for service in "$@"; do
        redeploy_source_one "$service"
      done
      ;;
    promote-image)
      [[ $# -eq 2 ]] || die "promote-image requires one service and image"
      promote_image_one "$1" "$2"
      ;;
    promote-publisher)
      [[ $# -eq 1 ]] || die "promote-publisher requires one publisher service"
      promote_publisher "$1"
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
    redeploy-storage)
      [[ $# -eq 1 ]] || die "redeploy-storage requires exactly one migration service"
      redeploy_storage "$1"
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

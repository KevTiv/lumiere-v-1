#!/usr/bin/env bash
set -Eeuo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly MANIFEST="${1:-$ROOT/infra/railway/production-eu-services.json}"

die() {
  echo "[railway-preflight] ERROR: $*" >&2
  exit 1
}

for command in railway jq; do
  command -v "$command" >/dev/null 2>&1 || die "$command is required"
done

: "${RAILWAY_PROJECT_ID:?RAILWAY_PROJECT_ID is required}"
: "${RAILWAY_ENVIRONMENT:?RAILWAY_ENVIRONMENT is required}"
: "${RAILWAY_EXPECTED_REGION:?RAILWAY_EXPECTED_REGION is required}"

[[ -f "$MANIFEST" ]] || die "deployment manifest not found: $MANIFEST"
jq -e '.schemaVersion == 1 and (.services | type == "array")' "$MANIFEST" >/dev/null \
  || die "deployment manifest is invalid"

manifest_project="$(jq -r '.projectId' "$MANIFEST")"
manifest_environment="$(jq -r '.environment' "$MANIFEST")"
manifest_region="$(jq -r '.expectedRegion' "$MANIFEST")"
[[ "$RAILWAY_PROJECT_ID" == "$manifest_project" ]] \
  || die "manifest project does not match RAILWAY_PROJECT_ID"
[[ "$RAILWAY_ENVIRONMENT" == production && "$RAILWAY_ENVIRONMENT" == "$manifest_environment" ]] \
  || die "this manifest is production-only; development provisioning is deferred"
[[ "$RAILWAY_EXPECTED_REGION" == "$manifest_region" ]] \
  || die "manifest region does not match RAILWAY_EXPECTED_REGION"

services_json="$(railway service list \
  --project "$RAILWAY_PROJECT_ID" \
  --environment "$RAILWAY_ENVIRONMENT" \
  --json)"

failures=0
while IFS= read -r service; do
  name="$(jq -r '.name' <<<"$service")"
  required="$(jq -r 'if has("required") then .required else true end' <<<"$service")"
  feature_gate="$(jq -r '.featureGate // empty' <<<"$service")"
  if [[ -n "$feature_gate" ]]; then
    if [[ "${!feature_gate-}" != true ]]; then
      echo "[railway-preflight] optional production service is disabled: $name"
      continue
    fi
    required=true
  fi
  matches="$(jq --arg name "$name" '[.[] | select(.name == $name)] | length' <<<"$services_json")"
  if [[ "$matches" != 1 ]]; then
    if [[ "$required" == false && "$matches" == 0 ]]; then
      echo "[railway-preflight] optional production service is absent: $name"
      continue
    fi
    echo "[railway-preflight] missing or ambiguous production service: $name" >&2
    failures=$((failures + 1))
    continue
  fi

  if ! jq -e --arg name "$name" --arg region "$manifest_region" '
    [.[] | select(.name == $name)][0].regions as $regions
    | ($regions | length) > 0
      and all($regions[]; .name == $region and .configured > 0)
  ' >/dev/null <<<"$services_json"; then
    echo "[railway-preflight] $name has no active EU replica in $manifest_region" >&2
    failures=$((failures + 1))
  fi

  max_replicas="$(jq -r '.maxReplicas // .localStorage.maxReplicas // empty' <<<"$service")"
  if [[ -n "$max_replicas" ]] && ! jq -e --arg name "$name" --argjson maximum "$max_replicas" '
    [.[] | select(.name == $name)][0].regions
    | (map(.configured) | add) as $total
    | $total >= 1 and $total <= $maximum
  ' >/dev/null <<<"$services_json"; then
    if [[ "$(jq -r '.localStorage.maxReplicas // empty' <<<"$service")" != "" ]]; then
      echo "[railway-preflight] $name local document storage requires at most $max_replicas configured replica(s)" >&2
    else
      echo "[railway-preflight] $name profile admission requires at most $max_replicas configured replica(s)" >&2
    fi
    failures=$((failures + 1))
  fi

  if [[ "$(jq '(.requiredVariables // {} | length) + (.optionalFeatures // [] | length)' <<<"$service")" == 0 ]]; then
    continue
  fi

  # JSON output can contain secret values. Keep it captured and report names
  # only; sealed variables are represented as null and still count as set.
  variables_json="$(railway variable list \
    --project "$RAILWAY_PROJECT_ID" \
    --environment "$RAILWAY_ENVIRONMENT" \
    --service "$name" \
    --json)"

  requirements="$(jq -c '.requiredVariables // {}' <<<"$service")"
  while IFS= read -r feature; do
    feature_name="$(jq -r '.name' <<<"$feature")"
    selection_variable="$(jq -r '.selectionVariable' <<<"$feature")"
    selection="${!selection_variable-}"
    if [[ -n "$selection" && "$selection" != true && "$selection" != false ]]; then
      die "$selection_variable must be true or false"
    fi
    configured=false
    jq -e --argjson keys "$(jq '.configuredVariables' <<<"$feature")" '
      . as $variables | any($keys[]; . as $key |
        $variables | has($key) and (.[$key] == null or .[$key] != ""))
    ' >/dev/null <<<"$variables_json" && configured=true
    if [[ "$selection" != true && "$configured" != true ]]; then
      echo "[railway-preflight] optional $name feature is unconfigured: $feature_name"
      continue
    fi
    requirements="$(jq -c --argjson feature "$feature" '. + $feature.requiredVariables' <<<"$requirements")"
    while IFS= read -r pair; do
      first="$(jq -r '.[0]' <<<"$pair")"
      second="$(jq -r '.[1]' <<<"$pair")"
      if jq -e --arg first "$first" --arg second "$second" '
        .[$first] != null and .[$first] != "" and .[$first] == .[$second]
      ' >/dev/null <<<"$variables_json"; then
        echo "[railway-preflight] $name requires distinct $first and $second" >&2
        failures=$((failures + 1))
      fi
    done < <(jq -c '.distinctSecrets // [] | .[]' <<<"$feature")
  done < <(jq -c '.optionalFeatures // [] | .[]' <<<"$service")

  while IFS= read -r requirement; do
    variable="$(jq -r '.key' <<<"$requirement")"
    kind="$(jq -r '.value.kind' <<<"$requirement")"
    expected="$(jq -r '.value.value // empty' <<<"$requirement")"

    valid=false
    case "$kind" in
      empty)
        jq -e --arg key "$variable" 'has($key) | not' >/dev/null <<<"$variables_json" && valid=true
        jq -e --arg key "$variable" '.[$key] == ""' >/dev/null <<<"$variables_json" && valid=true
        ;;
      exact)
        jq -e --arg key "$variable" --arg expected "$expected" \
          'has($key) and .[$key] == $expected' >/dev/null <<<"$variables_json" && valid=true
        ;;
      secret)
        jq -e --arg key "$variable" '
          has($key) and
          (.[$key] == null or
           (.[$key] | type == "string" and length >= 32 and
            (test("replace|placeholder|local-dev|not-a-real|fake|changeme"; "i") | not)))
        ' >/dev/null <<<"$variables_json" && valid=true
        ;;
      positive-id-list)
        jq -e --arg key "$variable" '
          has($key) and (.[$key] | type == "string" and test("^[1-9][0-9]*(,[1-9][0-9]*)*$"))
        ' >/dev/null <<<"$variables_json" && valid=true
        ;;
      positive-integer)
        jq -e --arg key "$variable" '
          has($key) and (.[$key] | type == "string" and test("^[1-9][0-9]*$"))
        ' >/dev/null <<<"$variables_json" && valid=true
        ;;
      url)
        jq -e --arg key "$variable" '
          has($key) and (.[$key] | type == "string" and
            test("^https?://") and
            (test("localhost|127\\.0\\.0\\.1|replace|placeholder"; "i") | not))
        ' >/dev/null <<<"$variables_json" && valid=true
        ;;
      email)
        jq -e --arg key "$variable" '
          has($key) and (.[$key] | type == "string" and length <= 320 and
            test("^[^<>\\r\\n]*<?[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}>?$") and
            (test("replace|placeholder|localhost|example\\.com|resend\\.dev"; "i") | not))
        ' >/dev/null <<<"$variables_json" && valid=true
        ;;
      non-placeholder)
        jq -e --arg key "$variable" '
          has($key) and (.[$key] | type == "string" and length > 0 and
            (test("replace|placeholder|local-dev|not-a-real|fake|changeme"; "i") | not))
        ' >/dev/null <<<"$variables_json" && valid=true
        ;;
      *)
        die "unsupported variable requirement kind '$kind' for $name/$variable"
        ;;
    esac

    if [[ "$valid" != true ]]; then
      echo "[railway-preflight] $name is missing or has invalid $variable ($kind)" >&2
      failures=$((failures + 1))
    fi
  done < <(jq -c 'to_entries[]' <<<"$requirements")
done < <(jq -c '.services[]' "$MANIFEST")

(( failures == 0 )) || die "$failures production topology requirement(s) failed"
echo "[railway-preflight] production EU service topology and worker configuration passed"

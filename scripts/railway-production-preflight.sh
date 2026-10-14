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

  if [[ "$(jq '.requiredVariables // {} | length' <<<"$service")" == 0 ]]; then
    continue
  fi

  # JSON output can contain secret values. Keep it captured and report names
  # only; sealed variables are represented as null and still count as set.
  variables_json="$(railway variable list \
    --project "$RAILWAY_PROJECT_ID" \
    --environment "$RAILWAY_ENVIRONMENT" \
    --service "$name" \
    --json)"

  while IFS= read -r requirement; do
    variable="$(jq -r '.key' <<<"$requirement")"
    kind="$(jq -r '.value.kind' <<<"$requirement")"
    expected="$(jq -r '.value.value // empty' <<<"$requirement")"

    valid=false
    case "$kind" in
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
  done < <(jq -c '.requiredVariables // {} | to_entries[]' <<<"$service")
done < <(jq -c '.services[]' "$MANIFEST")

(( failures == 0 )) || die "$failures production topology requirement(s) failed"
echo "[railway-preflight] production EU service topology and worker configuration passed"

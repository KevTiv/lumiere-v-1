#!/usr/bin/env bash
set -euo pipefail

[[ "$#" -eq 2 ]] || {
  echo "usage: $0 IMAGE SYNTHETIC_MODULE_WASM" >&2
  exit 2
}

image_id="$(docker image inspect --format '{{.Id}}' "$1")"
fixture="$(realpath -e -- "$2")"
test_dir="$(mktemp -d)"
test_name="lumiere-stdb-recovery-${test_dir##*.}"
source_container="$test_name-source"
target_container="$test_name-target"
source_volume="$test_name-source-data"
target_volume="$test_name-target-data"
backup_volume="$test_name-backups"
pinned_image="local/lumiere-stdb-recovery@$image_id"
module_revision="$(printf '%040d' 1)"
host="http://127.0.0.1:3000"
database="lumiere-physical-recovery-test"
cli=(spacetime --config-path /tmp/test-cli.toml)

cleanup() {
  if [[ "$?" -ne 0 ]]; then
    docker logs "$source_container" >&2 || true
    docker logs "$target_container" >&2 || true
  fi
  docker rm --force "$source_container" "$target_container" >/dev/null 2>&1 || true
  docker volume rm "$source_volume" "$target_volume" "$backup_volume" >/dev/null 2>&1 || true
  rmdir "$test_dir"
}
trap cleanup EXIT

backup_mount="type=volume,src=$backup_volume,dst=/backup"
docker run --rm --network none --mount "$backup_mount" \
  --entrypoint age-keygen "$image_id" -o /backup/test-identity
recipient="$(docker run --rm --network none --mount "$backup_mount,readonly" \
  --entrypoint age-keygen "$image_id" -y /backup/test-identity)"

docker run --detach --network none --name "$source_container" \
  --mount "type=volume,src=$source_volume,dst=/data" \
  --mount "$backup_mount" \
  --mount "type=bind,src=$fixture,dst=/fixture.wasm,readonly" \
  --env STDB_BACKUP_DESTINATION=/backup \
  --env "STDB_BACKUP_AGE_RECIPIENT=$recipient" \
  --env "STDB_BACKUP_IMAGE=$pinned_image" \
  "$image_id" >/dev/null

wait_ready() {
  local container="$1" attempt
  for ((attempt = 0; attempt < 90; attempt++)); do
    if docker exec "$container" curl --fail --silent --max-time 1 \
      -X POST "$host/v1/identity" >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done
  echo "SpacetimeDB did not become ready in $container" >&2
  return 1
}

query_fixture() {
  docker exec "$1" curl --fail-with-body --silent --show-error \
    -H 'Content-Type: text/plain' \
    --data-binary 'SELECT organization_id, pack_key FROM country_pack_definition' \
    "$host/v1/database/$database/sql" \
    | jq --compact-output --exit-status '.[0].rows'
}

wait_ready "$source_container"
docker exec "$source_container" "${cli[@]}" publish "$database" \
  --bin-path /fixture.wasm --server "$host" --delete-data=never \
  --yes=remote,migrate,break-clients,skip-login --no-config
before="$(query_fixture "$source_container")"
jq --exit-status 'length == 1 and (.[0][0] | tostring) == "42" and .[0][1] == "legacy-pack_key"' \
  <<<"$before" >/dev/null

docker exec "$source_container" python3 /usr/local/lib/lumiere/railway-stdb-supervisor.py \
  request "$module_revision"

capture_completed=false
for ((attempt = 0; attempt < 150; attempt++)); do
  log="$(docker logs "$source_container" 2>&1)"
  if [[ "$log" == *"capture completed"* && "$log" == *"writer restarted"* ]]; then
    capture_completed=true
    break
  fi
  if [[ "$log" == *"capture failed"* || "$log" == *"capture refused"* || "$log" == *"preflight failed"* ]]; then
    echo "Synthetic backup failed" >&2
    exit 1
  fi
  sleep 1
done
"$capture_completed"
wait_ready "$source_container"
[[ "$(query_fixture "$source_container")" == "$before" ]]
manifest="$(docker exec "$source_container" find /backup/physical -name manifest.json -print -quit)"
[[ -n "$manifest" ]]
archive="${manifest%/*}/data.tar.gz.age"

docker run --rm --network none \
  --mount "type=volume,src=$target_volume,dst=/data" \
  --mount "$backup_mount,readonly" \
  --env STDB_RECOVERY_ISOLATED=1 \
  --env "STDB_RECOVERY_IMAGE=$pinned_image" \
  --entrypoint /bin/sh "$image_id" -ceu '
    python3 /usr/local/lib/lumiere/railway-stdb-restore.py \
      "$1" "$2" /backup/test-identity /data/restored
    test ! -e /data/restored/auth
  ' restore "$manifest" "$archive"

docker run --detach --network none --name "$target_container" \
  --mount "type=volume,src=$target_volume,dst=/data" \
  --env STDB_DATA_DIR=/data/restored \
  "$image_id" >/dev/null
wait_ready "$target_container"
[[ "$(query_fixture "$target_container")" == "$before" ]]
echo "Verified the restarted source and the recovered SpacetimeDB fixture row"

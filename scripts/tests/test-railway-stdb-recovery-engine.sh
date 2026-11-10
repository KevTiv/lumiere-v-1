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
bucket_container="$test_name-s3"
backup_network="$test_name-backup-network"
bucket_name="lumiere-backups"
bucket_endpoint="http://s3.test:9000"
pinned_image="local/lumiere-stdb-recovery@$image_id"
module_revision="$(printf '%040d' 1)"
host="http://127.0.0.1:3000"
database="lumiere-physical-recovery-test"
cli=(spacetime --config-path /tmp/test-cli.toml)
bucket_env=(
  --env RCLONE_CONFIG_BACKUP_TYPE=s3
  --env RCLONE_CONFIG_BACKUP_PROVIDER=Other
  --env "RCLONE_CONFIG_BACKUP_ENDPOINT=$bucket_endpoint"
  --env RCLONE_CONFIG_BACKUP_REGION=us-east-1
  --env RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID=fixture-access
  --env RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY=fixture-secret
  --env RCLONE_CONFIG_BACKUP_FORCE_PATH_STYLE=false
)
destination="backup:$bucket_name/production"

cleanup() {
  if [[ "$?" -ne 0 ]]; then
    docker logs "$source_container" >&2 || true
    docker logs "$target_container" >&2 || true
    docker logs "$bucket_container" >&2 || true
  fi
  docker rm --force "$source_container" "$target_container" "$bucket_container" >/dev/null 2>&1 || true
  docker volume rm "$source_volume" "$target_volume" "$backup_volume" >/dev/null 2>&1 || true
  docker network rm "$backup_network" >/dev/null 2>&1 || true
  rmdir "$test_dir"
}
trap cleanup EXIT

backup_mount="type=volume,src=$backup_volume,dst=/backup"
docker run --rm --network none --mount "$backup_mount" \
  --entrypoint age-keygen "$image_id" -o /backup/test-identity
recipient="$(docker run --rm --network none --mount "$backup_mount,readonly" \
  --entrypoint age-keygen "$image_id" -y /backup/test-identity)"

docker network create --internal "$backup_network" >/dev/null
docker run --detach --name "$bucket_container" --network "$backup_network" \
  --network-alias s3.test --network-alias "$bucket_name.s3.test" \
  --env MINIO_DOMAIN=s3.test --env MINIO_ROOT_USER=fixture-access \
  --env MINIO_ROOT_PASSWORD=fixture-secret \
  quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z server /data >/dev/null
docker run --rm --network "$backup_network" "${bucket_env[@]}" \
  --entrypoint /bin/sh "$image_id" -ceu '
    for attempt in $(seq 1 30); do
      if curl -fsS --max-time 1 "$1/minio/health/ready" >/dev/null 2>&1; then
        exec rclone mkdir "backup:$2"
      fi
      sleep 1
    done
    echo "Synthetic backup bucket did not become ready" >&2
    exit 1
  ' bucket "$bucket_endpoint" "$bucket_name"

docker run --detach --network "$backup_network" --name "$source_container" \
  --mount "type=volume,src=$source_volume,dst=/data" \
  --mount "type=bind,src=$fixture,dst=/fixture.wasm,readonly" \
  "${bucket_env[@]}" --env RCLONE_CONFIG_BACKUP_NO_CHECK_BUCKET=true \
  --env "STDB_BACKUP_DESTINATION=$destination" \
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
docker run --rm --network "$backup_network" "${bucket_env[@]}" \
  --mount "$backup_mount" --entrypoint rclone "$image_id" copy "$destination/physical" /backup/physical
manifest="$(docker run --rm --network none --mount "$backup_mount,readonly" \
  --entrypoint find "$image_id" /backup/physical -name manifest.json -print -quit)"
[[ "$manifest" == /backup/physical/*/manifest.json ]]
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
echo "Verified S3 capture, the restarted source, and the recovered SpacetimeDB fixture row"

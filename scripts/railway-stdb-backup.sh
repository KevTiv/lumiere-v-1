#!/usr/bin/env bash
set -euo pipefail
umask 077

die() {
  printf 'stdb-backup: %s\n' "$*" >&2
  exit 1
}

preflight=false
if [[ "${1:-}" == --preflight ]]; then
  preflight=true
  shift
fi
[[ "$#" -eq 1 && "$1" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$ ]] || \
  die 'usage: railway-stdb-backup.sh [--preflight] BACKUP_ID'

backup_id="$1"
destination="${STDB_BACKUP_DESTINATION:?Set STDB_BACKUP_DESTINATION}"
recipient="${STDB_BACKUP_AGE_RECIPIENT:?Set STDB_BACKUP_AGE_RECIPIENT}"
image="${STDB_BACKUP_IMAGE:?Set STDB_BACKUP_IMAGE}"
module_revision="${STDB_BACKUP_MODULE_REVISION:?Set STDB_BACKUP_MODULE_REVISION}"
engine_version="${STDB_BACKUP_ENGINE_VERSION:-2.8.2}"
[[ "$image" =~ ^[a-zA-Z0-9][a-zA-Z0-9./:_-]*@sha256:[0-9a-f]{64}$ ]] || \
  die 'STDB_BACKUP_IMAGE must pin an image by SHA-256 digest'
[[ "$module_revision" =~ ^[0-9a-f]{40}$ ]] || die 'STDB_BACKUP_MODULE_REVISION must be a full Git commit SHA'
[[ "$engine_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die 'invalid STDB_BACKUP_ENGINE_VERSION'

for command_name in age flock jq rclone realpath sha256sum stat tar; do
  command -v "$command_name" >/dev/null || die "required command is unavailable: $command_name"
done

data_dir="$(realpath -e -- "${STDB_DATA_DIR:-/data}")" || die 'source data directory does not exist'
[[ "$data_dir" != / && -s "$data_dir/metadata.toml" && -d "$data_dir/replicas" ]] || \
  die 'source is missing SpacetimeDB metadata.toml or replicas'
if [[ -n "${RAILWAY_ENVIRONMENT_ID:-}" ]]; then
  volume_dir="$(realpath -e -- "${RAILWAY_VOLUME_MOUNT_PATH:?Railway data volume is required}")"
  mountpoint -q -- "$volume_dir" || die 'Railway data volume is not mounted'
  [[ "$data_dir" == "$volume_dir" || "$data_dir" == "$volume_dir/"* ]] || \
    die 'SpacetimeDB source is outside the Railway volume'
fi

backup_prefix="physical/$backup_id"
object_key="$backup_prefix/data.tar.gz.age"
manifest_key="$backup_prefix/manifest.json"
if [[ "$destination" != *:* ]]; then
  destination="$(realpath -e -- "$destination")" || die 'local backup destination does not exist'
  [[ -d "$destination" ]] || die 'local backup destination must be a directory'
  local_backup_dir="$(realpath -m -- "$destination/$backup_prefix")"
  [[ "$local_backup_dir" != "$data_dir" && "$local_backup_dir" != "$data_dir/"* ]] || \
    die 'backup destination must be outside the source data directory'
fi
destination="${destination%/}"

check_destination() {
  local existing
  existing="$(rclone lsf "$destination" --recursive --files-only --include "/$backup_prefix/**")" || \
    die 'could not list backup destination'
  [[ -z "$existing" ]] || die 'backup ID is already in use, choose a new one'
}

age --encrypt --recipient "$recipient" </dev/null >/dev/null || die 'invalid age recipient'
if "$preflight"; then
  check_destination
  printf 'stdb-backup: preflight passed for %s\n' "$backup_id"
  exit 0
fi

# This guard supplements the supervisor's clean shutdown. SpacetimeDB 2.8.2
# locks this same file before opening its control database or replica data.
lock_path="$data_dir/spacetime.pid"
[[ ! -L "$lock_path" && ( ! -e "$lock_path" || -f "$lock_path" ) ]] || die 'unsafe writer lock path'
exec {lock_fd}<>"$lock_path"
flock --exclusive --nonblock "$lock_fd" || die 'database writer is still running'
lock_fd_path="/proc/$$/fd/$lock_fd"
lock_identity="$(stat -Lc '%d:%i' -- "$lock_fd_path")"
[[ "$(stat -Lc '%d:%i' -- "$lock_path")" == "$lock_identity" ]] || die 'database writer lock moved, retry after shutdown'
if [[ "$(stat -Lc '%u:%g' -- "$lock_fd_path")" != "$(stat -c '%u:%g' -- "$data_dir")" ]]; then
  chown --reference="$data_dir" -- "$lock_fd_path"
fi

check_destination
unexpected_entry="$(find "$data_dir" -mindepth 1 ! -type d ! -type f -print -quit)"
[[ -z "$unexpected_entry" ]] || die 'source contains a symbolic link or special file'
captured_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

scratch_root="$(realpath -e -- "${TMPDIR:-/tmp}")"
[[ "$scratch_root" != "$data_dir" && "$scratch_root" != "$data_dir/"* ]] || \
  die 'temporary directory must be outside the source data directory'
scratch="$(mktemp -d "$scratch_root/stdb-backup.XXXXXXXX")"
digest_pid=''
cleanup() {
  if [[ -n "$digest_pid" ]]; then
    kill "$digest_pid" 2>/dev/null || true
    wait "$digest_pid" 2>/dev/null || true
  fi
  rm -rf -- "$scratch"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkfifo "$scratch/ciphertext"
sha256sum <"$scratch/ciphertext" >"$scratch/digest" &
digest_pid=$!

if ! tar --create --gzip --file=- --directory="$data_dir" --exclude=./spacetime.pid . \
  | age --encrypt --recipient "$recipient" \
  | tee --output-error=exit "$scratch/ciphertext" \
  | rclone rcat "$destination/$object_key" --immutable; then
  die 'encrypted backup upload failed'
fi
wait "$digest_pid" || die 'could not checksum encrypted stream'
digest_pid=''
read -r archive_digest _ <"$scratch/digest"

remote_digest="$(rclone cat "$destination/$object_key" | sha256sum)" || die 'could not read back encrypted backup'
[[ "${remote_digest%% *}" == "$archive_digest" ]] || die 'backup checksum differs after upload'
size_bytes="$(rclone lsjson --stat "$destination/$object_key" | jq -er '.Size | select(type == "number" and floor == . and . > 0)')" || \
  die 'could not read back backup size'
[[ "$(stat -Lc '%d:%i' -- "$lock_path")" == "$lock_identity" ]] || die 'database writer lock moved during capture'

# An archive without this final manifest is never eligible for a restore.
if ! jq -n \
  --arg format lumiere-spacetimedb-physical-v1 \
  --arg backup_id "$backup_id" --arg captured_at "$captured_at" \
  --arg image "$image" --arg engine_version "$engine_version" --arg module_revision "$module_revision" \
  --arg object_key "$object_key" --arg sha256 "$archive_digest" --argjson size_bytes "$size_bytes" \
  '{format: $format, backup_id: $backup_id, captured_at: $captured_at, image: $image,
    engine_version: $engine_version, module_revision: $module_revision, object_key: $object_key,
    sha256: $sha256, size_bytes: $size_bytes}' \
  | rclone rcat "$destination/$manifest_key" --immutable; then
  die 'could not publish backup manifest'
fi
printf 'stdb-backup: verified %s (%s bytes)\n' "$backup_id" "$size_bytes"

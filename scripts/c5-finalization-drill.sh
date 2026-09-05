#!/usr/bin/env bash
# Run the ignored live C5 finalization drill against an already-running module.
# This never publishes or resets SpacetimeDB. PostgreSQL is created and dropped
# by the test itself, so a failed run may only leave its uniquely named drill DB.
# The STDB target must be loopback, explicitly acknowledged as disposable, and
# named with the `lumiere-c5-` prefix because the drill replaces service bindings
# and creates then finalizes one POS aggregate.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

required=(C5_DISPOSABLE_STDB C5_STDB_ADMIN_TOKEN C5_STDB_WORKER_TOKEN STDB_HOST STDB_MODULE)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "[c5-drill] $name is required; refusing to run" >&2
    exit 2
  fi
done

if [[ "${C5_DISPOSABLE_STDB}" != "1" ]]; then
  echo "[c5-drill] C5_DISPOSABLE_STDB=1 is required; refusing to mutate the target module" >&2
  exit 2
fi
case "${STDB_HOST}" in
  http://127.0.0.1|http://127.0.0.1:*|http://localhost|http://localhost:*) ;;
  *) echo "[c5-drill] STDB_HOST must be loopback for this disposable drill" >&2; exit 2 ;;
esac
if [[ "${STDB_MODULE}" != lumiere-c5-* ]]; then
  echo "[c5-drill] STDB_MODULE must use the disposable 'lumiere-c5-' prefix" >&2
  exit 2
fi

if [[ "${C5_STDB_ADMIN_TOKEN}" == "${C5_STDB_WORKER_TOKEN}" ]]; then
  echo "[c5-drill] admin and worker tokens must be distinct; refusing to run" >&2
  exit 2
fi

# The reducer accepts the worker identity as a separate argument. Prefer an
# explicit value; local SpacetimeDB JWTs commonly carry it as `sub`, which can
# be derived without printing either credential when the claim is available.
if [[ -z "${C5_STDB_WORKER_IDENTITY:-}" ]]; then
  set +e
  C5_STDB_WORKER_IDENTITY="$(C5_STDB_WORKER_TOKEN="$C5_STDB_WORKER_TOKEN" node -e '
    const token = process.env.C5_STDB_WORKER_TOKEN ?? "";
    const part = token.split(".")[1];
    if (!part) process.exit(1);
    let payload;
    try { payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")); } catch { process.exit(1); }
    const identity = payload.sub ?? payload.identity;
    if (typeof identity !== "string" || !/^(0x)?[0-9a-fA-F]{64}$/.test(identity)) process.exit(1);
    process.stdout.write(identity);
  ')"
  set -e
fi
if [[ -z "${C5_STDB_WORKER_IDENTITY:-}" ]]; then
  echo "[c5-drill] C5_STDB_WORKER_IDENTITY is required (or must be derivable from the worker JWT); refusing to run" >&2
  exit 2
fi

export C5_FINALIZATION_DRILL=1
export C5_STDB_WORKER_IDENTITY

cd "$root"
cargo test -p api-server --lib c5_live_finalization_worker_drill -- \
  --ignored --nocapture

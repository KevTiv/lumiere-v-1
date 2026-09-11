#!/usr/bin/env bash
# Run the ignored live C5 finalization drill against an already-running module.
# This never publishes or resets SpacetimeDB. PostgreSQL is created and dropped
# by the test itself, so a failed run may only leave its uniquely named drill DB.
# The STDB target must be loopback, explicitly acknowledged as disposable, and
# named with a dedicated C5/C9 drill prefix because the drill replaces service
# bindings and creates then finalizes one POS aggregate.
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
if [[ "${STDB_MODULE}" != lumiere-c5-* && "${STDB_MODULE}" != lumiere-c9-* && "${STDB_MODULE}" != lumiere-c7-c9-* ]]; then
  echo "[c5-drill] STDB_MODULE must use a disposable C5 or C9 drill prefix" >&2
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

evidence_dir="${C9_FINALIZATION_EVIDENCE_DIR:-${TMPDIR:-/tmp}/lumiere-c9-finalization-evidence}"
mkdir -p "$evidence_dir"
log_file="$(mktemp "${TMPDIR:-/tmp}/lumiere-c9-finalization.XXXXXX.log")"
trap 'rm -f "$log_file"' EXIT

if [[ "${STDB_MODULE}" == lumiere-c9-* || "${STDB_MODULE}" == lumiere-c7-c9-* ]]; then
  if [[ "${C9_POST_RECONSTRUCTION:-}" != "1" ]]; then
    echo "[c9-drill] C9_POST_RECONSTRUCTION=1 is required to claim post-reconstruction evidence" >&2
    exit 2
  fi
  if [[ ! "${C9_PLACEMENT_GENERATION:-}" =~ ^[2-9][0-9]*$ ]]; then
    echo "[c9-drill] C9_PLACEMENT_GENERATION>=2 is required for authoritative post-reconstruction fencing evidence" >&2
    exit 2
  fi
  export C9_POST_RECONSTRUCTION
fi

cd "$root"
if ! cargo test -p api-server --lib c5_live_finalization_worker_drill -- \
  --ignored --nocapture 2>&1 | tee "$log_file"; then
  echo "[c5-drill] live finalization/projection/cold-read/hydration drill failed" >&2
  exit 1
fi

if [[ "${STDB_MODULE}" == lumiere-c9-* || "${STDB_MODULE}" == lumiere-c7-c9-* ]]; then
  blocked=0
  for lane in projection cold_reads hydration; do
    report_line="$(grep -F "C9_EVIDENCE:${lane}:" "$log_file" | tail -n 1 || true)"
    if [[ -z "$report_line" ]]; then
      echo "[c9-drill] missing machine-readable ${lane} evidence" >&2
      exit 1
    fi
    report="${report_line#C9_EVIDENCE:${lane}:}"
    report="$(printf '%s\n' "$report" | node -e '
      let input = "";
      process.stdin.on("data", chunk => { input += chunk; });
      process.stdin.on("end", () => {
        const report = JSON.parse(input);
        report.generated_at = new Date().toISOString();
        process.stdout.write(JSON.stringify(report));
      });
    ')"
    if ! printf '%s\n' "$report" | node -e '
      let input = "";
      process.stdin.on("data", chunk => { input += chunk; });
      process.stdin.on("end", () => {
        const report = JSON.parse(input);
        if (report.phase !== "post-reconstruction" || report.post_reconstruction !== true) {
          throw new Error("report is not post-reconstruction evidence");
        }
        if (!Array.isArray(report.checks) || report.checks.some(check => check.status !== "pass")) {
          throw new Error("report contains blocked or failed assertions");
        }
      });
    ' >/dev/null; then
      printf '%s\n' "$report" > "$evidence_dir/${lane}.json"
      echo "[c9-drill] ${lane} evidence contains a blocker; see $evidence_dir/${lane}.json" >&2
      blocked=1
      continue
    fi
    printf '%s\n' "$report" > "$evidence_dir/${lane}.json"
  done
  if [[ "$blocked" -ne 0 ]]; then
    echo "[c9-drill] live evidence was emitted, but one or more assertions remain blocked" >&2
    exit 1
  fi
  echo "[c9-drill] live projection/cold-read/hydration evidence written to $evidence_dir"
fi

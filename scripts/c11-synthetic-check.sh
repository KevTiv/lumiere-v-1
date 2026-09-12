#!/usr/bin/env bash
# C11 operator synthetic checks. Deep checks reuse the existing guarded,
# disposable topology drills; they never publish to or clear a remote module.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_url="${LUMIERE_SYNTHETIC_API_URL:-http://127.0.0.1:8082}"
mode="${1:-readiness}"

check_readiness() {
  local report
  report="$(mktemp "${TMPDIR:-/tmp}/lumiere-c11-ready.XXXXXX")"
  trap 'rm -f "$report"' RETURN
  curl --fail --silent --show-error "$api_url/live" >/dev/null
  curl --fail --silent --show-error "$api_url/ready" >"$report"
  node - "$report" <<'NODE'
const fs = require("node:fs")
const report = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
const required = [
  "spacetimeDb",
  "postgres",
  "projectionLag",
  "contractVersion",
  "migration",
  "releaseCompatibility",
  "ai",
]
if (!['ready', 'degraded'].includes(report.status)) throw new Error(`unexpected readiness status: ${report.status}`)
if (!report.releaseId || !report.contractVersion || !report.contractRelease || !report.expectedMigrationVersion) throw new Error("readiness release identity is incomplete")
for (const name of required) {
  if (!report.components?.[name]?.status) throw new Error(`readiness component missing: ${name}`)
}
if (report.components.ai.status !== "informational") throw new Error("AI must be informational")
console.log(`[c11] ${report.status}: ${report.releaseId}, contracts ${report.contractRelease}`)
NODE
}

case "$mode" in
  readiness)
    check_readiness
    ;;
  workflows)
    cd "$root"
    make e2e-mvp-golden
    ;;
  isolation)
    cd "$root"
    node scripts/c9-isolation-matrix.mjs --live
    ;;
  watermark)
    cd "$root"
    scripts/c5-finalization-drill.sh
    ;;
  full)
    check_readiness
    cd "$root"
    make e2e-mvp-golden
    node scripts/c9-isolation-matrix.mjs --live
    scripts/c5-finalization-drill.sh
    ;;
  *)
    echo "usage: $0 [readiness|workflows|isolation|watermark|full]" >&2
    exit 2
    ;;
esac

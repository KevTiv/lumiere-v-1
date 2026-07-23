#!/usr/bin/env bash
# Validate production environment variables for Lumiere ERP (docker-compose + runtime).
# Exit 0 when all required vars are set; exit 1 with a summary when any are missing.
#
# Usage:
#   scripts/check-prod-env.sh           # strict — used by `make check-env-prod`
#   scripts/check-prod-env.sh --list    # print checklist only (no validation)
#
# Loads (if present, without overriding existing exports):
#   .env .env.local api-server/.env.local frontend/web/.env.local

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIST_ONLY=0
if [[ "${1:-}" == "--list" ]]; then
  LIST_ONLY=1
fi

load_env_file() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  set -a
  # shellcheck disable=SC1090
  source "$f"
  set +a
}

# Preserve explicit exports from the caller; fill gaps from repo env files.
load_env_file "$ROOT/.env"
load_env_file "$ROOT/.env.local"
load_env_file "$ROOT/api-server/.env.local"
load_env_file "$ROOT/frontend/web/.env.local"

missing=()
warnings=()

require_nonempty() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "${value// /}" ]]; then
    missing+=("$name")
    return 1
  fi
  return 0
}

require_one_of() {
  local a="$1"
  local b="$2"
  local va="${!a:-}"
  local vb="${!b:-}"
  if [[ -z "${va// /}" && -z "${vb// /}" ]]; then
    missing+=("$a or $b")
    return 1
  fi
  return 0
}

require_not_localhost() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "${value// /}" ]]; then
    return 0
  fi
  local lower
  lower="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  if [[ "$lower" == *localhost* || "$lower" == *127.0.0.1* ]]; then
    missing+=("$name (must not point at localhost in production)")
    return 1
  fi
  return 0
}

print_checklist() {
  cat <<'EOF'
Production checklist (set on the host / orchestrator before docker compose up):

  docker-compose (host .env — see docker-compose.yml):
    STDB_MODULE
    STDB_SERVER_TOKEN
    STDB_TOKEN                    (ai-gateway service token, distinct from STDB_SERVER_TOKEN)
    AI_CERTIFICATION_STDB_TOKEN   (dedicated certification executor identity)
    AI_CERTIFICATION_RUNTIME_HASH (sha256: plus 64 lowercase hex characters)
    LUMIERE_AI_GATEWAY_INTERNAL_SECRET

  api-server (NODE_ENV=production or LUMIERE_ENV=production):
    STDB_MODULE or NEXT_PUBLIC_STDB_MODULE
    STDB_SERVER_TOKEN
    STDB_HOST or NEXT_PUBLIC_STDB_HOST
    AI_GATEWAY_URL                (compose sets internal URL; required for bare-metal — not localhost)
    CORS_ORIGINS                  (browser origins allowed for credentialed API calls)

  web / Next.js (NODE_ENV=production):
    LUMIERE_API_SERVER_URL        (compose sets internal URL; required for bare-metal)
    STDB_SERVER_TOKEN
    LUMIERE_AI_GATEWAY_INTERNAL_SECRET
    STDB_MODULE or NEXT_PUBLIC_STDB_MODULE
    STDB_HOST or NEXT_PUBLIC_STDB_HOST
    NEXT_PUBLIC_APP_URL           (public app URL; used for links and CORS defaults)

  Client bundle (build-time NEXT_PUBLIC_* — set before `pnpm --filter web build`):
    NEXT_PUBLIC_STDB_MODULE       (must match STDB_MODULE)
    NEXT_PUBLIC_STDB_HOST         (SpacetimeDB HTTP/WS host for browser SDK fallback)

  Optional but recommended:
    STDB_CREDENTIAL_ENCRYPTION_KEY  (64 hex chars — required for email/password auth)
    WORKOS_*                        (enterprise SSO; omit for built-in auth)
    RESEND_API_KEY / RESEND_FROM_EMAIL
    NEXT_PUBLIC_POSTHOG_* / POSTHOG_*

See docs/PRODUCTION_DEPLOY.md and docs/ENVIRONMENT.md.
EOF
}

validate() {
  missing=()
  warnings=()

  # docker-compose ${VAR:?} requirements
  require_nonempty STDB_MODULE || true
  require_nonempty STDB_SERVER_TOKEN || true
  require_nonempty STDB_TOKEN || true
  require_nonempty AI_CERTIFICATION_STDB_TOKEN || true
  if require_nonempty AI_CERTIFICATION_RUNTIME_HASH; then
    if [[ ! "${AI_CERTIFICATION_RUNTIME_HASH}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
      missing+=("AI_CERTIFICATION_RUNTIME_HASH (must be sha256: plus 64 lowercase hex characters)")
    fi
  fi
  require_nonempty LUMIERE_AI_GATEWAY_INTERNAL_SECRET || true

  # api-server Config::from_env production rules
  require_one_of STDB_MODULE NEXT_PUBLIC_STDB_MODULE || true
  require_nonempty STDB_SERVER_TOKEN || true
  require_one_of STDB_HOST NEXT_PUBLIC_STDB_HOST || true

  if [[ -n "${AI_GATEWAY_URL:-}" ]]; then
    require_not_localhost AI_GATEWAY_URL || true
  else
    warnings+=("AI_GATEWAY_URL is unset — docker-compose sets http://ai-gateway:8080 for api-server; set explicitly for non-compose deploys")
  fi

  if [[ -n "${LUMIERE_API_SERVER_URL:-}" ]]; then
    require_not_localhost LUMIERE_API_SERVER_URL || true
  else
    warnings+=("LUMIERE_API_SERVER_URL is unset — docker-compose sets http://api-server:8082 for web; set explicitly for non-compose deploys")
  fi

  if [[ -z "${CORS_ORIGINS:-}" ]]; then
    warnings+=("CORS_ORIGINS is unset — api-server defaults to localhost origins only")
  fi

  if [[ -z "${NEXT_PUBLIC_APP_URL:-}" ]]; then
    warnings+=("NEXT_PUBLIC_APP_URL is unset — defaults to http://localhost:3000")
  fi

  if [[ -z "${STDB_CREDENTIAL_ENCRYPTION_KEY:-}" ]]; then
    warnings+=("STDB_CREDENTIAL_ENCRYPTION_KEY is unset — email/password credential storage will not work")
  fi

  if [[ -z "${NEXT_PUBLIC_STDB_MODULE:-}" && -n "${STDB_MODULE:-}" ]]; then
    warnings+=("NEXT_PUBLIC_STDB_MODULE is unset — bake STDB_MODULE into the web image at build time")
  fi
  if [[ -z "${NEXT_PUBLIC_STDB_HOST:-}" && -n "${STDB_HOST:-}" ]]; then
    warnings+=("NEXT_PUBLIC_STDB_HOST is unset — bake STDB_HOST into the web image at build time")
  fi

  # Dedupe missing entries (same check may run more than once)
  if ((${#missing[@]} > 0)); then
    local _deduped=()
    local m
    for m in "${missing[@]}"; do
      local seen=0
      local d
      for d in "${_deduped[@]:-}"; do
        if [[ "$d" == "$m" ]]; then seen=1; break; fi
      done
      if [[ "$seen" -eq 0 ]]; then _deduped+=("$m"); fi
    done
    missing=("${_deduped[@]}")
  fi
}

if [[ "$LIST_ONLY" -eq 1 ]]; then
  print_checklist
  exit 0
fi

print_checklist
echo ""
echo "Validating current environment..."
validate

if ((${#warnings[@]} > 0)); then
  echo ""
  echo "Warnings:"
  for w in "${warnings[@]}"; do
    echo "  - $w"
  done
fi

if ((${#missing[@]} > 0)); then
  echo ""
  echo "Missing required production variables:"
  for m in "${missing[@]}"; do
    echo "  - $m"
  done
  echo ""
  echo "Set the variables above (see docker-compose.yml and docs/PRODUCTION_DEPLOY.md), then re-run: make check-env-prod"
  exit 1
fi

echo ""
echo "All required production environment variables are set."
exit 0

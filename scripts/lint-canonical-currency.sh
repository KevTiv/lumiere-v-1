#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

paths=(spacetimedb/src frontend/packages frontend/web/app frontend/web/lib)
globs=(--glob '*.rs' --glob '*.ts' --glob '*.tsx' --glob '!**/generated/**' --glob '!**/*.test.ts')

if rg -n "CurrencyReference|currency_reference|register_currency_reference|ensure_currency_reference|legacy_currency_(id|code)_for" "${paths[@]}" "${globs[@]}"; then
  echo "legacy currency bridge logic remains" >&2
  exit 1
fi

if rg -n "(currency_id|company_currency_id|journal_currency_id|result_currency_id)\s*[:=]\s*1([,;_[:space:]]|$)|return\s+1n|fallback(Id)?\s*[:=].*['\"]1['\"]" "${paths[@]}" "${globs[@]}"; then
  echo "hardcoded canonical currency IDs remain" >&2
  exit 1
fi

if rg -n "Currency uses string PK|currency[^[:space:]]* placeholder|placeholder[^[:space:]]* currency" spacetimedb/src --glob '*.rs'; then
  echo "legacy currency placeholder comments remain" >&2
  exit 1
fi

echo "canonical currency lint: ok"

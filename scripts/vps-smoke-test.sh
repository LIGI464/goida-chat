#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  # shellcheck disable=SC2046
  export $(grep -E '^(APP_URL|API_URL)=' .env | xargs)
fi

app_url="${APP_URL:-http://localhost}"
api_url="${API_URL:-http://localhost}"

printf 'Checking API health: %s/health\n' "$api_url"
curl -fsS "$api_url/health" >/dev/null

printf 'Checking frontend: %s\n' "$app_url"
curl -fsSI "$app_url" >/dev/null

printf 'Smoke test passed.\n'

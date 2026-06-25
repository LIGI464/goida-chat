#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  printf 'Missing .env. Start from .env.production.example on the VPS.\n' >&2
  exit 1
fi

# shellcheck disable=SC2046
export $(grep -E '^(NODE_ENV|APP_URL|API_URL|LIVEKIT_URL|APP_SITE|API_SITE|LIVEKIT_SITE|BETTER_AUTH_URL)=' .env | xargs)

required_vars="NODE_ENV APP_URL API_URL LIVEKIT_URL APP_SITE API_SITE LIVEKIT_SITE BETTER_AUTH_URL"

for name in $required_vars; do
  value=$(printenv "$name" || true)
  if [ -z "$value" ]; then
    printf 'Missing required variable: %s\n' "$name" >&2
    exit 1
  fi
done

for value in "$APP_URL" "$API_URL" "$LIVEKIT_URL" "$APP_SITE" "$API_SITE" "$LIVEKIT_SITE" "$BETTER_AUTH_URL"; do
  case "$value" in
    *localhost*|*example.com*)
      printf 'Refusing deploy with placeholder/local value: %s\n' "$value" >&2
      exit 1
      ;;
  esac
done

if [ "$NODE_ENV" != "production" ]; then
  printf 'NODE_ENV must be production for VPS deploys.\n' >&2
  exit 1
fi

printf 'Building backend image...\n'
docker compose build backend

printf 'Building frontend image...\n'
docker compose build frontend

printf 'Starting stack...\n'
docker compose up -d

printf 'Running Prisma migrations...\n'
docker compose exec backend npx prisma migrate deploy --schema services/api/prisma/schema.prisma

printf 'Service status:\n'
docker compose ps

printf 'Running smoke test...\n'
sh scripts/vps-smoke-test.sh

printf 'VPS deploy completed.\n'

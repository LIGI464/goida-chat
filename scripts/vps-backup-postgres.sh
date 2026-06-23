#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

backup_dir="${BACKUP_DIR:-backups}"
timestamp="$(date +%F-%H%M%S)"
backup_path="${backup_dir}/goida-chat-${timestamp}.sql.gz"

mkdir -p "$backup_dir"

docker compose exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' |
  gzip -9 > "$backup_path"

printf 'Backup created: %s\n' "$backup_path"

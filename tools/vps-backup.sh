#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/painel-shortcode}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/painel-shortcode}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/manual-$TIMESTAMP"

echo "==> Preparando backup em $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"

if [[ ! -d "$APP_DIR" ]]; then
  echo "Diretorio do app nao encontrado: $APP_DIR" >&2
  exit 2
fi

tar -czf "$BACKUP_DIR/app.tar.gz" \
  --exclude=node_modules \
  --exclude=data \
  -C "$APP_DIR" .

if [[ -f "$APP_DIR/.env" ]]; then
  cp "$APP_DIR/.env" "$BACKUP_DIR/.env"
  chmod 600 "$BACKUP_DIR/.env"
fi

if [[ -d "$APP_DIR/data" ]]; then
  tar -czf "$BACKUP_DIR/data.tar.gz" -C "$APP_DIR" data
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl status painel-shortcode --no-pager >"$BACKUP_DIR/service-status.txt" || true
fi

echo "Backup criado em: $BACKUP_DIR"

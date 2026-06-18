#!/usr/bin/env bash
set -euo pipefail

BACKUP_ARCHIVE="${1:-}"
APP_DIR="${APP_DIR:-/var/www/painel-shortcode}"
SERVICE_NAME="${SERVICE_NAME:-painel-shortcode}"
TMP_DIR="/tmp/painel-shortcode-restore"

if [[ -z "$BACKUP_ARCHIVE" ]]; then
  echo "Uso: sudo bash /root/vps-restore-data.sh /root/algum-backup-data.tar.gz" >&2
  exit 2
fi

if [[ ! -f "$BACKUP_ARCHIVE" ]]; then
  echo "Arquivo de backup nao encontrado: $BACKUP_ARCHIVE" >&2
  exit 2
fi

mkdir -p "$TMP_DIR"
rm -rf "$TMP_DIR"/*
tar -xzf "$BACKUP_ARCHIVE" -C "$TMP_DIR"

if [[ ! -d "$TMP_DIR/data" ]]; then
  echo "Backup invalido: diretorio data nao encontrado dentro do tar.gz" >&2
  exit 2
fi

mkdir -p "$APP_DIR/data"
cp -a "$TMP_DIR/data/." "$APP_DIR/data/"
chown -R painel-shortcode:painel-shortcode "$APP_DIR/data"

if command -v systemctl >/dev/null 2>&1; then
  systemctl restart "$SERVICE_NAME"
fi

echo "Restore concluido a partir de: $BACKUP_ARCHIVE"

#!/usr/bin/env bash
set -euo pipefail

HOUR="${1:-23}"
MINUTE="${2:-30}"
CRON_FILE="/etc/cron.d/painel-shortcode-backup"
SCRIPT_PATH="/root/vps-backup-data.sh"

if [[ ! "$HOUR" =~ ^[0-9]{1,2}$ ]] || (( HOUR < 0 || HOUR > 23 )); then
  echo "Hora invalida: $HOUR" >&2
  exit 2
fi

if [[ ! "$MINUTE" =~ ^[0-9]{1,2}$ ]] || (( MINUTE < 0 || MINUTE > 59 )); then
  echo "Minuto invalido: $MINUTE" >&2
  exit 2
fi

if [[ ! -f "$SCRIPT_PATH" ]]; then
  echo "Script de backup nao encontrado: $SCRIPT_PATH" >&2
  exit 2
fi

chmod +x "$SCRIPT_PATH"

cat >"$CRON_FILE" <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

$MINUTE $HOUR * * * root PREFIX=nightly $SCRIPT_PATH >> /var/log/painel-shortcode-backup.log 2>&1
EOF

chmod 644 "$CRON_FILE"

echo "Backup noturno instalado: $HOUR:$MINUTE todos os dias"
echo "Cron: $CRON_FILE"

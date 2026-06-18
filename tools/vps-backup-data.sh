#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/painel-shortcode}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/painel-shortcode}"
PREFIX="${PREFIX:-nightly}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$PREFIX-$TIMESTAMP"
DATA_DIR="$APP_DIR/data"

echo "==> Preparando backup de dados em $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"

if [[ ! -d "$APP_DIR" ]]; then
  echo "Diretorio do app nao encontrado: $APP_DIR" >&2
  exit 2
fi

if [[ ! -d "$DATA_DIR" ]]; then
  echo "Diretorio de dados nao encontrado: $DATA_DIR" >&2
  exit 2
fi

tar -czf "$BACKUP_DIR/data.tar.gz" -C "$APP_DIR" data

for file in users.json jobs.json sms-log.jsonl storefront.json rotation-state.json sessions.json; do
  if [[ -f "$DATA_DIR/$file" ]]; then
    cp "$DATA_DIR/$file" "$BACKUP_DIR/$file"
    chmod 600 "$BACKUP_DIR/$file" || true
  fi
done

cat >"$BACKUP_DIR/README.txt" <<EOF
Backup de dados do Painel Shortcode
Criado em: $(date -Is)
Origem: $DATA_DIR

Arquivos principais:
- users.json: usuarios, creditos, permissoes
- jobs.json: fila/historico resumido
- sms-log.jsonl: relatorio bruto de envios
- storefront.json: contato/pacotes
- rotation-state.json: estado da rotacao
- sessions.json: sessoes ativas
- data.tar.gz: pacote completo do diretorio data
EOF

if command -v systemctl >/dev/null 2>&1; then
  systemctl status painel-shortcode --no-pager >"$BACKUP_DIR/service-status.txt" || true
fi

echo "Backup de dados criado em: $BACKUP_DIR"

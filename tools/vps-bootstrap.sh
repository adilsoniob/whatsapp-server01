#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  sudo bash tools/vps-bootstrap.sh --app-tar /root/painel-shortcode.tgz --env /root/painel-shortcode.env
  sudo bash tools/vps-bootstrap.sh --app-tar /root/painel-shortcode.tgz --env /root/painel-shortcode.env --domain sms-diihjcop.xyz

Notes:
  - --env deve apontar para um arquivo .env com credenciais (NAO commitar no Git).
  - Em atualizacoes normais, o diretorio data/ e preservado.
  - Se --domain nao for informado e ja existir configuracao web na VPS, Nginx/certificado nao sao alterados.
EOF
}

APP_TAR=""
ENV_FILE=""
DOMAIN=""
APP_DIR="/var/www/painel-shortcode"
APP_USER="painel-shortcode"
APP_GROUP="painel-shortcode"
SERVICE_NAME="painel-shortcode"
NGINX_SITE="painel-shortcode"
BACKUP_ROOT="/var/backups/painel-shortcode"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-tar)
      APP_TAR="${2:-}"; shift 2 ;;
    --env)
      ENV_FILE="${2:-}"; shift 2 ;;
    --domain)
      DOMAIN="${2:-}"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Argumento desconhecido: $1" >&2
      usage
      exit 2 ;;
  esac
done

if [[ -z "$APP_TAR" || -z "$ENV_FILE" ]]; then
  usage
  exit 2
fi

if [[ ! -f "$APP_TAR" ]]; then
  echo "Arquivo do app nao encontrado: $APP_TAR" >&2
  exit 2
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Arquivo .env nao encontrado: $ENV_FILE" >&2
  exit 2
fi

export DEBIAN_FRONTEND=noninteractive

echo "==> Garantindo /run/sshd (evita falha do sshd ao reiniciar)"
echo "d /run/sshd 0755 root root -" >/etc/tmpfiles.d/sshd.conf
systemd-tmpfiles --create >/dev/null 2>&1 || true

echo "==> Atualizando pacotes"
apt-get update -y
apt-get upgrade -y

echo "==> Instalando dependencias (nginx, curl, git)"
apt-get install -y nginx curl git ca-certificates

if [[ -n "$DOMAIN" ]]; then
  echo "==> Instalando Certbot para HTTPS"
  apt-get install -y certbot python3-certbot-nginx
fi

echo "==> Instalando Node.js 18 (NodeSource) se necessario"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

echo "==> Criando usuario do app"
if ! id "$APP_USER" >/dev/null 2>&1; then
  adduser --system --group --home "$APP_DIR" "$APP_USER"
fi

echo "==> Garantindo diretorio de backups"
mkdir -p "$BACKUP_ROOT"
chown "$APP_USER:$APP_GROUP" "$BACKUP_ROOT"

if [[ -f "$APP_DIR/server.js" ]]; then
  echo "==> Gerando backup do deploy atual"
  BACKUP_DIR="$BACKUP_ROOT/deploy-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BACKUP_DIR"

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

  if [[ -f "$APP_DIR/data/users.json" ]]; then
    cp "$APP_DIR/data/users.json" "$BACKUP_DIR/users.json"
    chmod 600 "$BACKUP_DIR/users.json"
  fi

  chown -R "$APP_USER:$APP_GROUP" "$BACKUP_DIR"
fi

echo "==> Instalando app em $APP_DIR"
mkdir -p "$APP_DIR"
find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name data -exec rm -rf {} +
tar -xzf "$APP_TAR" -C "$APP_DIR"

if [[ ! -f "$APP_DIR/server.js" ]]; then
  echo "server.js nao encontrado em $APP_DIR. Conteudo:" >&2
  ls -la "$APP_DIR" >&2 || true
  exit 2
fi

echo "==> Aplicando .env"
install -m 600 -o "$APP_USER" -g "$APP_GROUP" "$ENV_FILE" "$APP_DIR/.env"

echo "==> Instalando node_modules (npm ci)"
cd "$APP_DIR"
npm ci --omit=dev

echo "==> Ajustando permissoes"
mkdir -p "$APP_DIR/data"
chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"

echo "==> Configurando systemd ($SERVICE_NAME.service)"
cat >/etc/systemd/system/$SERVICE_NAME.service <<EOF
[Unit]
Description=Painel Shortcode
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"

if [[ -n "$DOMAIN" || ! -f "/etc/nginx/sites-available/$NGINX_SITE" ]]; then
  echo "==> Configurando Nginx (proxy -> 127.0.0.1:3000)"
  SERVER_NAME="_"
  if [[ -n "$DOMAIN" ]]; then
    SERVER_NAME="$DOMAIN"
  fi

  cat >/etc/nginx/sites-available/$NGINX_SITE <<EOF
server {
  listen 80;
  server_name $SERVER_NAME;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
EOF

  rm -f /etc/nginx/sites-enabled/default || true
  ln -sf "/etc/nginx/sites-available/$NGINX_SITE" "/etc/nginx/sites-enabled/$NGINX_SITE"
  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx

  if [[ -n "$DOMAIN" ]]; then
    echo "==> Emitindo/renovando certificado HTTPS para $DOMAIN"
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
    nginx -t
    systemctl reload nginx
  fi
else
  echo "==> Preservando configuracao web existente (Nginx/certificado nao alterados)"
fi

echo "==> Verificando status"
systemctl status "$SERVICE_NAME" --no-pager || true
systemctl status nginx --no-pager || true

echo
if [[ -n "$DOMAIN" ]]; then
  echo "OK. Abra: https://$DOMAIN/"
else
  echo "OK. Abra: http://$(curl -fsS ifconfig.me 2>/dev/null || echo '<IP_DA_VPS>')/"
fi
echo "Logs: journalctl -u $SERVICE_NAME -n 200 --no-pager"
echo "Backups: ls -lah $BACKUP_ROOT"

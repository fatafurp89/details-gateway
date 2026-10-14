#!/usr/bin/env bash
# Details Gateway installer — idempotent, Ubuntu 24.04. Run as root from the repo:  sudo bash deploy/install.sh
set -Eeuo pipefail
umask 022

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP=/opt/details-gateway
ETC=/etc/details-gateway
ENVF=$ETC/env
SVC=details-gateway
USR=details-gateway
DB=details_gateway
ROLE=gateway
LOG=/var/log/details-gateway-install.log

[[ $EUID -eq 0 ]] || { echo "شغّل السكربت بصلاحية root (sudo)."; exit 1; }
: > "$LOG"; chmod 600 "$LOG"
trap 'echo "فشل التثبيت عند السطر $LINENO. التفاصيل في $LOG" >&2' ERR
q() { "$@" >>"$LOG" 2>&1; }   # run quietly
export DEBIAN_FRONTEND=noninteractive

# 1) Base packages
q apt-get update -y
q apt-get install -y ca-certificates curl gnupg openssl rsync

# 2) Node 22 (NodeSource) if missing or older
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh 2>>"$LOG"
  q bash /tmp/nodesource_setup.sh
  q apt-get install -y nodejs
  rm -f /tmp/nodesource_setup.sh
fi

# 3) PostgreSQL 16 if missing
if ! command -v psql >/dev/null || ! dpkg -s postgresql-16 >/dev/null 2>&1; then
  q apt-get install -y postgresql-16 postgresql-client-16
fi
q systemctl enable --now postgresql

# 4) Service user
id -u "$USR" >/dev/null 2>&1 || q useradd --system --no-create-home --home-dir "$APP" --shell /usr/sbin/nologin "$USR"

# 5) Secrets file (generated once, never printed)
install -d -m 700 -o root -g root "$ETC"
[[ -f $ENVF ]] || { install -m 600 -o root -g root /dev/null "$ENVF"; }
chmod 600 "$ENVF"; chown root:root "$ENVF"
getv() { grep -E "^$1=" "$ENVF" | tail -n1 | cut -d= -f2- || true; }
setdefault() { grep -qE "^$1=" "$ENVF" || printf '%s=%s\n' "$1" "$2" >> "$ENVF"; }

PGPASS_NEW=""
if ! grep -qE '^DATABASE_URL=postgres://gateway:[^@]+@' "$ENVF"; then
  PGPASS_NEW="$(openssl rand -hex 24)"
  sed -i '/^DATABASE_URL=/d' "$ENVF"
  printf 'DATABASE_URL=postgres://%s:%s@127.0.0.1:5432/%s\n' "$ROLE" "$PGPASS_NEW" "$DB" >> "$ENVF"
fi
for k in SESSION_SECRET OTP_PEPPER TICKET_SECRET GATEWAY_PROXY_KEY SECRETS_KEY; do
  [[ -n "$(getv $k)" ]] || { sed -i "/^$k=/d" "$ENVF"; printf '%s=%s\n' "$k" "$(openssl rand -hex 32)" >> "$ENVF"; }
done
setdefault BASE_URL https://details-wms.cloud
setdefault COOKIE_DOMAIN .details-wms.cloud
setdefault ROOT_DOMAIN details-wms.cloud
setdefault SMTP_HOST smtp.hostinger.com
setdefault SMTP_PORT 465
setdefault SMTP_USER info@details-consults.sa
setdefault SMTP_PASS ""
setdefault GOOGLE_CLIENT_ID ""
setdefault GOOGLE_CLIENT_SECRET ""
setdefault GOOGLE_REDIRECT_URI https://details-wms.cloud/api/auth/google/callback
setdefault BOOTSTRAP_ADMIN_EMPLOYEE_NO ""
setdefault BOOTSTRAP_ADMIN_NAME ""
setdefault BOOTSTRAP_ADMIN_EMAIL ""

# 6) Database role + database (password taken from the env file, passed via stdin)
PGPASS="$(getv DATABASE_URL | sed -E 's#^postgres://[^:]+:([^@]+)@.*#\1#')"
if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$ROLE'" 2>>"$LOG" | grep -q 1; then
  printf "CREATE ROLE %s LOGIN PASSWORD '%s';\n" "$ROLE" "$PGPASS" | q runuser -u postgres -- psql -v ON_ERROR_STOP=1
elif [[ -n "$PGPASS_NEW" ]]; then
  printf "ALTER ROLE %s WITH LOGIN PASSWORD '%s';\n" "$ROLE" "$PGPASS" | q runuser -u postgres -- psql -v ON_ERROR_STOP=1
fi
if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB'" 2>>"$LOG" | grep -q 1; then
  q runuser -u postgres -- createdb -O "$ROLE" "$DB"
fi
q runuser -u postgres -- psql -d "$DB" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
unset PGPASS PGPASS_NEW

# 7) Application files
install -d -m 755 "$APP"
q rsync -a --delete --exclude node_modules --exclude .git --exclude test --exclude seed "$SRC"/ "$APP"/
cd "$APP"
if [[ -f package-lock.json ]]; then q npm ci --omit=dev --no-audit --no-fund; else q npm install --omit=dev --no-audit --no-fund; fi
chown -R root:"$USR" "$APP"
chmod -R u=rwX,g=rX,o= "$APP"

# 8) Migrations (root reads the env file; Node loads it directly)
q node --env-file="$ENVF" src/migrate.js

# 9) systemd unit
install -m 644 "$APP/deploy/details-gateway.service" /etc/systemd/system/$SVC.service
q systemctl daemon-reload
q systemctl enable $SVC
q systemctl restart $SVC

# 10) Health check
ok=""
for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:4000/healthz >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
[[ -n $ok ]] || { echo "الخدمة لم تستجب على 127.0.0.1:4000. راجع: journalctl -u $SVC -n 50" >&2; exit 1; }

echo "تم تثبيت بوابة ديتيلز بنجاح."
echo "  • Node $(node -v) · PostgreSQL $(runuser -u postgres -- psql -tAc 'SHOW server_version' | cut -d' ' -f1)"
echo "  • القاعدة: $DB  · المستخدم: $ROLE"
echo "  • الخدمة: $SVC (127.0.0.1:4000) تعمل"
echo "  • الأسرار: $ENVF (chmod 600) — أكمل SMTP_PASS و GOOGLE_* و BOOTSTRAP_ADMIN_* ثم: systemctl restart $SVC"
echo "  • nginx: انسخ deploy/nginx-gateway.conf ثم nginx -t && systemctl reload nginx"
echo "  • وكيل المعلومات التقنية (على كل خادم نملكه): bash deploy/install-infra-agent.sh <node-key> <GATEWAY_PROXY_KEY> [probes…]"

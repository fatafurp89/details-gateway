#!/usr/bin/env bash
# Install the Details infra agent on one server (idempotent). Run as root from the repo:
#   sudo bash deploy/install-infra-agent.sh <node-key> <GATEWAY_PROXY_KEY> [probe-host …]
# e.g. office server:  sudo bash deploy/install-infra-agent.sh office-server "$KEY" 10.10.10.10 10.10.10.13 10.10.10.14 10.10.10.19 10.10.10.12 192.168.8.1
#      bridge:         sudo bash deploy/install-infra-agent.sh bridge "$KEY"
#      apps server:    GATEWAY_URL=https://details-wms.cloud sudo -E bash deploy/install-infra-agent.sh apps "$KEY"
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo "شغّل السكربت بصلاحية root (sudo)."; exit 1; }
[[ $# -ge 2 ]] || { echo "الاستخدام: $0 <node-key> <GATEWAY_PROXY_KEY> [probe-host …]"; exit 1; }
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_KEY=$1; PROXY_KEY=$2; shift 2
PROBES="$*"
GATEWAY_URL=${GATEWAY_URL:-https://details-wms.cloud}
ETC=/etc/details-gateway
install -d -m 700 -o root -g root "$ETC"
umask 077
cat > "$ETC/infra-agent.env" <<EOF
NODE_KEY=$NODE_KEY
GATEWAY_URL=$GATEWAY_URL
GATEWAY_PROXY_KEY=$PROXY_KEY
PROBES="$PROBES"
EOF
chmod 600 "$ETC/infra-agent.env"
install -m 755 "$SRC/infra-agent.sh" /usr/local/bin/infra-agent.sh
install -m 644 "$SRC/infra-agent.service" /etc/systemd/system/infra-agent.service
install -m 644 "$SRC/infra-agent.timer" /etc/systemd/system/infra-agent.timer
systemctl daemon-reload
systemctl enable --now infra-agent.timer
systemctl start infra-agent.service || true
echo "تم تثبيت وكيل المعلومات التقنية للعقدة «$NODE_KEY» (كل دقيقتين). الحالة: systemctl list-timers infra-agent.timer · السجل: journalctl -u infra-agent -n 20"

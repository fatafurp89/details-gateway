#!/usr/bin/env bash
# Details infra agent — reports this host's health to the gateway (POST /_gw/infra/report). bash + curl only, no jq.
# Runs from infra-agent.timer every 2 minutes. Config: /etc/details-gateway/infra-agent.env (chmod 600):
#   NODE_KEY=office-server                 # key of this node in infra_nodes
#   GATEWAY_URL=https://details-wms.cloud  # or http://10.9.0.1:4000 through WireGuard if nginx is bypassed
#   GATEWAY_PROXY_KEY=…                    # same value as the gateway's GATEWAY_PROXY_KEY
#   PROBES="10.10.10.10 10.10.10.13 …"     # optional: hosts to ping (devices without an agent)
#   SERVICE_PATTERN='nginx|postgres|…'     # optional: regex of systemd units to report
set -u
ENVF=${INFRA_AGENT_ENV:-/etc/details-gateway/infra-agent.env}
if [[ -r $ENVF ]]; then set -a; . "$ENVF"; set +a; fi
: "${NODE_KEY:?NODE_KEY missing}" "${GATEWAY_URL:?GATEWAY_URL missing}" "${GATEWAY_PROXY_KEY:?GATEWAY_PROXY_KEY missing}"
PROBES=${PROBES:-}
SERVICE_PATTERN=${SERVICE_PATTERN:-'nginx|postgres|details|wg-quick|tailscaled|docker|bls|hr|mail|infra-agent|ssh'}
GATEWAY_URL=${GATEWAY_URL%/}

# ---- tiny JSON helpers ----
jstr() { local s=${1//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}; s=${s//$'\r'/}; s=${s//$'\t'/\\t}; printf '"%s"' "$s"; }
jnum() { if [[ ${1:-} =~ ^-?[0-9]+(\.[0-9]+)?$ ]]; then printf '%s' "$1"; else printf 'null'; fi; }
jbool() { if [[ ${1:-} == true ]]; then printf 'true'; else printf 'false'; fi; }

# ---- uptime / load / memory ----
read -r up _ < /proc/uptime; uptime_s=${up%.*}
read -r l1 l5 l15 _ < /proc/loadavg
mem_total=$(awk '/^MemTotal:/{print $2*1024}' /proc/meminfo)
mem_avail=$(awk '/^MemAvailable:/{print $2*1024}' /proc/meminfo)
mem_used=$(( mem_total - mem_avail ))

# ---- disks (bytes) ----
disks=""
while read -r _ size used _ _ mount; do
  [[ -n ${mount:-} && ${size:-0} -gt 0 ]] || continue
  disks+="${disks:+,}{\"mount\":$(jstr "$mount"),\"size\":$size,\"used\":$used}"
done < <(df -P -B1 -x tmpfs -x devtmpfs -x squashfs -x overlay -x efivarfs 2>/dev/null | tail -n +2)

# ---- systemd units matching the pattern ----
services=""
if command -v systemctl >/dev/null 2>&1; then
  while read -r unit active; do
    [[ -n ${unit:-} ]] && [[ $unit =~ $SERVICE_PATTERN ]] || continue
    services+="${services:+,}{\"name\":$(jstr "$unit"),\"active\":$(jbool "$([[ $active == active ]] && echo true || echo false)")}"
  done < <(systemctl list-units --type=service,timer --all --no-legend --plain 2>/dev/null | awk '{print $1, $3}')
fi

# ---- OS / pending updates ----
os=""
[[ -r /etc/os-release ]] && os=$(. /etc/os-release 2>/dev/null; printf '%s' "${PRETTY_NAME:-}")
os="${os:-$(uname -s)} · $(uname -r)"
upd_count=0
if [[ -r /var/lib/update-notifier/updates-available ]]; then
  upd_count=$(grep -oE '[0-9]+ updates? can be applied' /var/lib/update-notifier/updates-available 2>/dev/null | head -1 | grep -oE '^[0-9]+' || true)
elif command -v apt >/dev/null 2>&1; then
  upd_count=$(timeout 20 apt list --upgradable 2>/dev/null | grep -c '/' || true)
fi
upd_count=${upd_count:-0}
reboot=false; [[ -f /var/run/reboot-required ]] && reboot=true
last_check=""
[[ -f /var/lib/apt/periodic/update-success-stamp ]] && last_check=$(date -u -d "@$(stat -c %Y /var/lib/apt/periodic/update-success-stamp)" +%FT%TZ 2>/dev/null || true)

# ---- WireGuard (needs root) ----
wg_json=null
if command -v wg >/dev/null 2>&1; then
  read -r peers latest < <(wg show all dump 2>/dev/null | awk 'NF>=8 {n++; if ($6+0>m) m=$6+0} END {printf "%d %d\n", n, m}')
  hs=null; [[ ${latest:-0} -gt 0 ]] && hs=$(( $(date +%s) - latest ))
  wg_json="{\"peers\":${peers:-0},\"handshake_s\":$hs,\"up\":$(jbool "$([[ ${peers:-0} -gt 0 ]] && echo true || echo false)")}"
fi

# ---- Tailscale ----
ts_json=null
if command -v tailscale >/dev/null 2>&1; then
  ts_ip=$(tailscale ip -4 2>/dev/null | head -1)
  if tailscale status >/dev/null 2>&1; then ts_online=true; else ts_online=false; fi
  ts_json="{\"ip\":$(jstr "${ts_ip:-}"),\"online\":$ts_online}"
fi

# ---- ping probes (devices without an agent: router, switches, AP, fingerprint) ----
probes=""
for h in $PROBES; do
  if out=$(ping -n -c 1 -W 1 "$h" 2>/dev/null); then
    ok=true; ms=$(printf '%s' "$out" | grep -oE 'time=[0-9.]+' | head -1 | cut -d= -f2)
  else
    ok=false; ms=""
  fi
  probes+="${probes:+,}{\"host\":$(jstr "$h"),\"ok\":$ok,\"ms\":$(jnum "$ms")}"
done

body="{\"node\":$(jstr "$NODE_KEY"),\"uptime_s\":$(jnum "$uptime_s"),\"load\":[$(jnum "$l1"),$(jnum "$l5"),$(jnum "$l15")],"
body+="\"mem\":{\"total\":$mem_total,\"used\":$mem_used},\"disks\":[$disks],\"services\":[$services],\"os\":$(jstr "$os"),"
body+="\"updates\":{\"count\":$(jnum "$upd_count"),\"reboot_required\":$reboot,\"last_check\":$(jstr "$last_check")},"
body+="\"wg\":$wg_json,\"tailscale\":$ts_json,\"probes\":[$probes]}"

curl -fsS --max-time 25 -X POST "$GATEWAY_URL/_gw/infra/report" \
  -H 'Content-Type: application/json' -H "X-Gw-Proxy-Key: $GATEWAY_PROXY_KEY" \
  --data-binary "$body" -o /dev/null -w "infra-agent: $NODE_KEY reported (%{http_code})\n"

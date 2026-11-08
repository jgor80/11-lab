#!/usr/bin/env bash
# Run on the target Linux server as root. No Git checkout or npm packages required.
set -euo pipefail
if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root to install the systemd service and timer." >&2
  exit 1
fi
collector="$(dirname "${BASH_SOURCE[0]}")/sync-futgg-prices.py"
test -f "$collector"
command -v python3 >/dev/null
command -v systemctl >/dev/null
install -d -m 755 /opt/xilab-market
if [[ "$(realpath "$collector")" != /opt/xilab-market/sync-futgg-prices.py ]]; then
  install -m 644 "$collector" /opt/xilab-market/sync-futgg-prices.py
fi
cat > /etc/systemd/system/xilab-market.service <<'EOF'
[Unit]
Description=Refresh XI Lab FUT.GG bulk market price cache
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
DynamicUser=yes
StateDirectory=xilab-market
ExecStart=/usr/bin/env python3 /opt/xilab-market/sync-futgg-prices.py --output /var/lib/xilab-market
TimeoutStartSec=120
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
EOF
cat > /etc/systemd/system/xilab-market.timer <<'EOF'
[Unit]
Description=Fetch XI Lab market prices twice daily

[Timer]
OnCalendar=*-*-* 06,18:00:00 UTC
Persistent=true
Unit=xilab-market.service

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now xilab-market.timer
systemctl start xilab-market.service
systemctl list-timers xilab-market.timer --no-pager
echo "Prices: /var/lib/xilab-market/latest.json"
echo "Status: /var/lib/xilab-market/status.json"

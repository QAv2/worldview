#!/usr/bin/env bash
# Deploy WorldView Sentinel to a fresh Ubuntu/Debian VM.
# Usage: ssh into the VM, clone the repo, then run this script.
#   git clone <repo-url> /opt/worldview
#   cd /opt/worldview
#   sudo bash capture/deploy.sh
set -euo pipefail

echo "=== WorldView Sentinel — deploy ==="

# System deps
apt-get update -qq
apt-get install -y -qq python3 python3-venv git

# Service user
if ! id sentinel &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin sentinel
    echo "created sentinel user"
fi

# Venv + deps
python3 -m venv /opt/worldview/venv
/opt/worldview/venv/bin/pip install --quiet aiohttp aiosqlite

# Data dirs
mkdir -p /opt/worldview/data/captures /opt/worldview/data/replays
chown -R sentinel:sentinel /opt/worldview/data

# Systemd
cp /opt/worldview/capture/sentinel.service /etc/systemd/system/sentinel.service
systemctl daemon-reload
systemctl enable sentinel
systemctl start sentinel

echo ""
echo "=== deployed ==="
echo "  status:  sudo systemctl status sentinel"
echo "  logs:    sudo journalctl -u sentinel -f"
echo "  restart: sudo systemctl restart sentinel"
echo "  stop:    sudo systemctl stop sentinel"

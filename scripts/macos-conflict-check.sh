#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-status}"
OS="$(uname -s)"
APP_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

if [[ "$OS" != "Darwin" ]]; then
  echo 'VPN/proxy conflict check is only available on macOS.'
  exit 0
fi

# category|display-name|case-insensitive-regex
# This is intentionally generic. iNode-like tools are classified as network-access/VPN clients,
# not treated as a product-specific exception.
PATTERNS=(
  'proxy-manager|Shadowrocket|Shadowrocket'
  'proxy-manager|ClashX|ClashX'
  'proxy-manager|Clash Verge|Clash[[:space:]]*Verge|clash-verge'
  'proxy-manager|Surge|Surge'
  'proxy-manager|Stash|Stash'
  'proxy-manager|Quantumult X|Quantumult|Quantumult X'
  'proxy-manager|熊猫上网 / 熊猫云 / Panda / PandaVPN / xiongmao|熊猫上网|熊猫云|熊猫|PandaVPN|Panda|xiongmao|rocket/clash-configs'
  'proxy-manager|V2RayU|V2RayU|V2rayU'
  'proxy-manager|Loon|Loon'
  'proxy-manager|sing-box|sing-box|singbox'
  'proxy-manager|other mihomo/clash client|clash|mihomo'
  'vpn-client|ExpressVPN|ExpressVPN|expressvpn'
  'vpn-client|OpenVPN|OpenVPN|openvpn'
  'vpn-client|WireGuard|WireGuard|wireguard'
  'vpn-client|Tailscale|Tailscale|tailscaled'
  'vpn-client|ZeroTier|ZeroTier|zerotier'
  'vpn-client|Cisco AnyConnect / Cisco Secure Client|AnyConnect|Cisco Secure Client|vpnagentd'
  'vpn-client|GlobalProtect|GlobalProtect|PanGPS|PanGPA'
  'vpn-client|FortiClient|FortiClient|fctservctl'
  'vpn-client|Pulse Secure / Ivanti|Pulse Secure|Ivanti Secure|Junos Pulse'
  'network-access-vpn|network access / campus or enterprise VPN client|iNode|inode|EasyConnect|ECAgent|Sangfor|ArraySSLVPN|MotionPro'
)

skip_own_process() {
  local command="$1"
  case "$command" in
    *"$APP_ROOT"*) return 0 ;;
    *".config/SophiaVPN"*) return 0 ;;
    *"SophiaVPN.app"*) return 0 ;;
    *"bin/sophia"*) return 0 ;;
    *"macos-conflict-check.sh"*) return 0 ;;
  esac
  return 1
}

process_table() {
  # Use args without comm: macOS can emit invalid bytes in comm for localized app names,
  # which makes Bash regex matching miss otherwise valid command lines.
  ps ax -o pid= -o args= 2>/dev/null || true
}

matches=()
shopt -s nocasematch
while IFS= read -r line; do
  [[ -n "$line" ]] || continue
  line="${line#"${line%%[![:space:]]*}"}"
  pid="${line%%[[:space:]]*}"
  command="${line#"$pid"}"
  command="${command#"${command%%[![:space:]]*}"}"
  if skip_own_process "$command"; then
    continue
  fi
  for spec in "${PATTERNS[@]}"; do
    IFS='|' read -r category name pattern <<<"$spec"
    if [[ "$command" =~ $pattern ]]; then
      matches+=("$category|$name|$pid|$command")
      break
    fi
  done
done < <(process_table)
shopt -u nocasematch

if [[ "$ACTION" == "--quiet" || "$ACTION" == "quiet" ]]; then
  if (( ${#matches[@]} > 0 )); then
    exit 10
  fi
  exit 0
fi

if (( ${#matches[@]} == 0 )); then
  echo 'macOS VPN/proxy conflict check: no known conflicting VPN/proxy/network-access clients detected.'
  exit 0
fi

cat <<'EOF'
macOS VPN/proxy conflict warning:
Detected other VPN/proxy/network-access clients. SophiaVPN will not automatically take over macOS system proxy while these processes are present.

Detected processes:
EOF

for item in "${matches[@]}"; do
  IFS='|' read -r category name pid command <<<"$item"
  printf '  - %s [%s], pid=%s\n    %s\n' "$name" "$category" "$pid" "$command"
done

cat <<'EOF'

Policy:
  - proxy-manager: likely manages local proxy ports or macOS system proxy; do not use automatic system-proxy takeover together.
  - vpn-client: may manage routes, DNS, kill-switch, or tunnel devices; SophiaVPN local proxy can run, but automatic system proxy is skipped.
  - network-access-vpn: campus/company/network-access clients may coexist with local proxy usage, but SophiaVPN still avoids automatic system-proxy takeover to prevent breaking access policy.

Use SophiaVPN in local-proxy mode, or close the detected software before enabling macOS system proxy.
EOF

exit 10

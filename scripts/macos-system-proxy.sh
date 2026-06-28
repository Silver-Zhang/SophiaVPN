#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-status}"
HTTP_PORT="${2:-4780}"
SOCKS_PORT="${3:-4781}"
HOST="127.0.0.1"
BYPASS="localhost,127.0.0.1,::1,*.local,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macos-system-proxy.sh only supports macOS." >&2
  exit 1
fi

if ! command -v networksetup >/dev/null 2>&1; then
  echo "networksetup is required on macOS." >&2
  exit 1
fi

list_services() {
  networksetup -listallnetworkservices | sed '1d' | sed 's/^\*//g' | awk 'NF {print}'
}

set_service_proxy() {
  local service="$1"
  networksetup -setwebproxy "$service" "$HOST" "$HTTP_PORT" off >/dev/null
  networksetup -setsecurewebproxy "$service" "$HOST" "$HTTP_PORT" off >/dev/null
  networksetup -setsocksfirewallproxy "$service" "$HOST" "$SOCKS_PORT" off >/dev/null
  networksetup -setproxybypassdomains "$service" $BYPASS >/dev/null
}

clear_service_proxy() {
  local service="$1"
  networksetup -setwebproxystate "$service" off >/dev/null || true
  networksetup -setsecurewebproxystate "$service" off >/dev/null || true
  networksetup -setsocksfirewallproxystate "$service" off >/dev/null || true
}

status_service_proxy() {
  local service="$1"
  local web secure socks
  web=$(networksetup -getwebproxy "$service" 2>/dev/null | tr '\n' ' ' || true)
  secure=$(networksetup -getsecurewebproxy "$service" 2>/dev/null | tr '\n' ' ' || true)
  socks=$(networksetup -getsocksfirewallproxy "$service" 2>/dev/null | tr '\n' ' ' || true)
  printf '%s\n  HTTP: %s\n  HTTPS: %s\n  SOCKS: %s\n' "$service" "$web" "$secure" "$socks"
}

case "$ACTION" in
  on|enable)
    while IFS= read -r service; do
      [[ -n "$service" ]] || continue
      set_service_proxy "$service"
    done < <(list_services)
    echo "macOS system proxy enabled: HTTP $HOST:$HTTP_PORT / SOCKS $HOST:$SOCKS_PORT"
    ;;
  off|disable)
    while IFS= read -r service; do
      [[ -n "$service" ]] || continue
      clear_service_proxy "$service"
    done < <(list_services)
    echo "macOS system proxy disabled"
    ;;
  status)
    while IFS= read -r service; do
      [[ -n "$service" ]] || continue
      status_service_proxy "$service"
    done < <(list_services)
    ;;
  *)
    echo "Usage: $0 on|off|status [http-port] [socks-port]" >&2
    exit 2
    ;;
esac

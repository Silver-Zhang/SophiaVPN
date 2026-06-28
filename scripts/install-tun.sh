#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${MIHOMO_VERSION:-v1.19.27}"
TARGET_DIR="/usr/local/libexec/silvervpn"
TARGET="$TARGET_DIR/mihomo"
LOG_DIR="$ROOT_DIR/logs"
LOG_FILE="$LOG_DIR/privileged-commands.log"
ARCH="$(uname -m)"

case "$ARCH" in
  x86_64|amd64)
    ASSET="mihomo-linux-amd64-compatible-$VERSION.gz"
    EXPECTED_SHA256="36850c946615f5c712946b62dbbbd06f6941d6d8a7543b315198bcb24ada3ea9"
    ;;
  aarch64|arm64)
    ASSET="mihomo-linux-arm64-$VERSION.gz"
    EXPECTED_SHA256="87db0c6660a9557a901b5750f997967e71d8c0af07ea1d1dd4d04c28da7f7e6f"
    ;;
  armv7l|armv7)
    ASSET="mihomo-linux-armv7-$VERSION.gz"
    EXPECTED_SHA256="29c8dfb219247f9a9bde94c01fe2b911a2e94e8e2e67fa30c04b4905ed3ef5d0"
    ;;
  *)
    echo "Unsupported TUN architecture: $ARCH" >&2
    exit 1
    ;;
esac

URL="https://github.com/MetaCubeX/mihomo/releases/download/$VERSION/$ASSET"
archive="$(mktemp)"
binary="$(mktemp)"
cleanup() {
  rm -f "$archive" "$binary"
}
trap cleanup EXIT

mkdir -p "$LOG_DIR"

echo "Downloading official mihomo TUN core: $URL"
curl -fL --connect-timeout 20 --max-time 300 -o "$archive" "$URL"
echo "$EXPECTED_SHA256  $archive" | sha256sum --check -
gzip -dc "$archive" > "$binary"
chmod 0755 "$binary"
"$binary" -v >/dev/null

{
  printf '[%s] sudo install -d -o root -g root -m 0755 %q\n' "$(date --iso-8601=seconds)" "$TARGET_DIR"
  printf '[%s] sudo install -o root -g root -m 0755 <verified-mihomo> %q\n' "$(date --iso-8601=seconds)" "$TARGET"
  printf '[%s] sudo setcap cap_net_admin=ep %q\n' "$(date --iso-8601=seconds)" "$TARGET"
} >> "$LOG_FILE"

sudo install -d -o root -g root -m 0755 "$TARGET_DIR"
sudo install -o root -g root -m 0755 "$binary" "$TARGET"
sudo setcap cap_net_admin=ep "$TARGET"

owner="$(stat -c '%U:%G' "$TARGET")"
capabilities="$(getcap "$TARGET")"
if [[ "$owner" != "root:root" || "$capabilities" != *"cap_net_admin=ep"* ]]; then
  echo "TUN core installation verification failed." >&2
  exit 1
fi

echo "Installed SilverVPN TUN core: $TARGET"
echo "Owner: $owner"
echo "Capabilities: $capabilities"

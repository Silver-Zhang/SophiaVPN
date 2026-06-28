#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT_DIR/resources/clash-binaries"
ARCH="$(uname -m)"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
VERSION="${MIHOMO_VERSION:-v1.19.27}"
DRY_RUN=0
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=1
      ;;
    --force)
      FORCE=1
      ;;
    --version=*)
      VERSION="${arg#--version=}"
      ;;
    --version)
      echo "--version requires --version=vX.Y.Z" >&2
      exit 2
      ;;
  esac
done

case "$ARCH" in
  x86_64|amd64)
    TARGET_ARCH="amd64"
    ;;
  aarch64|arm64)
    TARGET_ARCH="arm64"
    ;;
  armv7l|armv7)
    TARGET_ARCH="armv7"
    ;;
  *)
    TARGET_ARCH="$ARCH"
    ;;
esac

case "$OS" in
  linux)
    if [[ "$TARGET_ARCH" == "amd64" ]]; then
      ASSETS=("mihomo-linux-amd64-compatible-$VERSION.gz" "mihomo-linux-amd64-$VERSION.gz")
    else
      ASSETS=("mihomo-linux-$TARGET_ARCH-$VERSION.gz")
    fi
    TARGET="$BIN_DIR/mihomo-linux-$TARGET_ARCH"
    ;;
  darwin)
    if [[ "$TARGET_ARCH" != "amd64" && "$TARGET_ARCH" != "arm64" ]]; then
      echo "Unsupported macOS architecture: $ARCH" >&2
      exit 1
    fi
    ASSETS=("mihomo-darwin-$TARGET_ARCH-$VERSION.gz")
    TARGET="$BIN_DIR/mihomo-darwin-$TARGET_ARCH"
    ;;
  *)
    echo "Unsupported OS: $OS" >&2
    exit 1
    ;;
esac

mkdir -p "$BIN_DIR"

if [[ -n "${MIHOMO_DOWNLOAD_URL:-}" ]]; then
  URLS=("$MIHOMO_DOWNLOAD_URL")
else
  URLS=()
  for asset in "${ASSETS[@]}"; do
    URLS+=("https://github.com/MetaCubeX/mihomo/releases/download/$VERSION/$asset")
  done
fi

echo "SilverVPN core target: $TARGET"
printf 'Candidate downloads:\n'
printf '  %s\n' "${URLS[@]}"

if [[ "$DRY_RUN" == "1" ]]; then
  exit 0
fi

if [[ "$FORCE" != "1" && -x "$TARGET" ]]; then
  if "$TARGET" -v >/dev/null 2>&1; then
    echo "Existing mihomo core is usable: $TARGET"
    exit 0
  fi
fi

if command -v mihomo >/dev/null 2>&1; then
  echo "System mihomo is already available: $(command -v mihomo)"
fi

tmp="$(mktemp)"
cleanup() {
  rm -f "$tmp"
}
trap cleanup EXIT

downloaded=0
for url in "${URLS[@]}"; do
  echo "Downloading $url"
  if curl -fL --connect-timeout 20 --max-time 300 -o "$tmp" "$url"; then
    downloaded=1
    break
  fi
done

if [[ "$downloaded" != "1" ]]; then
  cat >&2 <<EOF
Failed to download mihomo.

You can retry with a proxy, for example:
  HTTPS_PROXY=http://127.0.0.1:4780 ./scripts/install-core.sh

Or provide a direct asset URL:
  MIHOMO_DOWNLOAD_URL=https://... ./scripts/install-core.sh
EOF
  exit 1
fi

gzip -dc "$tmp" > "$TARGET"
chmod +x "$TARGET"
"$TARGET" -v >/dev/null
echo "Installed mihomo core: $TARGET"

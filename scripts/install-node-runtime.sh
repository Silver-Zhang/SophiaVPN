#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${SOPHIA_NODE_VERSION:-v22.13.1}"
RUNTIME_DIR="$ROOT_DIR/resources/node-runtime"
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) PLATFORM="darwin"; EXT="tar.gz"; TAR_FLAG="z" ;;
  Linux) PLATFORM="linux"; EXT="tar.xz"; TAR_FLAG="J" ;;
  *)
    echo "Unsupported OS for bundled Node runtime: $OS" >&2
    exit 1
    ;;
esac

case "$ARCH" in
  arm64|aarch64) NODE_ARCH="arm64" ;;
  x86_64|amd64) NODE_ARCH="x64" ;;
  *)
    echo "Unsupported architecture for bundled Node runtime: $ARCH" >&2
    exit 1
    ;;
esac

TARGET_NODE="$RUNTIME_DIR/bin/node"
TARGET_NPM="$RUNTIME_DIR/bin/npm"
STAMP="$RUNTIME_DIR/.sophia-node-version"
DIST="node-$VERSION-$PLATFORM-$NODE_ARCH"
ARCHIVE="$DIST.$EXT"
URL="${SOPHIA_NODE_URL:-https://nodejs.org/dist/$VERSION/$ARCHIVE}"

if [[ -x "$TARGET_NODE" && -x "$TARGET_NPM" && -f "$STAMP" ]] && grep -qx "$VERSION" "$STAMP"; then
  echo "Bundled Node runtime is ready: $TARGET_NODE"
  exit 0
fi

tmpdir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

echo "Installing bundled Node runtime: $DIST"
echo "Downloading $URL"
curl -fL --connect-timeout 20 --max-time 300 -o "$tmpdir/$ARCHIVE" "$URL"
mkdir -p "$tmpdir/extract"
tar -"x${TAR_FLAG}f" "$tmpdir/$ARCHIVE" -C "$tmpdir/extract"

rm -rf "$RUNTIME_DIR"
mkdir -p "$RUNTIME_DIR"
cp -R "$tmpdir/extract/$DIST/." "$RUNTIME_DIR/"
chmod 0755 "$TARGET_NODE"
printf '%s\n' "$VERSION" > "$STAMP"

"$TARGET_NODE" --version
PATH="$RUNTIME_DIR/bin:$PATH" "$TARGET_NPM" --version >/dev/null
echo "Bundled Node runtime installed: $TARGET_NODE"

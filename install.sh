#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/sreeragh-s/mucode.git"
INSTALL_DIR="${MUCODE_INSTALL_DIR:-$HOME/.mucode}"
BIN_DIR="${MUCODE_BIN_DIR:-$HOME/.local/bin}"
BIN_PATH="$BIN_DIR/mucode"

if ! command -v git >/dev/null 2>&1; then
  echo "mucode requires git to install." >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "mucode requires Bun. Install it from https://bun.sh, then rerun this installer." >&2
  exit 1
fi

mkdir -p "$BIN_DIR"

if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only
else
  rm -rf "$INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
bun install

cat > "$BIN_PATH" <<EOF
#!/usr/bin/env bash
cd "$INSTALL_DIR"
exec bun run start "\$@"
EOF

chmod +x "$BIN_PATH"

echo "mucode installed at $INSTALL_DIR"
echo "Launcher written to $BIN_PATH"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Add $BIN_DIR to PATH to run mucode from any directory." ;;
esac

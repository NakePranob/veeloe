#!/bin/sh
# Installs the Veeloe Runtime (`veeloe`) from the latest GitHub Release:
#
#   curl -fsSL https://github.com/NakePranob/veeloe/releases/latest/download/install.sh | sh
#
# It downloads the binary for this OS and CPU, checks it against the release's
# SHA256SUMS, and puts it in ~/.local/bin (VEELOE_BIN_DIR to change). It never
# runs `veeloe`: pairing asks at a terminal, and `curl | sh` has none.
#
# ponytail: SHA-256 over HTTPS proves the download is whole, not who built it.
# The Ed25519-signed manifest (ADR 0009) comes with the updater in v0.3, before
# anyone but the Owner installs this.
set -eu

repo="NakePranob/veeloe"
# VEELOE_VERSION=v0.1.0 pins a release; empty means the latest.
version="${VEELOE_VERSION:-}"
bin_dir="${VEELOE_BIN_DIR:-$HOME/.local/bin}"

say() { printf '%s\n' "$*"; }
fail() { printf 'veeloe install: %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "$(uname -s) is not supported. On Windows, install the Linux build inside WSL2." ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch=$([ "$os" = darwin ] && echo arm64 || echo aarch64) ;;
  x86_64 | amd64) arch=x86_64 ;;
  *) fail "$(uname -m) is not supported." ;;
esac
asset="veeloe-$os-$arch"
[ "$asset" = "veeloe-darwin-x86_64" ] && fail "Intel Macs are not built yet; only Apple silicon."

if [ -n "${VEELOE_RELEASE_URL:-}" ]; then
  # Another place that holds the same files, such as a mirror or a test folder (file://).
  base="$VEELOE_RELEASE_URL"
elif [ -n "$version" ]; then
  base="https://github.com/$repo/releases/download/$version"
else
  base="https://github.com/$repo/releases/latest/download"
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then
  sha() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else
  fail "needs sha256sum or shasum to check the download."
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

say "Downloading $asset ..."
curl -fsSL "$base/$asset" -o "$tmp/$asset" || fail "could not download $base/$asset"
curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS" || fail "could not download $base/SHA256SUMS"

want=$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1 }' "$tmp/SHA256SUMS")
[ -n "$want" ] || fail "SHA256SUMS has no line for $asset"
got=$(sha "$tmp/$asset")
[ "$got" = "$want" ] || fail "checksum mismatch for $asset (got $got, want $want). Nothing was installed."

mkdir -p "$bin_dir"
chmod 0755 "$tmp/$asset"
# Replace in one step, so a running `veeloe` keeps its old file until it restarts.
mv -f "$tmp/$asset" "$bin_dir/veeloe"
say "Installed $bin_dir/veeloe"

case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) say "" ; say "$bin_dir is not on your PATH. Add it, for example:" ; say "  echo 'export PATH=\"$bin_dir:\$PATH\"' >> ~/.profile" ;;
esac

say ""
say "Next:"
say "  veeloe                   pair this Machine with the Veeloe app and add a Provider"
say "  veeloe service install   keep it running after you log out"
if [ "$os" = linux ]; then
  say ""
  say "The sandbox needs bubblewrap, socat and ripgrep; \`veeloe\` says which are missing when it starts."
fi

#!/usr/bin/env bash
# Downloads the pinned pdfium build (bblanchon/pdfium-binaries) used for PDF
# support into app/src-tauri/pdfium/<target>/ (gitignored). The build script
# (build.rs) stages the right one for the Tauri bundle.
#
# Usage: scripts/fetch-pdfium.sh [mac-arm64|mac-x64|win-x64 ...]   (default: all three)
set -euo pipefail

# Must match the pdfium-render feature in engine/Cargo.toml (pdfium_7881).
RELEASE="chromium/7881"
BASE="https://github.com/bblanchon/pdfium-binaries/releases/download/${RELEASE/\//%2F}"

here="$(cd "$(dirname "$0")/.." && pwd)"
targets=("$@")
[ ${#targets[@]} -eq 0 ] && targets=(mac-arm64 mac-x64 win-x64)

for t in "${targets[@]}"; do
  case "$t" in
    mac-arm64|mac-x64) lib="lib/libpdfium.dylib" ;;
    win-x64) lib="bin/pdfium.dll" ;;
    *) echo "Unknown target: $t (use mac-arm64, mac-x64 or win-x64)" >&2; exit 1 ;;
  esac
  dest="$here/pdfium/$t"
  if [ -f "$dest/$(basename "$lib")" ]; then
    echo "pdfium $t: already present"
    continue
  fi
  tmp="$(mktemp -d)"
  echo "pdfium $t: downloading $RELEASE"
  curl -fsSL "$BASE/pdfium-$t.tgz" -o "$tmp/pdfium.tgz"
  tar -xzf "$tmp/pdfium.tgz" -C "$tmp" "$lib" LICENSE
  mkdir -p "$dest"
  mv "$tmp/$lib" "$dest/"
  mv "$tmp/LICENSE" "$dest/LICENSE-pdfium.txt"
  rm -rf "$tmp"
  echo "pdfium $t: installed in $dest"
done

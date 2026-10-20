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
  # SHA-256 of each pinned archive (as published by GitHub for the release).
  case "$t" in
    mac-arm64) lib="lib/libpdfium.dylib"; sha="52e94ca5aa8847934330daf3f8150c190682c5ca93831468794f8b90d4392e40" ;;
    mac-x64) lib="lib/libpdfium.dylib"; sha="6dedf83990e0e3d6b7c93c9e7589c5a126b0ae14b7464d76120cff7a26afb18b" ;;
    win-x64) lib="bin/pdfium.dll"; sha="73cc0de638ac2095e7445bf56a38200a5b7c7ca0e9f4ba144598f2457377ac08" ;;
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
  got="$(shasum -a 256 "$tmp/pdfium.tgz" | cut -d' ' -f1)"
  if [ "$got" != "$sha" ]; then
    rm -rf "$tmp"
    echo "pdfium $t: CHECKSUM MISMATCH (expected $sha, got $got) — not installed" >&2
    exit 1
  fi
  tar -xzf "$tmp/pdfium.tgz" -C "$tmp" "$lib" LICENSE
  mkdir -p "$dest"
  mv "$tmp/$lib" "$dest/"
  mv "$tmp/LICENSE" "$dest/LICENSE-pdfium.txt"
  rm -rf "$tmp"
  echo "pdfium $t: installed in $dest"
done

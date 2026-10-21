#!/usr/bin/env bash
# Downloads the pinned Real-ESRGAN upscaler (xinntao/Real-ESRGAN, realesrgan-ncnn-vulkan
# v0.2.5.0) used by "Enhance" into app/src-tauri/realesrgan/<target>/ (gitignored). The build
# script (build.rs) stages the right one for the Tauri bundle.
#
# Usage: scripts/fetch-realesrgan.sh [win|mac ...]   (default: both)
set -euo pipefail

BASE="https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0"
here="$(cd "$(dirname "$0")/.." && pwd)"
targets=("$@")
[ ${#targets[@]} -eq 0 ] && targets=(win mac)

# Only the models the app uses: the fast artwork model (2x/3x/4x) and the photo model.
models=()
for m in realesr-animevideov3-x2 realesr-animevideov3-x3 realesr-animevideov3-x4 realesrgan-x4plus; do
  models+=("models/$m.bin" "models/$m.param")
done
# The archives carry no licence files; these are the projects' own, pinned.
licences=(
  "https://raw.githubusercontent.com/xinntao/Real-ESRGAN/v0.2.5.0/LICENSE LICENSE-Real-ESRGAN.txt 4a699ec4863d96a91fc265948a0c90033f7e8735d515524dcf3444736406e0c2"
  "https://raw.githubusercontent.com/xinntao/Real-ESRGAN-ncnn-vulkan/37026f49824c5cf84062e7c6a5dd71445dcf610f/LICENSE LICENSE-realesrgan-ncnn-vulkan.txt 5abb941454de437b0e90d78dcb72e3688f74e14bcd4e24393273cb5cd0e9c937"
)

get_checked() { # url out sha
  curl -fsSL "$1" -o "$2"
  local got
  got="$(shasum -a 256 "$2" | cut -d' ' -f1)"
  if [ "$got" != "$3" ]; then
    echo "CHECKSUM MISMATCH for $1 (expected $3, got $got) — not installed" >&2
    return 1
  fi
}

for t in "${targets[@]}"; do
  # SHA-256 of each pinned archive (as published by GitHub for the release).
  case "$t" in
    win) zip="realesrgan-ncnn-vulkan-20220424-windows.zip"; files=(realesrgan-ncnn-vulkan.exe vcomp140.dll); sha="abc02804e17982a3be33675e4d471e91ea374e65b70167abc09e31acb412802d" ;;
    mac) zip="realesrgan-ncnn-vulkan-20220424-macos.zip"; files=(realesrgan-ncnn-vulkan); sha="e0ad05580abfeb25f8d8fb55aaf7bedf552c375b5b4d9bd3c8d59764d2cc333a" ;;
    *) echo "Unknown target: $t (use win or mac)" >&2; exit 1 ;;
  esac
  dest="$here/realesrgan/$t"
  if [ -f "$dest/${files[0]}" ]; then
    echo "realesrgan $t: already present"
    continue
  fi
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  echo "realesrgan $t: downloading $zip"
  get_checked "$BASE/$zip" "$tmp/r.zip" "$sha"
  names=()
  for l in "${licences[@]}"; do
    read -r url name lsha <<<"$l"
    get_checked "$url" "$tmp/$name" "$lsha"
    names+=("$name")
  done
  unzip -q "$tmp/r.zip" "${files[@]}" "${models[@]}" -d "$tmp"
  mkdir -p "$dest/models"
  for f in "${files[@]}" "${models[@]}" "${names[@]}"; do
    mv "$tmp/$f" "$dest/$f"
  done
  chmod +x "$dest/${files[0]}"
  rm -rf "$tmp"
  trap - EXIT
  echo "realesrgan $t: installed in $dest"
done

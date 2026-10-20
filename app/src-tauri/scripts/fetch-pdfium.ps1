# Downloads the pinned pdfium build (bblanchon/pdfium-binaries) used for PDF
# support into app/src-tauri/pdfium/<target>/ (gitignored). The build script
# (build.rs) stages the right one for the Tauri bundle.
#
# Usage: scripts\fetch-pdfium.ps1 [mac-arm64|mac-x64|win-x64 ...]   (default: all three)
param([string[]]$Targets = @('mac-arm64', 'mac-x64', 'win-x64'))
$ErrorActionPreference = 'Stop'

# Must match the pdfium-render feature in engine/Cargo.toml (pdfium_7881).
$Release = 'chromium/7881'
$Base = "https://github.com/bblanchon/pdfium-binaries/releases/download/$($Release -replace '/', '%2F')"
$Here = Split-Path -Parent $PSScriptRoot

foreach ($t in $Targets) {
  # SHA-256 of each pinned archive (as published by GitHub for the release).
  switch ($t) {
    'mac-arm64' { $lib = 'lib/libpdfium.dylib'; $sha = '52e94ca5aa8847934330daf3f8150c190682c5ca93831468794f8b90d4392e40' }
    'mac-x64' { $lib = 'lib/libpdfium.dylib'; $sha = '6dedf83990e0e3d6b7c93c9e7589c5a126b0ae14b7464d76120cff7a26afb18b' }
    'win-x64' { $lib = 'bin/pdfium.dll'; $sha = '73cc0de638ac2095e7445bf56a38200a5b7c7ca0e9f4ba144598f2457377ac08' }
    default { throw "Unknown target: $t (use mac-arm64, mac-x64 or win-x64)" }
  }
  $dest = Join-Path $Here "pdfium/$t"
  if (Test-Path (Join-Path $dest (Split-Path $lib -Leaf))) {
    Write-Host "pdfium ${t}: already present"
    continue
  }
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid())
  New-Item -ItemType Directory $tmp | Out-Null
  Write-Host "pdfium ${t}: downloading $Release"
  Invoke-WebRequest "$Base/pdfium-$t.tgz" -OutFile (Join-Path $tmp 'pdfium.tgz')
  $got = (Get-FileHash -Algorithm SHA256 (Join-Path $tmp 'pdfium.tgz')).Hash.ToLowerInvariant()
  if ($got -ne $sha) {
    Remove-Item -Recurse -Force $tmp
    throw "pdfium ${t}: CHECKSUM MISMATCH (expected $sha, got $got) - not installed"
  }
  tar -xzf (Join-Path $tmp 'pdfium.tgz') -C $tmp $lib LICENSE
  if ($LASTEXITCODE -ne 0) { throw "Could not unpack pdfium-$t.tgz" }
  New-Item -ItemType Directory -Force $dest | Out-Null
  Move-Item (Join-Path $tmp $lib) $dest -Force
  Move-Item (Join-Path $tmp 'LICENSE') (Join-Path $dest 'LICENSE-pdfium.txt') -Force
  Remove-Item -Recurse -Force $tmp
  Write-Host "pdfium ${t}: installed in $dest"
}

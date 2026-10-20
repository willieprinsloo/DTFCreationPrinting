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
  switch ($t) {
    { $_ -in 'mac-arm64', 'mac-x64' } { $lib = 'lib/libpdfium.dylib' }
    'win-x64' { $lib = 'bin/pdfium.dll' }
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
  tar -xzf (Join-Path $tmp 'pdfium.tgz') -C $tmp $lib LICENSE
  if ($LASTEXITCODE -ne 0) { throw "Could not unpack pdfium-$t.tgz" }
  New-Item -ItemType Directory -Force $dest | Out-Null
  Move-Item (Join-Path $tmp $lib) $dest -Force
  Move-Item (Join-Path $tmp 'LICENSE') (Join-Path $dest 'LICENSE-pdfium.txt') -Force
  Remove-Item -Recurse -Force $tmp
  Write-Host "pdfium ${t}: installed in $dest"
}

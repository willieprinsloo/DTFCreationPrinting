# Downloads the pinned Real-ESRGAN upscaler (xinntao/Real-ESRGAN, realesrgan-ncnn-vulkan
# v0.2.5.0) used by "Enhance" into app/src-tauri/realesrgan/<target>/ (gitignored). The build
# script (build.rs) stages the right one for the Tauri bundle.
#
# Usage: scripts\fetch-realesrgan.ps1 [win|mac ...]   (default: both)
param([string[]]$Targets = @('win', 'mac'))
$ErrorActionPreference = 'Stop'

$Base = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0'
$Here = Split-Path -Parent $PSScriptRoot
# Only the models the app uses: the fast artwork model (2x/3x/4x) and the photo model.
$Models = @('realesr-animevideov3-x2', 'realesr-animevideov3-x3', 'realesr-animevideov3-x4', 'realesrgan-x4plus') |
  ForEach-Object { "models/$_.bin"; "models/$_.param" }
# The archives carry no licence files; these are the projects' own, pinned.
$Licences = @(
  @{ Url = 'https://raw.githubusercontent.com/xinntao/Real-ESRGAN/v0.2.5.0/LICENSE'; Name = 'LICENSE-Real-ESRGAN.txt'; Sha = '4a699ec4863d96a91fc265948a0c90033f7e8735d515524dcf3444736406e0c2' },
  @{ Url = 'https://raw.githubusercontent.com/xinntao/Real-ESRGAN-ncnn-vulkan/37026f49824c5cf84062e7c6a5dd71445dcf610f/LICENSE'; Name = 'LICENSE-realesrgan-ncnn-vulkan.txt'; Sha = '5abb941454de437b0e90d78dcb72e3688f74e14bcd4e24393273cb5cd0e9c937' }
)

function Get-Checked($url, $out, $sha) {
  Invoke-WebRequest $url -OutFile $out
  $got = (Get-FileHash -Algorithm SHA256 $out).Hash.ToLowerInvariant()
  if ($got -ne $sha) { throw "CHECKSUM MISMATCH for $url (expected $sha, got $got) - not installed" }
}

foreach ($t in $Targets) {
  # SHA-256 of each pinned archive (as published by GitHub for the release).
  switch ($t) {
    'win' { $zip = 'realesrgan-ncnn-vulkan-20220424-windows.zip'; $files = @('realesrgan-ncnn-vulkan.exe', 'vcomp140.dll'); $sha = 'abc02804e17982a3be33675e4d471e91ea374e65b70167abc09e31acb412802d' }
    'mac' { $zip = 'realesrgan-ncnn-vulkan-20220424-macos.zip'; $files = @('realesrgan-ncnn-vulkan'); $sha = 'e0ad05580abfeb25f8d8fb55aaf7bedf552c375b5b4d9bd3c8d59764d2cc333a' }
    default { throw "Unknown target: $t (use win or mac)" }
  }
  $dest = Join-Path $Here "realesrgan/$t"
  if (Test-Path (Join-Path $dest $files[0])) {
    Write-Host "realesrgan ${t}: already present"
    continue
  }
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid())
  New-Item -ItemType Directory $tmp | Out-Null
  try {
    Write-Host "realesrgan ${t}: downloading $zip"
    Get-Checked "$Base/$zip" (Join-Path $tmp 'r.zip') $sha
    foreach ($l in $Licences) { Get-Checked $l.Url (Join-Path $tmp $l.Name) $l.Sha }
    tar -xf (Join-Path $tmp 'r.zip') -C $tmp @($files + $Models)
    if ($LASTEXITCODE -ne 0) { throw "Could not unpack $zip" }
    New-Item -ItemType Directory -Force (Join-Path $dest 'models') | Out-Null
    foreach ($f in $files + $Models + ($Licences | ForEach-Object { $_.Name })) {
      Move-Item (Join-Path $tmp $f) (Join-Path $dest $f) -Force
    }
    Write-Host "realesrgan ${t}: installed in $dest"
  } finally {
    Remove-Item -Recurse -Force $tmp
  }
}

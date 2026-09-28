# Checks the installer and every exe/dll packed inside it. Users run the unpacked playcounter.exe,
# not target\release\playcounter.exe, and the bundler changes the packed copy.
# Every exe must be validly signed. DLLs may be unsigned (makensis packs its stock plugins unsigned
# even though Tauri signs copies of them), but a broken signature is never allowed.
param(
  [Parameter(Mandatory = $true)]
  [string]$Installer
)

$ErrorActionPreference = "Stop"

$unpacked = Join-Path ([System.IO.Path]::GetTempPath()) "playcounter-installer-$([guid]::NewGuid())"
& 7z x -y "-o$unpacked" $Installer | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "7-Zip could not unpack $Installer."
}

$files = @(Get-Item -LiteralPath $Installer) + @(Get-ChildItem -LiteralPath $unpacked -Recurse -File -Include *.exe, *.dll)
if (-not ($files | Where-Object Name -eq "playcounter.exe")) {
  throw "playcounter.exe not found inside $Installer."
}

$failed = @()
foreach ($file in $files) {
  $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
  Write-Host "$($signature.Status): $($file.FullName) ($($signature.SignerCertificate.Subject))"
  $unsignedDll = $file.Extension -eq ".dll" -and $signature.Status -eq "NotSigned"
  if ($signature.Status -ne "Valid" -and -not $unsignedDll) {
    $failed += "$($file.Name): $($signature.Status)"
  }
}

Remove-Item -LiteralPath $unpacked -Recurse -Force

if ($failed.Count -gt 0) {
  throw "Invalid Authenticode signature: $($failed -join '; ')"
}

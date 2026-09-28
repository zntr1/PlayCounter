# Tauri calls this once per file it signs (bundle.windows.signCommand): playcounter.exe after
# the bundler patched its bundle type in, the NSIS plugins, the uninstaller and the installer.
# Signing playcounter.exe before `tauri bundle` shipped it with a broken signature (1.1.13 - 1.3.0).
param(
  [Parameter(Mandatory = $true)]
  [string]$File
)

$ErrorActionPreference = "Stop"

$description = if ($File -like "*-setup.exe") { "PlayCounter Installer" } else { "PlayCounter" }

$params = @{
  Endpoint                     = $env:AZURE_ARTIFACT_SIGNING_ENDPOINT
  CodeSigningAccountName       = $env:AZURE_ARTIFACT_SIGNING_ACCOUNT
  CertificateProfileName       = $env:AZURE_ARTIFACT_SIGNING_PROFILE
  Files                        = $File
  FileDigest                   = "SHA256"
  TimestampRfc3161             = "http://timestamp.acs.microsoft.com"
  TimestampDigest              = "SHA256"
  Description                  = $description
  DescriptionUrl               = "https://playcounter.app"
  ExcludeEnvironmentCredential = $true
  ExcludeAzureCliCredential    = $false
}

Invoke-ArtifactSigning @params

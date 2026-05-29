@echo off
setlocal

set "VSDEVCMD=%ProgramFiles%\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat"
if not exist "%VSDEVCMD%" set "VSDEVCMD=%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"
if not exist "%VSDEVCMD%" set "VSDEVCMD=%ProgramFiles%\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"

if not exist "%VSDEVCMD%" (
  echo Visual Studio C++ Build Tools were not found.
  echo Install "Desktop development with C++" from the Visual Studio Installer.
  exit /b 1
)

call "%VSDEVCMD%" -arch=x64
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

if defined TAURI_SIGNING_PRIVATE_KEY (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '' }; corepack pnpm --filter @playcounter/desktop tauri build --ci; exit $LASTEXITCODE"
  exit /b %ERRORLEVEL%
)

if exist "%CD%\apps\desktop\src-tauri\playcounter-updater.key" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw -LiteralPath '%CD%\apps\desktop\src-tauri\playcounter-updater.key'; if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '' }; corepack pnpm --filter @playcounter/desktop tauri build --ci; exit $LASTEXITCODE"
  exit /b %ERRORLEVEL%
)

corepack pnpm --filter @playcounter/desktop tauri build --ci

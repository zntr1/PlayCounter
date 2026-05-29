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
corepack pnpm --filter @playcounter/desktop tauri dev

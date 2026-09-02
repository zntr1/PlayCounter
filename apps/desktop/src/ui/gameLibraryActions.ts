export function libraryContextActions(input: {
  demo: boolean;
  isWindows: boolean;
  launcherEnabled: boolean;
  hasImport: boolean;
  installed: boolean;
}) {
  const showOpenInLauncher = !input.demo && input.isWindows && input.hasImport;

  return {
    showOpenInLauncher,
    showPlayInLauncher:
      showOpenInLauncher && input.launcherEnabled && input.installed,
  };
}

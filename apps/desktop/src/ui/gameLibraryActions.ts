export function steamContextActions(input: {
  demo: boolean;
  isWindows: boolean;
  launcherEnabled: boolean;
  hasImport: boolean;
  installed: boolean;
}) {
  const showOpenInSteam = !input.demo && input.isWindows && input.hasImport;

  return {
    showOpenInSteam,
    showPlayInSteam:
      showOpenInSteam && input.launcherEnabled && input.installed,
  };
}

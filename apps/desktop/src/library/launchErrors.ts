import { launchErrorDetail, launchErrorKind } from "../gameLaunch";

/**
 * Launcher installs live outside PlayCounter, so a saved install can disappear
 * while the import stays. A missing installation is the one launch failure that
 * proves the stored install is stale.
 */
export function shouldForgetLibraryInstallOnLaunchError(error: unknown) {
  return launchErrorKind(error) === "notFound";
}

export function libraryLaunchErrorMessage(
  error: unknown,
  gameName: string,
  providerLabel: string,
) {
  const detail = launchErrorDetail(error);
  switch (launchErrorKind(error)) {
    case "notFound":
      return {
        title: `${gameName} is not installed`,
        detail: `Windows no longer has this ${providerLabel} game installed. Install it again in ${providerLabel} to start it from PlayCounter.`,
      };
    case "invalidPath":
      return {
        title: `Could not start ${gameName}`,
        detail: `PlayCounter could not read this ${providerLabel} entry. Import your ${providerLabel} library again.`,
      };
    case "unsupported":
      return {
        title: "Only available on Windows",
        detail: `Starting ${providerLabel} games works on Windows.`,
      };
    default:
      return { title: `Could not start ${gameName}`, detail };
  }
}

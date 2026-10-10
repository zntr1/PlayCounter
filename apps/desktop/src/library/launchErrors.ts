import { launchErrorDetail, launchErrorKind } from "../gameLaunch";
import { getT } from "../i18n";

const t = getT("import");

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
        title: t("{{gameName}} is not installed", { gameName }),
        detail: t(
          "Windows no longer has this {{providerLabel}} game installed. Install it again in {{providerLabel}} to start it from PlayCounter.",
          { providerLabel },
        ),
      };
    case "invalidPath":
      return {
        title: t("Could not start {{gameName}}", { gameName }),
        detail: t(
          "PlayCounter could not read this {{providerLabel}} entry. Import your {{providerLabel}} library again.",
          { providerLabel },
        ),
      };
    case "unsupported":
      return {
        title: t("Only available on Windows"),
        detail: t("Starting {{providerLabel}} games works on Windows.", {
          providerLabel,
        }),
      };
    default:
      return { title: t("Could not start {{gameName}}", { gameName }), detail };
  }
}

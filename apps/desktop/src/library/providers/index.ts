import type { LibraryProviderId } from "@playcounter/shared";
import type { LocalLibraryProvider } from "../provider";

export async function loadLibraryProvider(
  id: LibraryProviderId,
): Promise<LocalLibraryProvider> {
  switch (id) {
    case "battlenet":
      return (await import("./battlenet")).battleNetProvider;
    case "epic":
      return (await import("./epic")).epicProvider;
    case "steam":
      return (await import("./steam")).steamProvider;
    case "xbox":
      return (await import("./xbox")).xboxProvider;
  }
}

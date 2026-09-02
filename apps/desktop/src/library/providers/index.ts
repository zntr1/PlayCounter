import type { LibraryProviderId } from "@playcounter/shared";
import type { LocalLibraryProvider } from "../provider";

export async function loadLibraryProvider(
  id: LibraryProviderId,
): Promise<LocalLibraryProvider> {
  switch (id) {
    case "steam":
      return (await import("./steam")).steamProvider;
    case "xbox":
      return (await import("./xbox")).xboxProvider;
  }
}

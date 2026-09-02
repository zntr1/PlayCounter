import type {
  LibraryProviderId,
  XboxImportProgressStage,
} from "@playcounter/shared";
import type {
  LibraryScanResult,
  LocalLibraryAccount,
  ProviderStatus,
} from "./types";

export type LibraryScanOptions = {
  apiEndpoint?: string;
  signal?: AbortSignal;
  onAuthorizeUrl?: (url: string) => void;
  onXboxProgress?: (stage: XboxImportProgressStage) => void;
  openAuthorizeUrl?: boolean;
};

export type LocalLibraryProvider = {
  id: LibraryProviderId;
  label: string;
  detect(): Promise<ProviderStatus>;
  listAccounts(): Promise<LocalLibraryAccount[]>;
  scan(
    accountId: number,
    options?: LibraryScanOptions,
  ): Promise<LibraryScanResult>;
  launch(externalId: string, mode?: "play" | "store"): Promise<void>;
};

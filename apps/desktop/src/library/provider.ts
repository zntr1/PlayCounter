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
  onRateLimitWait?: (waiting: boolean) => void;
  openAuthorizeUrl?: boolean;
  /** Explicit user action only; background scans must never open sign-in. */
  battleNetAccount?: boolean;
  battleNetProductIds?: readonly string[];
};

export type LocalLibraryProvider = {
  id: LibraryProviderId;
  label: string;
  accountMode?: "none";
  detect(): Promise<ProviderStatus>;
  listAccounts(): Promise<LocalLibraryAccount[]>;
  scan(
    accountId: number,
    options?: LibraryScanOptions,
  ): Promise<LibraryScanResult>;
  launch(
    externalId: string,
    mode?: "play" | "store" | "install",
  ): Promise<void>;
};

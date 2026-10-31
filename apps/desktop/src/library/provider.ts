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
  /** Called as the scan moves from the account to the installs on this PC. */
  onStage?: (stage: "account" | "installs") => void;
  openAuthorizeUrl?: boolean;
  /** Background work: never create an interactive OAuth attempt. */
  savedLoginOnly?: boolean;
  /** Explicit user action only; background scans must never open sign-in. */
  battleNetAccount?: boolean;
  battleNetProductIds?: readonly string[];
  /** Explicit user action only; background scans must never open sign-in. */
  epicAccount?: boolean;
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

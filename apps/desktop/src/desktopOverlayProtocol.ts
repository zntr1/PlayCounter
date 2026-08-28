export type DesktopOverlayKind =
  | "action-required"
  | "milestone"
  | "first-detection"
  | "session-summary"
  | "session-start"
  | "discovery";

export type DesktopOverlayAction = "open-now-playing" | "open-discovered";

export type DesktopOverlayMessage = {
  id: string;
  sequence: number;
  kind: DesktopOverlayKind;
  /** Processes whose game window should receive a launch notification. */
  targetPids?: number[];
  priority: number;
  kicker: string;
  title: string;
  body?: string;
  metric?: string;
  status?: "live";
  coverUrl?: string;
  action?: DesktopOverlayAction;
  actionLabel?: string;
  theme: "dark" | "light";
  accentColor: string | null;
  reducedMotion: boolean;
  durationMs: number;
  createdAtMs: number;
  expiresAtMs: number;
};

export type OverlayRenderContext = {
  nowMs: number;
  theme: "dark" | "light";
  accentColor: string | null;
  reducedMotion: boolean;
};

export const OVERLAY_SHOW_EVENT = "playcounter:overlay-show";
export const OVERLAY_CLEAR_EVENT = "playcounter:overlay-clear";
export const OVERLAY_FINISHED_EVENT = "playcounter:overlay-finished";
export const OVERLAY_ACTION_EVENT = "playcounter:overlay-action";

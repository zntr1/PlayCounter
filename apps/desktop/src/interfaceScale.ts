/* Interface size, in two parts: the navigation chrome (sidebar and title bar)
   and the content area. Each is a CSS zoom on its own region, so text, icons,
   covers and spacing inside it grow together while the other side keeps its
   size. Menus and dialogs that portal to <body> stay at 100%. */

export const SCALE_OPTIONS = [
  { value: 0.9, label: "90%" },
  { value: 1, label: "100%" },
  { value: 1.1, label: "110%" },
  { value: 1.2, label: "120%" },
  { value: 1.3, label: "130%" },
] as const;

export const DEFAULT_CONTENT_SCALE = 1.1;
export const DEFAULT_MENU_SCALE = 1;

export function isInterfaceScale(value: unknown): value is number {
  return (
    typeof value === "number" &&
    SCALE_OPTIONS.some((option) => Math.abs(option.value - value) < 0.001)
  );
}

export function normalizeInterfaceScale(value: unknown, fallback: number) {
  return isInterfaceScale(value)
    ? SCALE_OPTIONS.find((option) => Math.abs(option.value - value) < 0.001)!
        .value
    : fallback;
}

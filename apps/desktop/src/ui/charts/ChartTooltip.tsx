import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

type TooltipState = { anchor: HTMLElement; content: ReactNode } | null;

export function useChartTooltip() {
  const [state, setState] = useState<TooltipState>(null);
  return {
    state,
    show: (anchor: HTMLElement, content: ReactNode) =>
      setState({ anchor, content }),
    hide: () => setState(null),
  };
}

export function ChartTooltip({
  state,
  onClose,
}: {
  state: TooltipState;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!state || !ref.current) return;
    const anchor = state.anchor.getBoundingClientRect();
    const tooltip = ref.current.getBoundingClientRect();
    const gap = 8;
    const left = Math.max(
      gap,
      Math.min(
        window.innerWidth - tooltip.width - gap,
        anchor.left + anchor.width / 2 - tooltip.width / 2,
      ),
    );
    const preferredTop = anchor.top - tooltip.height - gap;
    const top = Math.max(
      gap,
      Math.min(
        window.innerHeight - tooltip.height - gap,
        preferredTop >= gap ? preferredTop : anchor.bottom + gap,
      ),
    );
    setPosition({ left, top });
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const handleViewportChange = () => onClose();
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [onClose, state]);

  if (!state) return null;
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none fixed z-[70] max-w-xs rounded-md border border-border bg-surface px-3 py-2 text-xs text-text shadow-raised"
      style={position}
    >
      {state.content}
    </div>,
    document.body,
  );
}

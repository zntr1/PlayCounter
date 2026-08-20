import clsx from "clsx";
import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type MouseEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Loader2, X, type LucideIcon } from "lucide-react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "border border-border bg-surface text-text hover:bg-surface-hover",
  ghost: "text-text-muted hover:bg-surface-hover hover:text-text",
  danger: "bg-danger-solid text-white hover:bg-danger-solid-hover",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  icon?: LucideIcon;
  loading?: boolean;
};

export function Button({
  variant = "secondary",
  icon: Icon,
  loading = false,
  className,
  children,
  type = "button",
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={clsx(buttonBase, buttonVariants[variant], className)}
      {...rest}
    >
      {loading ? (
        <Loader2 size={15} className="animate-spin" />
      ) : Icon ? (
        <Icon size={15} />
      ) : null}
      {children}
    </button>
  );
}

type IconButtonIntent = "default" | "danger";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: LucideIcon;
  intent?: IconButtonIntent;
};

const iconButtonIntents: Record<IconButtonIntent, string> = {
  default:
    "border-border text-text-muted hover:bg-surface-hover hover:text-text",
  danger:
    "border-border text-text-muted hover:border-danger-border hover:bg-danger-tint hover:text-danger",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      icon: Icon,
      intent = "default",
      className,
      children,
      type = "button",
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={clsx(
          "inline-grid h-8 w-8 shrink-0 place-items-center rounded-md border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50",
          iconButtonIntents[intent],
          className,
        )}
        {...rest}
      >
        {Icon ? <Icon size={15} /> : children}
      </button>
    );
  },
);

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function AnimatedCount({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const [animate, setAnimate] = useState(false);
  const previous = useRef(value);

  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setAnimate(true);
    const timer = setTimeout(() => setAnimate(false), 320);
    return () => clearTimeout(timer);
  }, [value]);

  return (
    <span className={clsx("inline-block", animate && "animate-pop", className)}>
      {value}
    </span>
  );
}

export function Input({ className, ...rest }: InputProps) {
  return (
    <input
      className={clsx(
        "min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30",
        className,
      )}
      {...rest}
    />
  );
}

// Closes an open overlay (modal, menu) when the user presses Escape.
export function useEscapeKey(onClose: () => void) {
  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
}

export type ModalSize = "sm" | "md" | "wide";

const modalSizes: Record<ModalSize, string> = {
  sm: "max-w-md",
  md: "max-w-lg",
  wide: "max-w-4xl",
};

export function useDialogFocus(containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusableSelector =
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const preferred = container.querySelector<HTMLElement>("[data-autofocus]");
    (preferred ?? container).focus();

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Tab") return;
      const focusable = [
        ...container!.querySelectorAll<HTMLElement>(focusableSelector),
      ].filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        container!.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (document.activeElement === container) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    container.addEventListener("keydown", handleKeyDown);
    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) previous?.focus?.();
      });
    };
  }, [containerRef]);
}

export function Modal({
  size = "md",
  labelId,
  eyebrow,
  title,
  subtitle,
  icon: Icon,
  onClose,
  footer,
  children,
}: {
  size?: ModalSize;
  labelId: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEscapeKey(onClose);
  useDialogFocus(panelRef);

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        tabIndex={-1}
        className={`flex max-h-[90vh] w-full ${modalSizes[size]} animate-toast-in flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-raised outline-none`}
      >
        <div className="shrink-0 border-b border-border bg-gradient-to-br from-accent/10 via-surface to-surface px-5 py-4 sm:px-6">
          <div className="flex items-start gap-3">
            {Icon ? (
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-accent/20 bg-accent/10 text-accent">
                <Icon size={20} />
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              {eyebrow ? (
                <div className="text-xs font-semibold uppercase tracking-wider text-accent">
                  {eyebrow}
                </div>
              ) : null}
              <h2
                id={labelId}
                className="mt-0.5 text-lg font-semibold text-text"
              >
                {title}
              </h2>
              {subtitle ? (
                <p
                  className="mt-1 truncate text-sm text-text-muted"
                  title={subtitle}
                >
                  {subtitle}
                </p>
              ) : null}
            </div>
            <IconButton icon={X} aria-label="Close" onClick={onClose} />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          {children}
        </div>
        {footer ? (
          <div className="shrink-0 border-t border-border bg-surface px-5 py-4 sm:px-6">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function useContextMenu() {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    setPosition({ x: e.clientX, y: e.clientY });
    setOpen(true);
  };

  const close = () => setOpen(false);
  const openAt = (nextPosition: { x: number; y: number }) => {
    setPosition(nextPosition);
    setOpen(true);
  };

  return {
    props: { onContextMenu },
    open,
    position,
    close,
    openAt,
  };
}

export function ContextMenu({
  open,
  position,
  onClose,
  children,
  dataTour,
  focusFirstItem,
}: {
  open: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  children: ReactNode;
  dataTour?: string;
  focusFirstItem?: boolean;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState(position);

  useEffect(() => {
    if (!open) return;

    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const x = Math.min(position.x, window.innerWidth - rect.width - 8);
      const y = Math.min(position.y, window.innerHeight - rect.height - 8);
      setAdjustedPosition({ x, y });
    } else {
      setAdjustedPosition(position);
    }

    const handleGlobalClick = (e: globalThis.MouseEvent) => {
      // Allow clicking inside the menu without closing immediately
      // (item clicks will close it if they call onClose)
      if (menuRef.current && menuRef.current.contains(e.target as Node)) {
        return;
      }
      // Tutorial controls own their transition and cleanup. Closing a guided
      // menu on mousedown here would trigger its retreat rule before the
      // Skip/Back/Exit click can run.
      if (e.target instanceof Element && e.target.closest("[data-tour-card]")) {
        return;
      }
      onClose();
    };
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("mousedown", handleGlobalClick);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", handleGlobalClick);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", onClose);
    };
  }, [open, position, onClose]);

  useEffect(() => {
    if (open && focusFirstItem) {
      window.setTimeout(() =>
        menuRef.current?.querySelector("button")?.focus(),
      );
    }
  }, [focusFirstItem, open]);

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      data-tour={dataTour}
      className="fixed z-50 min-w-40 animate-fade-in overflow-hidden rounded-md border border-border bg-surface py-1 shadow-raised"
      style={{
        top: adjustedPosition.y,
        left: adjustedPosition.x,
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}

export function ContextMenuSeparator() {
  return <div className="mx-2 my-1 h-px bg-border" />;
}

export function ContextMenuItem({
  icon: Icon,
  danger,
  onClick,
  children,
  dataTour,
}: {
  icon?: LucideIcon;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
  dataTour?: string;
}) {
  return (
    <button
      data-tour={dataTour}
      type="button"
      className={clsx(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
        danger
          ? "text-danger hover:bg-danger-tint"
          : "text-text hover:bg-surface-hover",
      )}
      onClick={onClick}
    >
      {Icon && (
        <Icon
          size={14}
          className={danger ? "text-danger" : "text-text-muted"}
        />
      )}
      <span className="flex-1 truncate">{children}</span>
    </button>
  );
}

import clsx from "clsx";
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { Loader2, type LucideIcon } from "lucide-react";

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

export function IconButton({
  icon: Icon,
  intent = "default",
  className,
  children,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
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
}

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

export function useContextMenu() {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    setPosition({ x: e.clientX, y: e.clientY });
    setOpen(true);
  };

  const close = () => setOpen(false);

  return {
    props: { onContextMenu },
    open,
    position,
    close,
  };
}

export function ContextMenu({
  open,
  position,
  onClose,
  children,
}: {
  open: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  children: ReactNode;
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

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
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
}: {
  icon?: LucideIcon;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
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

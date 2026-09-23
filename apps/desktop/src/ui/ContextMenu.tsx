import clsx from "clsx";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type Dispatch,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, type LucideIcon } from "lucide-react";

const openMenus: string[] = [];
export const hasOpenContextMenu = () => openMenus.length > 0;

export function useContextMenu() {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const anchorRef = useRef<HTMLElement | null>(null);
  const onContextMenu = useCallback((event: MouseEvent) => {
    event.preventDefault();
    anchorRef.current = event.currentTarget as HTMLElement;
    setPosition({ x: event.clientX, y: event.clientY });
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const openAt = useCallback((nextPosition: { x: number; y: number }) => {
    anchorRef.current = document.activeElement as HTMLElement | null;
    setPosition(nextPosition);
    setOpen(true);
  }, []);
  return { props: { onContextMenu }, open, position, close, openAt, anchorRef };
}

export function useAnchoredMenu() {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) setPosition({ x: rect.left, y: rect.bottom + 6 });
    setOpen((current) => !current);
  }, []);
  return { anchorRef, open, position, close, toggle };
}

type MenuProps = {
  open: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  children: ReactNode;
  anchorRef?: RefObject<HTMLElement | null>;
  /** Return focus to a card without treating clicks anywhere on it as trigger clicks. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  dataTour?: string;
  focusFirstItem?: boolean;
  className?: string;
  ariaLabel?: string;
};

const MenuTree = createContext<{
  id: string;
  dismiss: (restoreFocus?: boolean) => void;
} | null>(null);
const MenuLevel = createContext<{
  activeSubmenu: string | null;
  setActiveSubmenu: Dispatch<SetStateAction<string | null>>;
  cancelClose: () => void;
  scheduleClose: () => void;
} | null>(null);

export function ContextMenu(props: MenuProps) {
  return props.open ? <OpenMenu {...props} /> : null;
}

function OpenMenu({ onClose, anchorRef, returnFocusRef, ...props }: MenuProps) {
  const id = useId();
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  const dismiss = useCallback(
    (restoreFocus = false) => {
      onClose();
      if (restoreFocus)
        (
          returnFocusRef?.current ??
          anchorRef?.current ??
          previousFocus.current
        )?.focus({
          preventScroll: true,
        });
    },
    [anchorRef, returnFocusRef, onClose],
  );

  useEffect(() => {
    openMenus.push(id);
    const outsideClick = (event: globalThis.MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // Flyouts are portalled siblings, but belong to the same menu tree.
      if (
        target
          .closest("[data-context-menu-tree]")
          ?.getAttribute("data-context-menu-tree") === id ||
        anchorRef?.current?.contains(target) ||
        target.closest("[data-tour-card]")
      )
        return;
      dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        openMenus.at(-1) === id
      ) {
        event.preventDefault();
        dismiss(true);
      }
    };
    const blur = () => dismiss();
    window.addEventListener("mousedown", outsideClick);
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", blur);
    return () => {
      openMenus.splice(openMenus.indexOf(id), 1);
      window.removeEventListener("mousedown", outsideClick);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", blur);
    };
  }, [anchorRef, dismiss, id]);

  return (
    <MenuTree.Provider value={{ id, dismiss }}>
      <MenuPanel {...props} />
    </MenuTree.Provider>
  );
}

function MenuPanel({
  position = { x: 0, y: 0 },
  triggerRef,
  onBack,
  onPointerEnter,
  onPointerLeave,
  children,
  dataTour,
  focusFirstItem,
  className,
  ariaLabel,
  labelledBy,
  panelId,
}: Partial<
  Pick<MenuProps, "position" | "focusFirstItem" | "className" | "ariaLabel">
> & {
  triggerRef?: RefObject<HTMLButtonElement | null>;
  onBack?: () => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  children: ReactNode;
  dataTour?: string;
  labelledBy?: string;
  panelId?: string;
}) {
  const tree = useContext(MenuTree)!;
  const panelRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  const [activeSubmenu, setActive] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typeahead = useRef({ text: "", at: 0 });
  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
  }, []);
  const setActiveSubmenu = useCallback<Dispatch<SetStateAction<string | null>>>(
    (value) => {
      cancelClose();
      setActive(value);
    },
    [cancelClose],
  );
  const scheduleClose = useCallback(() => {
    cancelClose();
    // Give the pointer time to cross diagonally into the adjacent flyout.
    closeTimer.current = setTimeout(() => setActive(null), 220);
  }, [cancelClose]);
  useEffect(() => cancelClose, [cancelClose]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const place = () => {
      const rect = panel.getBoundingClientRect();
      const trigger = triggerRef?.current?.getBoundingClientRect();
      let x = trigger ? trigger.right - 1 : position.x;
      if (trigger && x + rect.width > window.innerWidth - 8)
        x = trigger.left - rect.width + 1;
      const y = trigger ? trigger.top - 5 : position.y;
      const next = {
        x: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
        y: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
      };
      setAdjustedPosition((current) =>
        current.x === next.x && current.y === next.y ? current : next,
      );
    };
    place();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(panel);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [position.x, position.y, triggerRef]);

  useLayoutEffect(() => {
    if (focusFirstItem) {
      const panel = panelRef.current;
      (
        panel?.querySelector<HTMLElement>(
          "[data-context-menu-item]:not(:disabled),button:not(:disabled)",
        ) ?? panel
      )?.focus({ preventScroll: true });
    }
  }, [focusFirstItem]);

  return createPortal(
    <MenuLevel.Provider
      value={{ activeSubmenu, setActiveSubmenu, cancelClose, scheduleClose }}
    >
      <div
        ref={panelRef}
        id={panelId}
        role="menu"
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        data-context-menu-tree={tree.id}
        data-tour={dataTour}
        className={clsx(
          "fixed z-50 max-h-[calc(100vh-1rem)] min-w-40 max-w-[calc(100vw-1rem)] overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg border border-border bg-surface py-1 shadow-raised outline-none",
          className,
        )}
        style={{ top: adjustedPosition.y, left: adjustedPosition.x }}
        onContextMenu={(event) => event.preventDefault()}
        onPointerEnter={() => {
          cancelClose();
          onPointerEnter?.();
        }}
        onPointerLeave={() => {
          scheduleClose();
          onPointerLeave?.();
        }}
        onScroll={() => setActiveSubmenu(null)}
        onKeyDown={(event) => {
          // React portal events bubble through parents; only the owning level handles them.
          if (
            (event.target as Element).closest('[role="menu"]') !==
            event.currentTarget
          )
            return;
          if (
            (event.target as Element).closest(
              "input,textarea,select,[contenteditable=true]",
            )
          )
            return;
          if (event.key === "Escape" || (event.key === "ArrowLeft" && onBack)) {
            event.preventDefault();
            event.stopPropagation();
            if (activeSubmenu) {
              setActiveSubmenu(null);
              document
                .getElementById(activeSubmenu)
                ?.focus({ preventScroll: true });
            } else if (onBack) onBack();
            else tree.dismiss(true);
            return;
          }
          if (event.key === "Tab") {
            tree.dismiss(true);
            return;
          }
          const items = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "[data-context-menu-item]:not(:disabled)",
            ),
          ];
          if (!items.length) return;
          const index = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          let next: HTMLButtonElement | undefined;
          if (event.key === "ArrowDown")
            next = items[(index + 1) % items.length];
          if (event.key === "ArrowUp")
            next =
              items[
                (index < 0 ? items.length : index + items.length - 1) %
                  items.length
              ];
          if (event.key === "Home") next = items[0];
          if (event.key === "End") next = items.at(-1);
          if (
            event.key.length === 1 &&
            event.key !== " " &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.metaKey
          ) {
            const text =
              (Date.now() - typeahead.current.at < 500
                ? typeahead.current.text
                : "") + event.key.toLocaleLowerCase();
            typeahead.current = { text, at: Date.now() };
            next = [
              ...items.slice(index + 1),
              ...items.slice(0, index + 1),
            ].find((item) =>
              item.textContent?.trim().toLocaleLowerCase().startsWith(text),
            );
          }
          if (next) {
            event.preventDefault();
            event.stopPropagation();
            next.focus({ preventScroll: true });
            next.scrollIntoView({ block: "nearest" });
          }
        }}
      >
        {children}
      </div>
    </MenuLevel.Provider>,
    document.body,
  );
}

type ItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: LucideIcon;
  danger?: boolean;
  selected?: boolean;
  dataTour?: string;
  suffix?: ReactNode;
};

const MenuItemButton = forwardRef<HTMLButtonElement, ItemProps>(
  function MenuItemButton(
    {
      icon: Icon,
      danger,
      selected,
      dataTour,
      suffix,
      children,
      className,
      ...props
    },
    ref,
  ) {
    return (
      <button
        {...props}
        ref={ref}
        data-context-menu-item=""
        data-tour={dataTour}
        type="button"
        role={selected === undefined ? "menuitem" : "menuitemradio"}
        aria-checked={selected}
        className={clsx(
          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          danger
            ? "text-danger hover:bg-danger-tint focus-visible:bg-danger-tint"
            : "text-text hover:bg-surface-hover focus-visible:bg-surface-hover",
          className,
        )}
      >
        {Icon ? (
          <Icon
            size={14}
            aria-hidden="true"
            className={clsx(
              "shrink-0",
              danger ? "text-danger" : "text-text-muted",
            )}
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{children}</span>
        {suffix ??
          (selected ? (
            <Check
              size={14}
              aria-hidden="true"
              className="shrink-0 text-accent-ink"
            />
          ) : null)}
      </button>
    );
  },
);

export function ContextMenuItem(props: Omit<ItemProps, "suffix">) {
  const level = useContext(MenuLevel);
  return (
    <MenuItemButton
      {...props}
      onPointerEnter={(event) => {
        level?.scheduleClose();
        props.onPointerEnter?.(event);
      }}
      onFocus={(event) => {
        level?.setActiveSubmenu(null);
        props.onFocus?.(event);
      }}
    />
  );
}

export function ContextMenuSubmenu({
  label,
  icon,
  children,
  dataTour,
  menuDataTour,
}: {
  label: string;
  icon?: LucideIcon;
  children: ReactNode;
  dataTour?: string;
  menuDataTour?: string;
}) {
  const level = useContext(MenuLevel)!;
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [focusFirstItem, setFocusFirstItem] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHover = () => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
  };
  useEffect(() => cancelHover, []);
  const open = level.activeSubmenu === id;
  const show = (focus: boolean) => {
    cancelHover();
    level.setActiveSubmenu(id);
    setFocusFirstItem(focus);
  };
  return (
    <>
      <MenuItemButton
        ref={triggerRef}
        id={id}
        icon={icon}
        dataTour={dataTour}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        className={open ? "bg-surface-hover" : undefined}
        suffix={
          <ChevronRight
            size={14}
            aria-hidden="true"
            className="shrink-0 text-text-muted"
          />
        }
        onPointerEnter={() => {
          level.cancelClose();
          cancelHover();
          hoverTimer.current = setTimeout(() => show(false), 120);
        }}
        onPointerLeave={cancelHover}
        onFocus={() =>
          level.setActiveSubmenu((current) => (current === id ? current : null))
        }
        onClick={() => show(true)}
        onKeyDown={(event) => {
          if (["ArrowRight", "Enter", " "].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            show(true);
          }
        }}
      >
        {label}
      </MenuItemButton>
      {open ? (
        <MenuPanel
          triggerRef={triggerRef}
          labelledBy={id}
          panelId={`${id}-menu`}
          dataTour={menuDataTour}
          className="min-w-52"
          focusFirstItem={focusFirstItem}
          onPointerEnter={level.cancelClose}
          onPointerLeave={level.scheduleClose}
          onBack={() => {
            level.setActiveSubmenu(null);
            triggerRef.current?.focus({ preventScroll: true });
          }}
        >
          {children}
        </MenuPanel>
      ) : null}
    </>
  );
}

export function ContextMenuSeparator() {
  return <div role="separator" className="mx-2 my-1 h-px bg-border" />;
}

export function ContextMenuHeading({ children }: { children: ReactNode }) {
  return (
    <div className="mx-2 mb-1 mt-1 border-t border-border px-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-faint first:mt-0 first:border-t-0 first:pt-1">
      {children}
    </div>
  );
}

import clsx from "clsx";
import { Clipboard, ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type CustomCoverInputProps = {
  coverUrl: string;
  gameName: string;
  disabled?: boolean;
  className?: string;
  onCoverSelected: (file: File | Blob) => Promise<void>;
  onCoverCleared: () => void;
};

export function CustomCoverInput({
  coverUrl,
  gameName,
  disabled,
  className,
  onCoverSelected,
  onCoverCleared,
}: CustomCoverInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hoveredRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveCover(file: File | Blob | null) {
    if (!file || disabled || busy) return;
    setBusy(true);
    setError(null);

    try {
      await onCoverSelected(file);
    } catch (saveError) {
      setError(formatError(saveError));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function pasteImage(event: ClipboardEvent | React.ClipboardEvent) {
    if (!event.clipboardData) return false;

    const image = [...event.clipboardData.items]
      .find((item) => item.type.startsWith("image/"))
      ?.getAsFile();
    if (!image) return false;

    event.preventDefault();
    void saveCover(image);
    return true;
  }

  useEffect(() => {
    function handleWindowPaste(event: ClipboardEvent) {
      if (!hoveredRef.current) return;
      pasteImage(event);
    }

    window.addEventListener("paste", handleWindowPaste);
    return () => window.removeEventListener("paste", handleWindowPaste);
  });

  return (
    <div className="grid min-w-0 gap-2">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={`Set cover for ${gameName}`}
        title="Set cover"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onPaste={pasteImage}
        onMouseEnter={() => {
          hoveredRef.current = true;
        }}
        onMouseLeave={() => {
          hoveredRef.current = false;
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const image = [...event.dataTransfer.files].find((file) =>
            file.type.startsWith("image/"),
          );
          void saveCover(image ?? null);
        }}
        className={clsx(
          "group relative aspect-[3/4] w-full min-w-0 overflow-hidden outline-none transition focus:border-accent",
          className || "rounded-md border border-border bg-surface-hover",
          !disabled && "cursor-pointer hover:border-accent",
          dragging && "border-accent ring-2 ring-accent/30",
        )}
      >
        {coverUrl ? (
          <img
            src={coverUrl}
            alt=""
            className="block h-full w-full object-contain"
            draggable={false}
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-xs text-text-faint">
            No cover
          </div>
        )}

        <div className="absolute inset-x-2 bottom-2 flex items-center justify-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus:opacity-100 group-focus-within:opacity-100">
          <span className="inline-grid h-8 w-8 place-items-center rounded-md bg-surface/95 text-text shadow-raised">
            <ImagePlus size={16} />
          </span>
          <span className="inline-grid h-8 w-8 place-items-center rounded-md bg-surface/95 text-text shadow-raised">
            <Clipboard size={16} />
          </span>
          {coverUrl ? (
            <button
              type="button"
              aria-label={`Remove custom cover for ${gameName}`}
              title="Remove cover"
              onClick={(event) => {
                event.stopPropagation();
                onCoverCleared();
              }}
              className="inline-grid h-8 w-8 place-items-center rounded-md bg-surface/95 text-text shadow-raised hover:text-danger"
            >
              <Trash2 size={15} />
            </button>
          ) : null}
        </div>

        {busy ? (
          <div className="absolute inset-0 grid place-items-center bg-bg/70 text-xs font-medium text-text">
            Saving
          </div>
        ) : null}

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          disabled={disabled || busy}
          onChange={(event) => {
            void saveCover(event.currentTarget.files?.[0] ?? null);
          }}
        />
      </div>
      {error ? <div className="text-xs text-danger">{error}</div> : null}
    </div>
  );
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

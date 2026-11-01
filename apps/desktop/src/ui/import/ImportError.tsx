import clsx from "clsx";
import { rateLimitMessage } from "../../rateLimitedFetch";

/** An import error. A busy server is a wait, not a failure. */
export function ImportError({ message }: { message: string }) {
  const throttled = message === rateLimitMessage();
  return (
    <div
      role={throttled ? "status" : "alert"}
      className={clsx(
        "rounded-lg border px-4 py-3 text-sm",
        throttled
          ? "border-warning-border bg-warning-tint text-warning"
          : "border-danger-border bg-danger-tint text-danger",
      )}
    >
      {message}
    </div>
  );
}

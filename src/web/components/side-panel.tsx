/**
 * Detail beside the list it was opened from, rather than on top of it.
 *
 * A dialog hides the list, so comparing two rows means open, close, open. A
 * panel docked at the right edge leaves the list where it was: clicking the
 * next row swaps what the panel shows, and the reader keeps their place.
 *
 * On a wide screen the page gives up the panel's width (see `app.css`) so
 * nothing is covered. Below that there is no room for both, so the panel
 * slides over the page with a backdrop that closes it — still from the side,
 * still dismissed the same way.
 */

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function SidePanel({
  title,
  subtitle,
  onClose,
  scrollKey,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  /**
   * What the panel is showing. The panel stays mounted when the reader moves
   * to another row, so without this the next one would open scrolled to
   * wherever the last one was left.
   */
  scrollKey?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [scrollKey]);

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-40 bg-zinc-900/40 xl:hidden"
        aria-hidden="true"
      />
      <aside
        data-side-panel=""
        aria-labelledby={titleId}
        // Escape closes the panel only while focus is inside it: on a wide
        // screen the list beside it is live, and a key pressed there — or in
        // the search palette above both — belongs to that instead.
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-zinc-200 bg-white shadow-xl motion-safe:animate-slide-in sm:w-(--side-panel-width) xl:shadow-none dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate font-semibold">
              {title}
            </h2>
            {subtitle !== undefined && (
              <div className="truncate text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</div>
            )}
          </div>
          <button
            type="button"
            aria-label="Close panel"
            onClick={onClose}
            className="-mr-1 cursor-pointer rounded-md p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="size-4" />
          </button>
        </div>
        <div ref={body} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
          {children}
        </div>
      </aside>
    </>
  );
}

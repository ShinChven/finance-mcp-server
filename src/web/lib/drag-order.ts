/**
 * Drag-to-reorder, built on pointer events.
 *
 * Pointer events rather than HTML5 drag-and-drop because the HTML5 API does
 * not exist on touch: a phone fires no `dragstart`, so a watchlist reordered
 * with `draggable` rows would be desktop-only. One pointer path covers mouse,
 * touch and pen, and the same code gives the touch case the two things it
 * needs and a mouse does not — a real drag handle, and `touch-action: none` on
 * that handle so the browser hands us the gesture instead of scrolling the
 * page with it.
 *
 * The preview is the live DOM: while a drag is in flight the hook returns a
 * reordered id array and the caller renders from it, so what is under the
 * finger is what will be saved. Positions are measured from the rendered rows
 * rather than assumed uniform, because a watchlist row is as tall as its
 * content — an item with a note and a price rail is not the height of one
 * without.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";

/** Moves one entry, returning a new array. Out-of-range indices are clamped. */
export function moveInOrder<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return items;
  const target = Math.min(Math.max(to, 0), items.length - 1);
  if (target === from) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved!);
  return next;
}

/**
 * The slot a pointer at `y` is over, given each row's vertical midpoint.
 *
 * Midpoints rather than edges: a row only yields once the pointer is past its
 * centre, which is what stops a drag from flickering between two slots while
 * the finger sits on the boundary between them.
 */
export function slotForPosition(midpoints: number[], y: number): number {
  for (let index = 0; index < midpoints.length; index += 1) {
    if (y < midpoints[index]!) return index;
  }
  return Math.max(0, midpoints.length - 1);
}

/** How close to the viewport edge a drag has to get before the page follows. */
const AUTOSCROLL_EDGE_PX = 72;
const AUTOSCROLL_MAX_SPEED = 14;

export interface DragOrder {
  /** Ids in the order to render right now — the live preview during a drag. */
  order: string[];
  /** The id being dragged, or null. Callers use it to style the moving row. */
  dragging: string | null;
  /** Props for the grab handle of one row. Spread onto a `<button>`. */
  handleProps: (id: string) => {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onKeyDown: (event: ReactKeyboardEvent) => void;
    style: { touchAction: "none" };
    "aria-disabled"?: true;
  };
  /** Put on the scroll/list container; rows are found underneath it. */
  containerRef: RefObject<HTMLElement | null>;
  /** Put on each row, so the hook can measure it: `{...rowProps(id)}`. */
  rowProps: (id: string) => { "data-drag-id": string };
}

export interface DragOrderOptions {
  /** The committed order, from the server. */
  ids: string[];
  /** Called with the new order once a drag ends having moved something. */
  onCommit: (ids: string[]) => void;
  /**
   * When false, handles are inert. Reordering is only meaningful in the
   * manual order — dragging a row of a list sorted by today's change would
   * write an order the next render immediately hides.
   */
  enabled?: boolean;
}

export function useDragOrder({ ids, onCommit, enabled = true }: DragOrderOptions): DragOrder {
  const containerRef = useRef<HTMLElement | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [preview, setPreview] = useState<string[] | null>(null);

  // Everything the pointer handlers need that must not go stale between the
  // renders a drag causes. State drives what is painted; this drives the drag.
  const state = useRef<{
    id: string;
    order: string[];
    midpoints: number[];
    pointerY: number;
    moved: boolean;
  } | null>(null);
  const frame = useRef<number | null>(null);

  // A committed order arriving from the server (another tab, an agent, a
  // refetch) replaces the preview only once the finger is up: swapping the
  // rows out from under an in-flight drag is how you drop something in the
  // wrong place.
  const order = preview ?? ids;

  const measure = useCallback((): number[] => {
    const container = containerRef.current;
    if (container === null) return [];
    return [...container.querySelectorAll<HTMLElement>("[data-drag-id]")].map((row) => {
      const rect = row.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
  }, []);

  const stopAutoscroll = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);

  /** Re-slots the dragged row for the pointer's current position. */
  const reslot = useCallback(() => {
    const current = state.current;
    if (current === null) return;
    const from = current.order.indexOf(current.id);
    const to = slotForPosition(current.midpoints, current.pointerY);
    if (from === -1 || from === to) return;
    const next = moveInOrder(current.order, from, to);
    current.order = next;
    current.moved = true;
    setPreview(next);
    // The rows have just changed height-order; the midpoints that decided this
    // slot describe the previous layout. Re-read them after the paint.
    requestAnimationFrame(() => {
      if (state.current !== null) state.current.midpoints = measure();
    });
  }, [measure]);

  /**
   * Drags near the top or bottom of the screen scroll the page.
   *
   * On a phone the list is taller than the viewport and the finger cannot
   * leave it, so without this a row can only ever be moved as far as one
   * screenful.
   */
  const autoscroll = useCallback(() => {
    frame.current = requestAnimationFrame(() => {
      const current = state.current;
      if (current === null) return;
      const top = current.pointerY - AUTOSCROLL_EDGE_PX;
      const bottom = current.pointerY - (window.innerHeight - AUTOSCROLL_EDGE_PX);
      const speed =
        top < 0
          ? Math.max(-AUTOSCROLL_MAX_SPEED, (top / AUTOSCROLL_EDGE_PX) * AUTOSCROLL_MAX_SPEED)
          : bottom > 0
            ? Math.min(AUTOSCROLL_MAX_SPEED, (bottom / AUTOSCROLL_EDGE_PX) * AUTOSCROLL_MAX_SPEED)
            : 0;
      if (speed !== 0) {
        window.scrollBy(0, speed);
        // Scrolling moved every row under a stationary finger.
        current.midpoints = measure();
        reslot();
      }
      autoscroll();
    });
  }, [measure, reslot]);

  const finish = useCallback(() => {
    const current = state.current;
    state.current = null;
    stopAutoscroll();
    setDragging(null);
    if (current === null) return;
    if (current.moved) onCommit(current.order);
    // The preview stays until the refetch lands, so the row does not snap back
    // to its old slot for the moment the request is in flight.
    else setPreview(null);
  }, [onCommit, stopAutoscroll]);

  // Bound to the window rather than the handle: a fast drag outruns the
  // element under the pointer, and a drag that ends off-screen still has to
  // end.
  useEffect(() => {
    if (dragging === null) return;

    const onMove = (event: PointerEvent): void => {
      const current = state.current;
      if (current === null) return;
      // Without this the browser treats the gesture as a scroll or a text
      // selection halfway through it.
      event.preventDefault();
      current.pointerY = event.clientY;
      reslot();
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [dragging, finish, reslot]);

  // A fresh server order supersedes the preview it was produced from. Keyed on
  // the ids themselves, not the array identity: a caller that rebuilds the
  // array every render would otherwise clear the preview between the commit
  // and the refetch that confirms it, and the row would visibly snap back.
  const committed = ids.join("\u0000");
  useEffect(() => {
    if (state.current === null) setPreview(null);
  }, [committed]);

  useEffect(() => stopAutoscroll, [stopAutoscroll]);

  const handleProps = useCallback(
    (id: string) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>): void => {
        // Secondary buttons open context menus; they are not drags.
        if (!enabled || (event.pointerType === "mouse" && event.button !== 0)) return;
        event.preventDefault();
        event.stopPropagation();
        // `preventDefault` costs the handle the focus a click would have given
        // it; without focus the arrow-key path below is unreachable after a
        // pointer drag.
        event.currentTarget.focus();
        state.current = {
          id,
          order: [...order],
          midpoints: measure(),
          pointerY: event.clientY,
          moved: false,
        };
        setDragging(id);
        setPreview([...order]);
        autoscroll();
        // The one cue a touch drag has that a mouse drag gets from the cursor.
        if (event.pointerType === "touch") navigator.vibrate?.(8);
      },
      /**
       * The same reorder without a pointer at all. A drag handle that only
       * responds to dragging is unusable with a keyboard, and this is also the
       * precise way to move something one slot.
       */
      onKeyDown: (event: ReactKeyboardEvent): void => {
        if (!enabled) return;
        const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
        if (delta === 0) return;
        event.preventDefault();
        const from = order.indexOf(id);
        const next = moveInOrder(order, from, from + delta);
        if (next === order) return;
        setPreview(next);
        onCommit(next);
      },
      style: { touchAction: "none" as const },
      ...(enabled ? {} : { "aria-disabled": true as const }),
    }),
    [autoscroll, enabled, measure, onCommit, order],
  );

  const rowProps = useCallback((id: string) => ({ "data-drag-id": id }), []);

  return { order, dragging, handleProps, containerRef, rowProps };
}

/** Reorders records to match an id order, dropping ids it has no record for. */
export function sortByIds<T extends { id: string }>(records: T[], ids: string[]): T[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  const ordered = ids.map((id) => byId.get(id)).filter((record): record is T => record !== undefined);
  // Anything the order does not mention keeps its place at the end rather than
  // disappearing — the same rule the server applies to a partial reorder.
  const seen = new Set(ids);
  return [...ordered, ...records.filter((record) => !seen.has(record.id))];
}

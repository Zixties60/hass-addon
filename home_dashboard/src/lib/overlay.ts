import { type RefObject, type TouchEvent, useEffect, useRef, useState } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Behaviour shared by modal overlays (drawer, bottom sheet):
 * Escape closes, focus moves into the overlay and back to the trigger on close,
 * and the page behind doesn't scroll while it is open (`lockScroll`).
 */
export function useOverlay(
  open: boolean,
  { onClose, container, lockScroll = true }: { onClose: () => void; container: RefObject<HTMLElement | null>; lockScroll?: boolean },
) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    container.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);

    const root = document.documentElement;
    const prevOverflow = root.style.overflow;
    if (lockScroll) root.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      if (lockScroll) root.style.overflow = prevOverflow;
      trigger?.focus?.({ preventScroll: true });
    };
  }, [open, lockScroll]);
}

/** Whether a media query currently matches, updating on change. */
export function useMedia(query: string) {
  const [match, setMatch] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

/**
 * Swipe-to-dismiss for a drawer (`left`) or bottom sheet (`down`). Returns touch handlers and
 * the current drag offset in px, so the panel can follow the finger. Movements across the
 * dismiss direction are left to the browser (scrolling), and a sheet only drags when its
 * content is scrolled to the top. Tapping the backdrop or Escape is the non-drag alternative.
 */
export function useSwipeDismiss(direction: 'left' | 'down', onClose: () => void) {
  const start = useRef<{ x: number; y: number; along: boolean | null } | null>(null);
  const [offset, setOffset] = useState(0);
  const end = () => {
    if (Math.abs(offset) > 64) onClose();
    start.current = null;
    setOffset(0);
  };
  const handlers = {
    onTouchStart: (e: TouchEvent<HTMLElement>) => {
      if (direction === 'down' && e.currentTarget.scrollTop > 0) return;
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY, along: null };
    },
    onTouchMove: (e: TouchEvent) => {
      const s = start.current;
      if (!s) return;
      const t = e.touches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      // Decide the gesture direction once, after a few pixels of movement.
      if (s.along === null && Math.hypot(dx, dy) > 8) {
        s.along = direction === 'left' ? Math.abs(dx) > Math.abs(dy) : dy > Math.abs(dx);
      }
      if (s.along) setOffset(direction === 'left' ? Math.min(0, dx) : Math.max(0, dy));
    },
    onTouchEnd: end,
    onTouchCancel: end,
  };
  const style = offset
    ? { transform: direction === 'left' ? `translateX(${offset}px)` : `translateY(${offset}px)`, transition: 'none' }
    : undefined;
  return { handlers, style };
}

"use client";

import { useEffect, useRef, useState } from "react";
import { fill, t } from "@/lib/i18n";

const v = t.backoffice.inventory.viewer;

/**
 * Full-screen photo viewer: the WHOLE photo (not cropped), arrows / swipe
 * between photos, pinch or double-tap to zoom (drag to look around), close
 * with X, Esc or the phone's / browser's Back button.
 */
export function PhotoViewer({
  photos,
  start,
  onClose,
}: {
  photos: { url: string; alt: string }[];
  start: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(start);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef(0);
  // One gesture = from the first finger down to the last finger up.
  const gesture = useRef<{ multi: boolean; start: { x: number; y: number }; moved: boolean } | null>(null);
  const closed = useRef(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const count = photos.length;
  const go = (i: number) => {
    setIndex((i + count) % count);
    setScale(1);
    setPan({ x: 0, y: 0 });
  };

  // Back button closes the viewer: add a history entry while it's open.
  useEffect(() => {
    closeRef.current?.focus();
    window.history.pushState({ photoViewer: true }, "", window.location.href);
    const onPop = () => {
      closed.current = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /** Close with X / Esc: go back, which removes our history entry. */
  function close() {
    if (closed.current) return;
    window.history.back();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight" && count > 1) go(index + 1);
      if (e.key === "ArrowLeft" && count > 1) go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function onDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) gesture.current = { multi: false, start: { x: e.clientX, y: e.clientY }, moved: false };
    else if (gesture.current) gesture.current.multi = true;
    if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(p1.x - p2.x, p1.y - p2.y), scale };
      swipe.current = null;
    } else {
      swipe.current = { x: e.clientX, y: e.clientY };
    }
  }

  function onMove(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g && Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) > 10) g.moved = true;
    if (pointers.current.size === 2 && pinch.current) {
      const [p1, p2] = [...pointers.current.values()];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      setScale(Math.min(4, Math.max(1, (pinch.current.scale * dist) / pinch.current.dist)));
    } else if (scale > 1) {
      setPan((p) => ({ x: p.x + e.clientX - prev.x, y: p.y + e.clientY - prev.y }));
    }
  }

  function onUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (scale <= 1) setPan({ x: 0, y: 0 });
    // Swipe left / right (only when not zoomed)
    if (swipe.current && scale === 1 && count > 1 && !gesture.current?.multi) {
      const dx = e.clientX - swipe.current.x;
      const dy = e.clientY - swipe.current.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(index + (dx < 0 ? 1 : -1));
    }
    swipe.current = null;
    if (pointers.current.size > 0) return; // other fingers still down
    // Double-tap / double-click toggles zoom — only real taps count (one
    // finger, no movement), never the end of a pinch, drag or swipe.
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.multi || g.moved) {
      lastTap.current = 0;
      return;
    }
    const now = Date.now();
    if (now - lastTap.current < 300) {
      setScale((s) => (s > 1 ? 1 : 2.5));
      setPan({ x: 0, y: 0 });
      lastTap.current = 0;
    } else {
      lastTap.current = now;
    }
  }

  const photo = photos[index];
  const arrow =
    "absolute top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-2xl text-white hover:bg-white/25";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-modal="true" aria-label={v.title}>
      <div className="flex items-center justify-between p-3 text-white">
        <span className="px-2 text-sm tabular-nums">{count > 1 ? fill(v.counter, { n: index + 1, of: count }) : ""}</span>
        <button ref={closeRef} type="button" onClick={close} aria-label={v.close} className="flex h-11 w-11 items-center justify-center rounded-full text-2xl hover:bg-white/15">
          ✕
        </button>
      </div>
      <div
        className="relative flex flex-1 touch-none items-center justify-center overflow-hidden"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- storage URL / local preview */}
        <img
          src={photo.url}
          alt={photo.alt}
          draggable={false}
          className="pointer-events-none max-h-full max-w-full select-none object-contain"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transition: "transform 0.08s" }}
        />
        {count > 1 && (
          <>
            <button type="button" aria-label={v.previous} onClick={() => go(index - 1)} onPointerDown={(e) => e.stopPropagation()} className={`${arrow} left-3`}>‹</button>
            <button type="button" aria-label={v.next} onClick={() => go(index + 1)} onPointerDown={(e) => e.stopPropagation()} className={`${arrow} right-3`}>›</button>
          </>
        )}
      </div>
      <p className="p-3 text-center text-xs text-white/60">{v.hint}</p>
    </div>
  );
}

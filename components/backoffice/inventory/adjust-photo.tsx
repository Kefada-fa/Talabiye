"use client";

import { useEffect, useRef, useState } from "react";
import { fill, t } from "@/lib/i18n";
import { clampFocus, DEFAULT_FOCUS, FocusedPhoto, type PhotoFocus } from "@/components/photo/focused-photo";
import { primaryButton, secondaryButton } from "@/components/backoffice/settings/kit";

const a = t.backoffice.inventory.adjust;

/**
 * "Adjust" frame: the card's exact shape (4:5). Drag the photo (finger or
 * mouse) to choose what shows; zoom 100–300 % with the slider. Only the
 * position is saved — the photo file is never changed.
 */
export function AdjustPhotoDialog({
  src,
  initial,
  step,
  onSave,
  onCancel,
  onSkip,
  saving,
}: {
  src: string;
  initial: PhotoFocus;
  step?: { n: number; of: number }; // "Photo 2 of 3" when several were added
  onSave: (f: PhotoFocus) => void;
  onCancel: () => void;
  onSkip?: () => void;
  saving: boolean;
}) {
  const [focus, setFocus] = useState(initial);
  const frame = useRef<HTMLDivElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function onDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = { x: e.clientX, y: e.clientY };
  }
  function onMove(e: React.PointerEvent) {
    if (!last.current || !frame.current) return;
    const r = frame.current.getBoundingClientRect();
    const dx = e.clientX - last.current.x;
    const dy = e.clientY - last.current.y;
    last.current = { x: e.clientX, y: e.clientY };
    // Moving the photo right shows more of its left side → focus moves left.
    setFocus((f) => clampFocus({ ...f, x: f.x - (dx / r.width) * 100 / f.zoom, y: f.y - (dy / r.height) * 100 / f.zoom }));
  }
  const onUp = () => {
    last.current = null;
  };
  function onWheel(e: React.WheelEvent) {
    setFocus((f) => clampFocus({ ...f, zoom: f.zoom - e.deltaY / 500 }));
  }

  const changed = focus.x !== DEFAULT_FOCUS.x || focus.y !== DEFAULT_FOCUS.y || focus.zoom !== DEFAULT_FOCUS.zoom;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label={a.title}>
      <button type="button" aria-label={a.cancel} onClick={onCancel} className="absolute inset-0 bg-black/60" />
      <div className="relative flex max-h-[95vh] w-full flex-col gap-4 overflow-y-auto rounded-t-3xl bg-bo-card p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-xl md:max-w-md md:rounded-bo-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-bo-heading text-lg font-semibold">{a.title}</h2>
            <p className="text-sm text-bo-muted">{step && step.of > 1 ? `${fill(a.step, step)} · ` : ""}{a.hint}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onCancel} aria-label={a.cancel} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl hover:bg-bo-page">
            ✕
          </button>
        </div>

        {/* The card's exact shape (4:5) */}
        <div
          ref={frame}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onWheel={onWheel}
          className="mx-auto aspect-[4/5] w-full max-w-[18rem] cursor-grab touch-none overflow-hidden rounded-2xl border-2 border-bo-accent bg-bo-page active:cursor-grabbing"
        >
          <FocusedPhoto src={src} alt="" focus={focus} draggable={false} className="h-full w-full" imgClassName="pointer-events-none" />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="photo-zoom" className="flex justify-between text-sm font-semibold">
            <span>{a.zoom}</span>
            <span className="tabular-nums text-bo-muted">{Math.round(focus.zoom * 100)}%</span>
          </label>
          <input
            id="photo-zoom"
            type="range"
            min={100}
            max={300}
            step={5}
            value={Math.round(focus.zoom * 100)}
            onChange={(e) => setFocus((f) => clampFocus({ ...f, zoom: Number(e.target.value) / 100 }))}
            className="h-11 w-full accent-bo-accent"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryButton} disabled={saving} onClick={() => onSave(clampFocus(focus))}>
            {saving ? t.backoffice.inventory.form.saving : a.save}
          </button>
          <button type="button" className={secondaryButton} disabled={!changed} onClick={() => setFocus(DEFAULT_FOCUS)}>
            {a.reset}
          </button>
          {onSkip && (
            <button type="button" className={secondaryButton} onClick={onSkip}>{a.skip}</button>
          )}
        </div>
      </div>
    </div>
  );
}

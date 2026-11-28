"use client";

import { useEffect, useRef } from "react";

/**
 * Warns before leaving a page with unsaved changes: closing/reloading the
 * tab, or clicking a link inside the app (checked before Next.js handles
 * the click). Not the browser's Back button.
 */
export function useLeaveGuard(dirty: boolean, message: string) {
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.("a[href]");
      if (!link || link.getAttribute("target") === "_blank") return;
      if ((link.getAttribute("href") ?? "").startsWith("#")) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      } else {
        dirtyRef.current = false;
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [message]);

  /** Call before navigating away on purpose (e.g. after saving). */
  return () => {
    dirtyRef.current = false;
  };
}

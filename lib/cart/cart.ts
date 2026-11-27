"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { sumMoney } from "@/lib/format";
import { MAX_CART_LINES, MAX_QTY_PER_ITEM } from "@/lib/storefront/types";

/**
 * Shopping cart, saved in the browser (localStorage), one cart per shop.
 *
 * Prices here are only for display — the database recalculates real
 * prices, totals and stock when the order is placed.
 *
 * Every storage access is wrapped in try/catch: if the browser blocks
 * storage (private mode, full disk…), the cart keeps working in memory
 * for this visit instead of crashing the page.
 */

export type CartItem = {
  productId: string;
  variantId: string | null;
  name: string;
  optionLabel: string | null; // e.g. "Size"
  variantLabel: string | null; // e.g. "4Y"
  unitPrice: number;
  quantity: number;
  maxQuantity: number; // 1–20, lower if stock was low when added
  imageUrl: string | null;
};

const STORAGE_PREFIX = "cart:v1:";
const EMPTY: CartItem[] = [];

const memoryFallback = new Map<string, string>();
const listeners = new Set<() => void>();
const snapshotCache = new Map<string, { raw: string | null; items: CartItem[] }>();

function storageKey(slug: string) {
  return STORAGE_PREFIX + slug;
}

function readRaw(slug: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(slug));
  } catch {
    return memoryFallback.get(storageKey(slug)) ?? null;
  }
}

function writeRaw(slug: string, value: string) {
  memoryFallback.set(storageKey(slug), value);
  try {
    window.localStorage.setItem(storageKey(slug), value);
  } catch {
    // storage blocked or full — the in-memory copy keeps working
  }
}

function isCartItem(x: unknown): x is CartItem {
  if (!x || typeof x !== "object") return false;
  const i = x as Record<string, unknown>;
  return (
    typeof i.productId === "string" &&
    (i.variantId === null || typeof i.variantId === "string") &&
    typeof i.name === "string" &&
    typeof i.unitPrice === "number" &&
    Number.isInteger(i.quantity) &&
    (i.quantity as number) >= 1 &&
    Number.isInteger(i.maxQuantity)
  );
}

function parse(raw: string | null): CartItem[] {
  if (!raw) return EMPTY;
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return EMPTY;
    return data.filter(isCartItem).slice(0, MAX_CART_LINES).map((i) => ({
      ...i,
      optionLabel: i.optionLabel ?? null,
      variantLabel: i.variantLabel ?? null,
      imageUrl: i.imageUrl ?? null,
      maxQuantity: Math.max(1, Math.min(MAX_QTY_PER_ITEM, i.maxQuantity)),
      quantity: Math.max(1, Math.min(MAX_QTY_PER_ITEM, i.maxQuantity, i.quantity)),
    }));
  } catch {
    return EMPTY;
  }
}

/** Returns the SAME array object until the stored value changes (needed by React). */
function getItems(slug: string): CartItem[] {
  const raw = readRaw(slug);
  const cached = snapshotCache.get(slug);
  if (cached && cached.raw === raw) return cached.items;
  const items = parse(raw);
  snapshotCache.set(slug, { raw, items });
  return items;
}

function setItems(slug: string, items: CartItem[]) {
  writeRaw(slug, JSON.stringify(items));
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Keep carts in sync across browser tabs.
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(STORAGE_PREFIX)) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const sameLine = (a: CartItem, productId: string, variantId: string | null) =>
  a.productId === productId && a.variantId === variantId;

/** Cart for one shop. `hydrated` is false during the first server render. */
export function useCart(slug: string) {
  const items = useSyncExternalStore(
    subscribe,
    () => getItems(slug),
    () => EMPTY,
  );
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  /** Adds an item (or more of it). Returns false if the cart is full. */
  const add = useCallback(
    (item: Omit<CartItem, "quantity">, quantity: number): boolean => {
      const current = getItems(slug);
      const existing = current.find((i) => sameLine(i, item.productId, item.variantId));
      if (existing) {
        const newQty = Math.min(existing.quantity + quantity, item.maxQuantity, MAX_QTY_PER_ITEM);
        setItems(
          slug,
          current.map((i) =>
            sameLine(i, item.productId, item.variantId)
              ? { ...item, quantity: Math.max(1, newQty) }
              : i,
          ),
        );
        return true;
      }
      if (current.length >= MAX_CART_LINES) return false;
      const qty = Math.max(1, Math.min(quantity, item.maxQuantity, MAX_QTY_PER_ITEM));
      setItems(slug, [...current, { ...item, quantity: qty }]);
      return true;
    },
    [slug],
  );

  const setQuantity = useCallback(
    (productId: string, variantId: string | null, quantity: number) => {
      setItems(
        slug,
        getItems(slug).map((i) =>
          sameLine(i, productId, variantId)
            ? { ...i, quantity: Math.max(1, Math.min(quantity, i.maxQuantity, MAX_QTY_PER_ITEM)) }
            : i,
        ),
      );
    },
    [slug],
  );

  const remove = useCallback(
    (productId: string, variantId: string | null) => {
      setItems(
        slug,
        getItems(slug).filter((i) => !sameLine(i, productId, variantId)),
      );
    },
    [slug],
  );

  const clear = useCallback(() => setItems(slug, []), [slug]);

  const { count, subtotal } = useMemo(
    () => ({
      count: items.reduce((n, i) => n + i.quantity, 0),
      subtotal: sumMoney(items.map((i) => i.unitPrice * i.quantity)),
    }),
    [items],
  );

  return { items, hydrated, count, subtotal, add, setQuantity, remove, clear };
}

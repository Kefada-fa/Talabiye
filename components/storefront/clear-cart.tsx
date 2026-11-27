"use client";

import { useEffect } from "react";
import { useCart } from "@/lib/cart/cart";

/** Empties the shop's cart once the order is placed. Renders nothing. */
export function ClearCart({ slug }: { slug: string }) {
  const { clear } = useCart(slug);
  useEffect(() => {
    clear();
  }, [clear]);
  return null;
}

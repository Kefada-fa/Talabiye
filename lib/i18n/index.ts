import { en, type Dictionary } from "./en";

/**
 * The active dictionary. English only for now.
 * Later: choose by locale (e.g. from the URL or a cookie) and return
 * ar / fr dictionaries with the same shape.
 */
export function getDictionary(): Dictionary {
  return en;
}

/** Shortcut used by components. */
export const t: Dictionary = en;

/** Replaces {placeholders} in a text: fill("Hi {name}", { name: "Rania" }). */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

export type { Dictionary };

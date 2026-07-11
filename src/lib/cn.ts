/**
 * `cn` — Tailwind-aware className combiner.
 *
 * The canonical `clsx` + `tailwind-merge` wrapper (the ubiquitous
 * shadcn/ui idiom): `clsx` flattens conditional class inputs, then
 * `twMerge` resolves conflicting Tailwind utilities so the last one
 * wins (e.g. `cn('px-2', 'px-4')` → `'px-4'`).
 *
 * This is the first-party replacement for the former `Dub utils`
 * alias — the only symbol the app ever consumed from that shim was
 * `cn`, and its output is byte-identical to this implementation, so
 * the swap is behavior-preserving.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

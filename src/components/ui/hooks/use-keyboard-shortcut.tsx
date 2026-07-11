/**
 * Thin re-export so existing call sites (filter-list, filter-select,
 * selection-toolbar, date-range-picker, …) keep compiling while the
 * implementation has moved to `@/lib/hooks/use-keyboard-shortcut`.
 *
 * The canonical location is Epic 57's shared module — it owns the
 * `KeyboardShortcutProvider`, the key parser, the priority model, and
 * the command-palette introspection hook. This file is a compatibility
 * shim; new code should import from `@/lib/hooks/use-keyboard-shortcut`
 * directly.
 */

export {
  KeyboardShortcutProvider,
  useKeyboardShortcut,
  useRegisteredShortcuts,
} from '@/lib/hooks/use-keyboard-shortcut';

export type {
  RegisteredShortcut,
  ShortcutHandler,
  ShortcutInput,
  ShortcutScope,
  UseKeyboardShortcutOptions,
} from '@/lib/hooks/use-keyboard-shortcut';

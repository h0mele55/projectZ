'use client';

/**
 * Combobox message resolution.
 *
 * The Combobox exposes four user-visible strings that default to
 * English: `searchPlaceholder`, `placeholder`, `emptyState`, and the
 * create-row label. Each is overridable per call via props.
 *
 * For consumers using `next-intl`, pass your translated values
 * directly:
 *
 *     const t = useTranslations('ui.combobox');
 *     <Combobox
 *       searchPlaceholder={t('searchPlaceholder')}
 *       placeholder={t('placeholder')}
 *       emptyState={t('emptyState')}
 *       createLabel={(q) => t('createLabel', { search: q })}
 *       …
 *     />
 *
 * Or use the shared `getComboboxMessages(t)` helper below which
 * returns a fully-wired defaults object keyed on the `ui.combobox`
 * namespace of your translations file.
 */

export const COMBOBOX_DEFAULT_MESSAGES = {
  searchPlaceholder: 'Search…',
  placeholder: 'Select…',
  emptyState: 'No matches',
  createLabel: (search: string) => (search ? `Create "${search}"` : 'Create new option…'),
} as const;

export interface ComboboxMessages {
  searchPlaceholder: string;
  placeholder: string;
  emptyState: string;
  createLabel: (search: string) => string;
}

/**
 * Build a localised message set from a next-intl (or compatible)
 * translator. Keys expected under the passed translator's namespace:
 * `searchPlaceholder`, `placeholder`, `emptyState`, `createLabel`
 * (accepts `{search}`), `createLabelEmpty` (for when search is empty).
 *
 * Missing keys fall back to the English defaults.
 */
export function getComboboxMessages(
  t: (key: string, values?: Record<string, string>) => string,
): ComboboxMessages {
  const safeT = (key: string, values?: Record<string, string>): string => {
    try {
      return t(key, values);
    } catch {
      return '';
    }
  };
  return {
    searchPlaceholder: safeT('searchPlaceholder') || COMBOBOX_DEFAULT_MESSAGES.searchPlaceholder,
    placeholder: safeT('placeholder') || COMBOBOX_DEFAULT_MESSAGES.placeholder,
    emptyState: safeT('emptyState') || COMBOBOX_DEFAULT_MESSAGES.emptyState,
    createLabel: (search) => {
      if (!search) {
        return safeT('createLabelEmpty') || COMBOBOX_DEFAULT_MESSAGES.createLabel('');
      }
      return safeT('createLabel', { search }) || COMBOBOX_DEFAULT_MESSAGES.createLabel(search);
    },
  };
}

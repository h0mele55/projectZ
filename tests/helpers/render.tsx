import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';

import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * The ported primitives are not context-free: 13 of them call
 * `useTranslations()`, and Tooltip needs a Radix provider. Rendering
 * them bare throws, so every rendered test goes through this wrapper.
 *
 * Messages are deliberately empty. `getMessageFallback` returns the key
 * itself, so a component that looks up `common.close` renders the string
 * "common.close" rather than exploding. That keeps these tests focused
 * on structure and a11y contracts — translation *content* is P06's
 * concern (messages/{bg,en}), and asserting on real copy here would make
 * every primitive test brittle to a wording change.
 */
function Providers({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider
      locale="en"
      messages={{}}
      onError={() => {}}
      getMessageFallback={({ key }) => key}
    >
      <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
    </NextIntlClientProvider>
  );
}

export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, { wrapper: Providers, ...options });
}

export * from '@testing-library/react';
export { renderWithProviders as render };

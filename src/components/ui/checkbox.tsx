'use client';

/**
 * Epic 55 — shared <Checkbox> primitive.
 *
 * Wraps `@radix-ui/react-checkbox` with semantic-token styling and a
 * CVA-sized API so checkboxes look consistent next to inputs of
 * matching size (sm: 16px, md: 20px, lg: 24px).
 *
 * States covered by the variant:
 *   - unchecked → transparent background, default border
 *   - checked / indeterminate → brand-emphasis background, inverted icon
 *   - disabled → semi-opaque, cursor-not-allowed
 *   - invalid (`data-invalid=""` attr) → error-border + error-ring
 *
 * The invalid state is a data attribute rather than a prop branch so
 * `<FormField>` can toggle it declaratively from the wrapper.
 */

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { cn } from '@/lib/cn';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef } from 'react';
import { Check2, Minus } from './icons';

export const checkboxVariants = cva(
  [
    'peer shrink-0 rounded-md border transition-colors',
    'bg-bg-default border-border-default text-content-inverted',
    'hover:border-border-emphasis',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg-default',
    'data-[state=checked]:bg-brand-emphasis data-[state=checked]:border-brand-emphasis',
    'data-[state=indeterminate]:bg-brand-emphasis data-[state=indeterminate]:border-brand-emphasis',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'data-[invalid]:border-border-error data-[invalid]:focus-visible:ring-border-error',
  ],
  {
    variants: {
      size: {
        sm: 'h-4 w-4',
        md: 'h-5 w-5',
        lg: 'h-6 w-6',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

const iconSizeForCheckbox = {
  sm: 'size-2.5',
  md: 'size-3',
  lg: 'size-3.5',
} as const;

export interface CheckboxProps
  extends
    React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>,
    VariantProps<typeof checkboxVariants> {
  /** Surface the invalid state without prop drilling. */
  invalid?: boolean;
}

const Checkbox = forwardRef<React.ElementRef<typeof CheckboxPrimitive.Root>, CheckboxProps>(
  ({ className, size, invalid, ...props }, ref) => (
    <CheckboxPrimitive.Root
      ref={ref}
      data-invalid={invalid ? '' : undefined}
      aria-invalid={invalid || undefined}
      className={cn(checkboxVariants({ size }), className)}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="group/indicator text-content-inverted flex items-center justify-center">
        <Check2
          className={cn(
            iconSizeForCheckbox[size ?? 'md'],
            'group-data-[state=indeterminate]/indicator:hidden',
          )}
        />
        <Minus
          className={cn(
            iconSizeForCheckbox[size ?? 'md'],
            'group-data-[state=checked]/indicator:hidden',
          )}
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  ),
);
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };

import { cn } from '@/lib/cn';
import { InputHTMLAttributes, ReactNode, useMemo, useState } from 'react';
import { Button } from './button';
import { Heading } from '@/components/ui/typography';

export function Form({
  title,
  description,
  inputAttrs,
  helpText,
  buttonText = 'Save Changes',
  disabledTooltip,
  handleSubmit,
}: {
  title: string;
  description: string;
  inputAttrs: InputHTMLAttributes<HTMLInputElement>;
  helpText?: string | ReactNode;
  buttonText?: string;
  disabledTooltip?: string | ReactNode;
  handleSubmit: (data: Record<string, unknown>) => Promise<unknown>;
}) {
  const [value, setValue] = useState(inputAttrs.defaultValue);
  const [saving, setSaving] = useState(false);
  const saveDisabled = useMemo(() => {
    return saving || !value || value === inputAttrs.defaultValue;
  }, [saving, value, inputAttrs.defaultValue]);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        await handleSubmit({
          [inputAttrs.name as string]: value,
        });
        setSaving(false);
      }}
      className="border-border-subtle bg-bg-default rounded-lg border"
    >
      <div className="space-y-section relative flex flex-col p-6">
        <div className="flex flex-col space-y-1">
          <Heading level={2}>{title}</Heading>
          <p className="text-content-muted text-sm">{description}</p>
        </div>
        {typeof inputAttrs.defaultValue === 'string' ? (
          <input
            {...inputAttrs}
            type={inputAttrs.type || 'text'}
            required
            disabled={disabledTooltip ? true : false}
            onChange={(e) => setValue(e.target.value)}
            className={cn(
              'border-border-strong text-content-emphasis placeholder:text-content-subtle focus:border-focus-ring focus:ring-focus-ring w-full max-w-md rounded-md border focus:outline-none sm:text-sm',
              {
                'bg-bg-muted text-content-subtle cursor-not-allowed': disabledTooltip,
              },
            )}
          />
        ) : (
          <div className="bg-bg-subtle h-[2.35rem] w-full max-w-md animate-pulse rounded-md" />
        )}
      </div>

      <div className="gap-default border-border-subtle bg-bg-muted flex flex-col items-start justify-between rounded-b-xl border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0 sm:py-3">
        {typeof helpText === 'string' ? (
          // Epic 55 hardening: the legacy port used
          // `dangerouslySetInnerHTML` here, which is an XSS hazard if
          // a caller routes user-controlled content through `helpText`.
          // Now rendered as plain text; callers who want rich
          // formatting should pass a ReactNode (handled below).
          <p className="prose-sm prose-a:underline prose-a:underline-offset-4 hover:prose-a:text-content-default text-content-muted transition-colors">
            {helpText}
          </p>
        ) : (
          helpText
        )}
        <div className="w-fit shrink-0">
          <Button
            text={buttonText}
            loading={saving}
            disabled={saveDisabled}
            disabledTooltip={disabledTooltip}
          />
        </div>
      </div>
    </form>
  );
}

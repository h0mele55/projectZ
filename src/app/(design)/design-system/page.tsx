'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { CalendarMonth } from '@/components/ui/CalendarMonth';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CopyButton } from '@/components/ui/copy-button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

/**
 * The design-system gallery. Every ported primitive renders here so a
 * human — and the Playwright + axe smoke specs — can see the whole
 * platform in one page, in both themes.
 *
 * Each family is an <h2>; `design-system-smoke.spec.ts` asserts every
 * section heading renders, so a primitive added without one is not
 * covered.
 */

const SECTIONS = [
  'Button',
  'Input',
  'Textarea',
  'Checkbox',
  'RadioGroup',
  'Switch',
  'StatusBadge',
  'Skeleton',
  'EmptyState',
  'ErrorState',
  'Tooltip',
  'CopyButton',
  'Modal',
  'Sheet',
  'ConfirmDialog',
  'CalendarMonth',
] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    // The testid gives the visual-regression specs a stable, unambiguous
    // target — `page.locator('section')` matches every family on the page.
    <section data-testid={`ds-section-${title}`} className="border-border-subtle border-t py-8">
      <h2 className="text-content-emphasis mb-4 font-mono text-lg font-semibold">{title}</h2>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </section>
  );
}

export default function DesignSystemPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [switched, setSwitched] = useState(false);
  const [radio, setRadio] = useState('padel');

  return (
    <TooltipProvider>
      <main className="bg-bg-page text-content-default min-h-screen px-8 py-10">
        <header className="flex items-baseline justify-between pb-6">
          <div>
            <h1 className="text-content-emphasis font-mono text-3xl font-semibold">
              playerz.bg — design system
            </h1>
            <p className="text-content-muted mt-1 text-sm">
              {SECTIONS.length} primitive families ported in P02, shown in both themes.
            </p>
          </div>
          <ThemeToggle />
        </header>

        <Section title="Button">
          <Button variant="primary">Book a court</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Cancel booking</Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </Section>

        <Section title="Input">
          <div className="w-64">
            <Label htmlFor="ds-input">Venue name</Label>
            <Input id="ds-input" placeholder="Sofia Padel Club" />
          </div>
        </Section>

        <Section title="Textarea">
          <div className="w-64">
            <Label htmlFor="ds-textarea">Notes</Label>
            <Textarea id="ds-textarea" placeholder="Bring your own racket…" />
          </div>
        </Section>

        <Section title="Checkbox">
          <div className="flex items-center gap-2">
            <Checkbox
              id="ds-checkbox"
              checked={checked}
              onCheckedChange={(v) => setChecked(v === true)}
            />
            <Label htmlFor="ds-checkbox">Indoor courts only</Label>
          </div>
        </Section>

        <Section title="RadioGroup">
          <RadioGroup value={radio} onValueChange={setRadio}>
            {['padel', 'tennis', 'badminton'].map((sport) => (
              <div key={sport} className="flex items-center gap-2">
                <RadioGroupItem value={sport} id={`ds-radio-${sport}`} />
                <Label htmlFor={`ds-radio-${sport}`}>{sport}</Label>
              </div>
            ))}
          </RadioGroup>
        </Section>

        <Section title="Switch">
          <div className="flex items-center gap-2">
            <Switch id="ds-switch" checked={switched} onCheckedChange={setSwitched} />
            <Label htmlFor="ds-switch">Notify me about open play</Label>
          </div>
        </Section>

        <Section title="StatusBadge">
          <StatusBadge variant="success">Confirmed</StatusBadge>
          <StatusBadge variant="warning">Pending</StatusBadge>
          <StatusBadge variant="error">Cancelled</StatusBadge>
          <StatusBadge variant="neutral">Draft</StatusBadge>
          <StatusBadge variant="info">Open play</StatusBadge>
        </Section>

        <Section title="Skeleton">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-8 w-32" />
        </Section>

        <Section title="EmptyState">
          <EmptyState title="No bookings yet" description="Your upcoming games appear here." />
        </Section>

        <Section title="ErrorState">
          <ErrorState title="Could not load courts" description="Try again in a moment." />
        </Section>

        <Section title="Tooltip">
          <Tooltip content="60 min · €24">
            <Button variant="secondary">Hover for price</Button>
          </Tooltip>
        </Section>

        <Section title="CopyButton">
          <CopyButton value="PLZ-4821" label="Copy booking reference" />
        </Section>

        <Section title="Modal">
          <Button variant="secondary" onClick={() => setModalOpen(true)}>
            Open modal
          </Button>
          <Modal showModal={modalOpen} setShowModal={setModalOpen}>
            <div className="p-6">
              <h3 className="text-content-emphasis mb-2 font-semibold">Confirm your slot</h3>
              <p className="text-content-muted text-sm">Court 3 · Saturday 18:00–19:00</p>
            </div>
          </Modal>
        </Section>

        <Section title="Sheet">
          <Button variant="secondary" onClick={() => setSheetOpen(true)}>
            Open sheet
          </Button>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title="Filters">
            <Sheet.Body>
              <p className="text-content-muted text-sm">Sport, surface, indoor/outdoor.</p>
            </Sheet.Body>
          </Sheet>
        </Section>

        <Section title="ConfirmDialog">
          <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
            Cancel booking
          </Button>
          <ConfirmDialog
            showModal={confirmOpen}
            setShowModal={setConfirmOpen}
            title="Cancel this booking?"
            description="You are more than 24h out, so this refunds in full."
            confirmLabel="Cancel booking"
            onConfirm={() => setConfirmOpen(false)}
          />
        </Section>

        <Section title="CalendarMonth">
          <CalendarMonth month={new Date('2026-07-01T00:00:00Z')} events={[]} />
        </Section>
      </main>
    </TooltipProvider>
  );
}

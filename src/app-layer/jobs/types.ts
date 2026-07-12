/** Every job the worker knows how to run. */
export const JOB_NAMES = [
  'booking-reminder-24h',
  'booking-reminder-2h',
  'no-show-check',
  'payment-retry',
  'review-request',
  'session-fill-alert',
  'key-rotation',
  'data-lifecycle-cleanup',
  'tenant-dek-rotation',
] as const;

export type JobName = (typeof JOB_NAMES)[number];

export interface JobPayload {
  tenantId: string;
  [key: string]: unknown;
}

export type JobHandler = (payload: JobPayload) => Promise<void>;

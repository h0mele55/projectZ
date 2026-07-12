import {
  assertRegistryComplete,
  register,
  registeredJobs,
} from '@/app-layer/jobs/executor-registry';
import type { JobName } from '@/app-layer/jobs/types';

/**
 * The BullMQ worker.
 *
 * Every job is registered with a STUB here so `assertRegistryComplete()`
 * passes at boot. The stubs log and no-op; P09/P10 replace them with real
 * handlers. That ordering is deliberate — a job enqueued with no handler is
 * silently dropped, and "the reminder email never sent" is not a bug anyone
 * notices until a customer misses their court.
 */

const STUBS: JobName[] = [
  'booking-reminder-24h',
  'booking-reminder-2h',
  'no-show-check',
  'payment-retry',
  'review-request',
  'session-fill-alert',
  'key-rotation',
  'data-lifecycle-cleanup',
  'tenant-dek-rotation',
];

for (const name of STUBS) {
  register(name, async (payload) => {
    console.log(`[job:${name}] stub — payload:`, JSON.stringify(payload));
  });
}

assertRegistryComplete();

console.log(`worker: ${registeredJobs().length} job handlers registered (all stubs).`);
console.log('Real handlers land in P09 (booking lifecycle) and P10 (open play).');

// The BullMQ Worker itself is wired in P09, once there are real jobs to
// consume. Booting a consumer that only runs stubs would ack-and-drop real
// work if it were ever pointed at a live queue.
process.exit(0);

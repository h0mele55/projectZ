import {
  __resetRegistry,
  assertRegistryComplete,
  getHandler,
  register,
  registeredJobs,
} from '@/app-layer/jobs/executor-registry';
import { JOB_NAMES } from '@/app-layer/jobs/types';

/**
 * A queue that accepts a job it cannot run fails at 3am, in a log nobody
 * reads, after the user was already told their booking was confirmed.
 * The registry is closed so that failure happens at BOOT instead.
 */
describe('job executor registry', () => {
  beforeEach(() => __resetRegistry());

  it('refuses to start a worker with any handler missing', () => {
    register('booking-reminder-24h', async () => {});

    expect(() => assertRegistryComplete()).toThrow(/Refusing to start the worker/);
    // The message must NAME the missing jobs — "something is missing" is
    // useless at 3am.
    expect(() => assertRegistryComplete()).toThrow(/no-show-check/);
  });

  it('accepts a fully populated registry', () => {
    for (const name of JOB_NAMES) register(name, async () => {});
    expect(() => assertRegistryComplete()).not.toThrow();
    expect(registeredJobs()).toHaveLength(JOB_NAMES.length);
  });

  it('rejects a double registration', () => {
    register('no-show-check', async () => {});
    expect(() => register('no-show-check', async () => {})).toThrow(/already registered/);
  });

  it('getHandler throws loudly rather than silently dropping the job', () => {
    expect(() => getHandler('payment-retry')).toThrow(/silently drop/);
  });
});

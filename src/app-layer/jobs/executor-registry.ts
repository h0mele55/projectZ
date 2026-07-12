import { JOB_NAMES, type JobHandler, type JobName } from './types';

/**
 * The job registry.
 *
 * A queue that accepts a job name it has no handler for fails at 3am, in a
 * worker log nobody reads, after the user has already been told their
 * booking is confirmed. So the registry is CLOSED: `register` rejects an
 * unknown name at boot, and `assertRegistryComplete()` refuses to start a
 * worker that is missing a handler.
 *
 * Loud at boot beats silent at runtime.
 */
const handlers = new Map<JobName, JobHandler>();

export function register(name: JobName, handler: JobHandler): void {
  if (!JOB_NAMES.includes(name)) {
    throw new Error(`Unknown job name: ${name}. Add it to JOB_NAMES first.`);
  }
  if (handlers.has(name)) {
    throw new Error(`Job ${name} is already registered — a double registration is a bug.`);
  }
  handlers.set(name, handler);
}

export function getHandler(name: JobName): JobHandler {
  const h = handlers.get(name);
  if (!h) {
    throw new Error(`No handler registered for job "${name}". The queue would silently drop it.`);
  }
  return h;
}

/** Called at worker boot. A missing handler must not be discovered lazily. */
export function assertRegistryComplete(): void {
  const missing = JOB_NAMES.filter((n) => !handlers.has(n));
  if (missing.length > 0) {
    throw new Error(
      `Refusing to start the worker: ${missing.length} job(s) have no handler — ` +
        `${missing.join(', ')}. They would be enqueued and silently dropped.`,
    );
  }
}

export function registeredJobs(): JobName[] {
  return [...handlers.keys()];
}

/** Test seam. */
export function __resetRegistry(): void {
  handlers.clear();
}

import type { RequestContext } from '@/app-layer/context';

/**
 * A valid RequestContext with sensible defaults and spread overrides.
 *
 * Defaults to an ANONYMOUS context on purpose: a test that needs
 * privileges must ask for them. If the default were an OWNER with every
 * permission, a policy test could pass while the policy did nothing.
 */
export function buildRequestContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    userId: null,
    tenantId: null,
    role: null,
    permissions: [],
    appPermissions: [],
    requestId: 'test-request',
    locale: 'bg',
    ...overrides,
  };
}

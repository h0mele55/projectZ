/**
 * Disable Zod v4's JIT (eval-based) validation path globally.
 *
 * Zod v4 probes `new Function("")` to detect whether `eval` is available
 * — when it is, it compiles a faster validator. Under our strict
 * production CSP (`script-src` with `strict-dynamic` and NO
 * `unsafe-eval`) the browser BLOCKS and REPORTS that probe on every
 * page, even though Zod catches the error and falls back. The result is
 * a noisy `eval` CSP violation in the console (non-breaking, but it
 * spams the console and trips security scanners).
 *
 * `jitless: true` is Zod's documented escape hatch for strict-CSP
 * environments — see the comment at `zod/v4/core/util.js` ("Skip the
 * probe under `jitless`: strict CSPs report the caught `new Function`").
 * It skips the probe entirely and always uses the interpreted
 * validator; the only cost is marginally slower validation, which is
 * irrelevant for this app. The flag lives on a `globalThis` singleton
 * (`__zod_globalConfig`), so this runs as a side effect at the top of
 * the client + server entry points, before any schema is parsed.
 */
import { z } from 'zod';

// Browser only. The strict CSP that blocks+reports the probe is a
// browser concept; on the server `new Function` is allowed, so keep the
// faster JIT validator there. (This module is imported from a client
// entry that also runs during SSR — the guard avoids slowing server-side
// validation.)
if (typeof window !== 'undefined') {
  z.config({ jitless: true });
}

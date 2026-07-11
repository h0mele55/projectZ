// Placeholder — P03 replaces this with the real setup (env loading,
// deterministic crypto seed, RTL wiring).
//
// @types/node declares NODE_ENV readonly, so a direct assignment fails
// `tsc --noEmit`. Object.assign writes it without needing a cast.
Object.assign(process.env, {
  SKIP_ENV_VALIDATION: '1',
  NODE_ENV: 'test',
});

export {};

// Vitest runs in Node: give modules that read `location` at import time (rekindle/data.ts, dev-only
// `?rkbase=`) an empty one, so their unit tests can load.
const g = globalThis as { location?: unknown };
if (typeof g.location === 'undefined') g.location = new URL('http://localhost/');

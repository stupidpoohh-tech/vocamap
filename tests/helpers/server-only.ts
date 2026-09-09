/**
 * `server-only` throws on import outside a Server Component, which is exactly
 * what it is for — and exactly what makes the modules that import it untestable
 * under vitest. Aliased away in `vitest.config.ts`; the real guard still stands
 * in the build.
 */
export {}

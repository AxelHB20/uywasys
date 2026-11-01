import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Las pruebas inician muchas sesiones seguidas desde la misma IP; el límite tiene su propia prueba.
    env: { LOGIN_RATE_LIMIT: '10000', API_RATE_LIMIT: '100000' },
  },
});

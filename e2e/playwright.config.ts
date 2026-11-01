import { defineConfig, devices } from '@playwright/test';

/**
 * Recorre el sistema en el navegador contra el sistema levantado:
 * - día completo: recepción → cola → atención → caja → cierre;
 * - consulta completa: cita → llegada → SOAP → vacuna → receta → consentimiento → cobro;
 * - día de grooming: ingreso → tablero → entrega → cobro → constancia y comisión.
 * Las pruebas comparten la caja del día: corren una tras otra.
 * Local:  docker compose up -d  y luego  cd e2e && npx playwright test
 */
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:4200',
    locale: 'es-PE',
    timezoneId: 'America/Lima',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

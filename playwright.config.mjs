import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    reducedMotion: 'no-preference',
  },
  webServer: {
    command: 'node tests/browser/fixture-server.mjs',
    port: 4173,
    reuseExistingServer: false,
    timeout: 10_000,
  },
});

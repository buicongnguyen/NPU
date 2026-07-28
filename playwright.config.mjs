import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/site',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL: 'http://127.0.0.1:43817',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node scripts/serve.mjs --port 43817',
    url: 'http://127.0.0.1:43817/index.html',
    reuseExistingServer: false,
    timeout: 30_000
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});

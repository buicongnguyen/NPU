import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/pages-site',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'line',
  outputDir: 'test-results/pages-site',
  use: {
    baseURL: 'http://127.0.0.1:43819',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node scripts/serve.mjs --port 43819 --root build/pages-site',
    url: 'http://127.0.0.1:43819/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  },
  projects: [
    {
      name: 'packaged-chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});

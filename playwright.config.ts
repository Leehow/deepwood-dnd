import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './debug',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'cd backend && venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8174',
      url: 'http://localhost:8174/health',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'cd frontend && npm run dev -- --host 127.0.0.1 --port 5174',
      url: 'http://localhost:5174',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});

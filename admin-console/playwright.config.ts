import { defineConfig, devices } from '@playwright/test'

// Base URLs can be overridden via env:
// UI_BASE_URL=http://localhost:3000 NEXT_PUBLIC_API_BASE_URL=http://localhost:8080 npx playwright test
const UI_BASE_URL = process.env.UI_BASE_URL || 'http://localhost:3000'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: UI_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})

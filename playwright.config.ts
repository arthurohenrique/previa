import { defineConfig, devices } from '@playwright/test'

/**
 * O Prévia roda em Safari no iPad. Testar em Chrome de desktop mediria outro
 * produto: outro motor de layout, outro comportamento de Pointer Events e outro
 * DPR. Os projetos abaixo cobrem retrato e paisagem, que é o requisito.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'ipad-retrato',
      use: { ...devices['iPad Pro 11'] },
    },
    {
      name: 'ipad-paisagem',
      use: { ...devices['iPad Pro 11 landscape'] },
    },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm build && pnpm start --port 3000',
        url: 'http://127.0.0.1:3000/login',
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
      },
})

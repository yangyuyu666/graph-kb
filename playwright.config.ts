import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  workers: 1,
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:1420', channel: 'msedge', headless: true, viewport: { width: 1100, height: 760 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'node scripts/dev.mjs', url: 'http://127.0.0.1:1420', reuseExistingServer: false,
    env: { GRAPH_KB_DATA_DIR: `.graph-kb/ui-test-${Date.now()}` },
  },
});

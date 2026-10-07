import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../tests',
  testMatch: ['**/shell/admission.e2e.ts', '**/voice/*.e2e.ts'],
  outputDir: 'build/test-results',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: 'list',
  projects: [
    { name: 'development', outputDir: 'build/test-results/development' },
    { name: 'packaged', outputDir: 'build/test-results/packaged' },
  ],
});

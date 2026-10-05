import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../tests/shell',
  testMatch: 'admission.e2e.ts',
  outputDir: 'build/test-results',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: 'list',
});

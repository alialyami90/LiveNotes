/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // Agent worktrees live under .claude/; only this checkout's tests belong to the run.
    include: ['src/**/*.test.{ts,tsx}'],
  },
});

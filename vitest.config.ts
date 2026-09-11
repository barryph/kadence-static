import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The controllers manipulate real DOM nodes, so tests run against jsdom
    // rather than hand-rolled fakes.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
    clearMocks: true,
  },
});

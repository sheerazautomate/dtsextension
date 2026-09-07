import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js', 'whatsapp-bot/tests/**/*.test.js'],
    globals: true
  }
});

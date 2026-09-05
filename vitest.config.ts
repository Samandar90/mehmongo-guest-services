import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      'next/link': fileURLToPath(new URL('./node_modules/vinext/dist/shims/link.js', import.meta.url)),
      'next/navigation': fileURLToPath(new URL('./node_modules/vinext/dist/shims/navigation.js', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    css: true,
    exclude: [...configDefaults.exclude, 'supabase/functions/**'],
  },
});

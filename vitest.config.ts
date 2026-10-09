import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // Next resolves this marker itself; under vitest it's a no-op so
      // server modules (e.g. lib/supabase/admin.ts) can be imported in tests
      'server-only': path.resolve(__dirname, 'node_modules/next/dist/compiled/server-only/empty.js'),
    },
  },
  test: {
    include: ['lib/**/*.test.ts', 'supabase/tests/**/*.test.ts'],
  },
})

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const API_PORT = process.env.PORT ?? '3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': `http://localhost:${API_PORT}` },
  },
  build: { outDir: 'dist' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});

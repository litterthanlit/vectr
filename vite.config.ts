import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The app compiles @vectr/core from source, so edits to the engine hot-reload
// without a package build. Published consumers use the built dist/ instead.
const coreSrc = fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@vectr/core': coreSrc } },
  test: { include: ['src/**/*.test.{ts,tsx}', 'packages/*/test/**/*.test.ts'], testTimeout: 20_000 },
});

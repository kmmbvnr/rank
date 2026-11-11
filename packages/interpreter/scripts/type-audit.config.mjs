import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    // Ordinary synchronous checks exceed five seconds on shared CI runners.
    test: { testTimeout: 20_000, runner: fileURLToPath(new URL('./type-audit-runner.mjs', import.meta.url)) },
});
